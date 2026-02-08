/**
 * Rate Limiter for SecureClaw
 *
 * Security considerations:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-user, per-IP, and global limits
 * - Automatic cleanup of expired entries
 * - Audit logging of rate limit violations
 */
import { getLogger } from '../logging/logger.js';
/**
 * Sliding window rate limiter
 */
export class RateLimiter {
    windows = new Map();
    rules = new Map();
    defaultRule;
    logger = null;
    cleanupInterval = null;
    constructor(config) {
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
    getLogger() {
        if (!this.logger) {
            try {
                this.logger = getLogger().child({ component: 'RateLimiter' });
            }
            catch {
                // Return a no-op logger if not initialized
                return {
                    trace: () => { },
                    debug: () => { },
                    info: () => { },
                    warn: () => { },
                    error: () => { },
                    fatal: () => { },
                    child: () => this.getLogger(),
                    level: 'info',
                };
            }
        }
        return this.logger;
    }
    /**
     * Add a custom rate limit rule
     */
    addRule(rule) {
        this.rules.set(rule.name, rule);
        this.getLogger().debug('Rate limit rule added', { ruleName: rule.name });
    }
    /**
     * Remove a rate limit rule
     */
    removeRule(name) {
        return this.rules.delete(name);
    }
    /**
     * Check if a request is allowed under rate limits
     */
    check(ruleName, key, context) {
        const rule = this.rules.get(ruleName) ?? this.defaultRule;
        const windowKey = this.buildWindowKey(rule.name, rule.keyType, key);
        const now = Date.now();
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
        // Rate limit exceeded
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
    checkMultiple(rules, context) {
        let mostRestrictive = {
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
    reset(ruleName, key) {
        const rule = this.rules.get(ruleName) ?? this.defaultRule;
        const windowKey = this.buildWindowKey(rule.name, rule.keyType, key);
        this.windows.delete(windowKey);
    }
    /**
     * Get current usage for a key
     */
    getUsage(ruleName, key) {
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
    buildWindowKey(ruleName, keyType, key) {
        return `${ruleName}:${keyType}:${key}`;
    }
    /**
     * Start periodic cleanup of expired windows
     */
    startCleanup() {
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
    cleanup() {
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
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    /**
     * Get statistics about current rate limiting state
     */
    getStats() {
        return {
            activeWindows: this.windows.size,
            rules: this.rules.size,
        };
    }
}
/**
 * Create a rate limiter with common rules
 */
export function createRateLimiter(config) {
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
//# sourceMappingURL=rate-limiter.js.map