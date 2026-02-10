/**
 * Rate Limiter for SecureYeoman
 * 
 * Security considerations:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-user, per-IP, and global limits
 * - Automatic cleanup of expired entries
 * - Audit logging of rate limit violations
 */

import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type { SecurityConfig } from '@friday/shared';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp when limit resets
  retryAfter?: number; // Seconds until retry (if blocked)
}

export interface RateLimitRule {
  name: string;
  windowMs: number;
  maxRequests: number;
  keyType: 'ip' | 'user' | 'api_key' | 'global';
  onExceed: 'reject' | 'delay' | 'log_only';
}

interface WindowEntry {
  count: number;
  windowStart: number;
}

/**
 * Sliding window rate limiter
 */
export class RateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly rules = new Map<string, RateLimitRule>();
  private readonly defaultRule: RateLimitRule;
  private logger: SecureLogger | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Monotonically increasing counter of requests that were rejected (rate
   * limit exceeded). Exposed via getStats() and surfaced in the security
   * section of the MetricsSnapshot so the dashboard can display threat
   * indicators in real time.
   */
  private totalHits = 0;

  /**
   * Monotonically increasing counter of ALL rate-limit checks performed,
   * regardless of outcome. Together with totalHits this lets consumers
   * compute a "blocked request ratio" for monitoring and alerting.
   */
  private totalChecks = 0;
  
  constructor(config: SecurityConfig['rateLimiting']) {
    this.defaultRule = {
      name: 'default',
      windowMs: config.defaultWindowMs,
      maxRequests: config.defaultMaxRequests,
      keyType: 'global',
      onExceed: 'reject',
    };
    
    // Start cleanup interval (every minute)
    this.startCleanup();
  }
  
  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'RateLimiter' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }
  
  /**
   * Add a custom rate limit rule
   */
  addRule(rule: RateLimitRule): void {
    this.rules.set(rule.name, rule);
    this.getLogger().debug('Rate limit rule added', { ruleName: rule.name });
  }
  
  /**
   * Remove a rate limit rule
   */
  removeRule(name: string): boolean {
    return this.rules.delete(name);
  }
  
  /**
   * Check if a request is allowed under rate limits
   */
  check(
    ruleName: string,
    key: string,
    context?: { userId?: string; ipAddress?: string }
  ): RateLimitResult {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const windowKey = this.buildWindowKey(rule.name, rule.keyType, key);
    const now = Date.now();

    // Track every check for metrics — this counter never resets and is
    // exposed via getStats() → MetricsSnapshot.security.
    this.totalChecks++;

    // Get or create window
    let window = this.windows.get(windowKey);

    if (!window || now - window.windowStart >= rule.windowMs) {
      // Start new window
      window = {
        count: 0,
        windowStart: now,
      };
      this.windows.set(windowKey, window);
    }

    // Calculate remaining
    const remaining = Math.max(0, rule.maxRequests - window.count);
    const resetAt = window.windowStart + rule.windowMs;

    // Check if under limit
    if (window.count < rule.maxRequests) {
      // Increment counter
      window.count++;

      return {
        allowed: true,
        remaining: remaining - 1,
        resetAt,
      };
    }

    // Rate limit exceeded — increment the hit counter so the metrics
    // snapshot accurately reflects how many requests have been blocked.
    this.totalHits++;
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    
    // Log violation
    this.getLogger().warn('Rate limit exceeded', {
      rule: rule.name,
      key: rule.keyType === 'ip' ? key : '[redacted]',
      keyType: rule.keyType,
      windowMs: rule.windowMs,
      maxRequests: rule.maxRequests,
      currentCount: window.count,
      userId: context?.userId,
      ipAddress: context?.ipAddress,
    });
    
    // Handle based on rule action
    if (rule.onExceed === 'log_only') {
      window.count++;
      return {
        allowed: true,
        remaining: 0,
        resetAt,
      };
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }
  
  /**
   * Check multiple rules at once
   * Returns the most restrictive result
   */
  checkMultiple(
    rules: { name: string; key: string }[],
    context?: { userId?: string; ipAddress?: string }
  ): RateLimitResult {
    let mostRestrictive: RateLimitResult = {
      allowed: true,
      remaining: Infinity,
      resetAt: 0,
    };
    
    for (const { name, key } of rules) {
      const result = this.check(name, key, context);
      
      if (!result.allowed) {
        return result; // Immediately return if any rule blocks
      }
      
      if (result.remaining < mostRestrictive.remaining) {
        mostRestrictive = result;
      }
    }
    
    return mostRestrictive;
  }
  
  /**
   * Reset rate limit for a specific key
   */
  reset(ruleName: string, key: string): void {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const windowKey = this.buildWindowKey(rule.name, rule.keyType, key);
    this.windows.delete(windowKey);
  }
  
  /**
   * Get current usage for a key
   */
  getUsage(ruleName: string, key: string): { count: number; limit: number; windowMs: number } | null {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const windowKey = this.buildWindowKey(rule.name, rule.keyType, key);
    const window = this.windows.get(windowKey);
    
    if (!window) {
      return null;
    }
    
    return {
      count: window.count,
      limit: rule.maxRequests,
      windowMs: rule.windowMs,
    };
  }
  
  /**
   * Build a unique key for the window map
   */
  private buildWindowKey(ruleName: string, keyType: string, key: string): string {
    return `${ruleName}:${keyType}:${key}`;
  }
  
  /**
   * Start periodic cleanup of expired windows
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Every minute
    
    // Don't prevent process exit
    this.cleanupInterval.unref();
  }
  
  /**
   * Clean up expired windows
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, window] of this.windows.entries()) {
      // Find the rule for this window
      const ruleName = key.split(':')[0];
      const rule = ruleName ? this.rules.get(ruleName) ?? this.defaultRule : this.defaultRule;
      
      // Check if window is expired
      if (now - window.windowStart >= rule.windowMs) {
        this.windows.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.getLogger().debug('Rate limiter cleanup', { cleanedWindows: cleaned });
    }
  }
  
  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  /**
   * Get comprehensive statistics about the current rate limiting state.
   *
   * Returns a snapshot of all rate limiter counters and metrics that can be
   * surfaced through the metrics endpoint and WebSocket broadcasts. This
   * enables the dashboard to display real-time rate limiting health and
   * threat indicators.
   *
   * The returned object contains:
   *  - activeWindows: Number of sliding-window buckets currently tracked
   *  - rules:         Number of registered rate limit rules
   *  - totalHits:     Cumulative count of requests that were rejected because
   *                   they exceeded a rate limit (i.e. the "blocked" count).
   *                   This counter is monotonically increasing and is never
   *                   reset — useful for computing rates over time windows.
   *  - totalChecks:   Cumulative count of ALL rate limit checks performed
   *                   (both allowed and rejected). Useful for calculating
   *                   the ratio of blocked-to-total requests.
   */
  getStats(): {
    activeWindows: number;
    rules: number;
    totalHits: number;
    totalChecks: number;
  } {
    return {
      activeWindows: this.windows.size,
      rules: this.rules.size,
      totalHits: this.totalHits,
      totalChecks: this.totalChecks,
    };
  }
}

/**
 * Create a rate limiter with common rules
 */
export function createRateLimiter(config: SecurityConfig): RateLimiter {
  const limiter = new RateLimiter(config.rateLimiting);
  
  // Add common rules
  limiter.addRule({
    name: 'api_requests',
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    keyType: 'user',
    onExceed: 'reject',
  });
  
  limiter.addRule({
    name: 'auth_attempts',
    windowMs: 900000, // 15 minutes
    maxRequests: 5,
    keyType: 'ip',
    onExceed: 'reject',
  });
  
  limiter.addRule({
    name: 'task_creation',
    windowMs: 60000, // 1 minute
    maxRequests: 20,
    keyType: 'user',
    onExceed: 'reject',
  });
  
  limiter.addRule({
    name: 'expensive_operations',
    windowMs: 3600000, // 1 hour
    maxRequests: 10,
    keyType: 'user',
    onExceed: 'reject',
  });
  
  return limiter;
}
