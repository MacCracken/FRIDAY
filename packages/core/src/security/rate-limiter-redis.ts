/**
 * Redis-backed Rate Limiter for SecureYeoman
 *
 * Uses sorted-set sliding windows for accurate, distributed rate limiting.
 * Each request is stored as a member scored by its timestamp; expired
 * members are trimmed before counting.
 *
 * Compatible interface with the in-memory RateLimiter so the factory
 * function can return either implementation.
 */

import { Redis as RedisClient } from 'ioredis';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type { SecurityConfig } from '@friday/shared';
import type { RateLimitResult, RateLimitRule } from './rate-limiter.js';

export class RedisRateLimiter {
  private readonly redis: RedisClient;
  private readonly prefix: string;
  private readonly rules = new Map<string, RateLimitRule>();
  private readonly defaultRule: RateLimitRule;
  private logger: SecureLogger | null = null;

  private totalHits = 0;
  private totalChecks = 0;

  constructor(
    config: SecurityConfig['rateLimiting'],
    redisUrl: string,
    redisPrefix = 'friday:rl',
  ) {
    this.redis = new RedisClient(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    this.prefix = redisPrefix;

    this.defaultRule = {
      name: 'default',
      windowMs: config.defaultWindowMs,
      maxRequests: config.defaultMaxRequests,
      keyType: 'global',
      onExceed: 'reject',
    };

    // Connect lazily — errors are handled per-operation
    void this.redis.connect().catch(() => {
      this.getLogger().error('Failed to connect to Redis for rate limiting');
    });
  }

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'RedisRateLimiter' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  addRule(rule: RateLimitRule): void {
    this.rules.set(rule.name, rule);
    this.getLogger().debug('Rate limit rule added', { ruleName: rule.name });
  }

  removeRule(name: string): boolean {
    return this.rules.delete(name);
  }

  /**
   * Check if a request is allowed under rate limits.
   * Uses a Redis sorted set with MULTI/EXEC pipeline.
   */
  async check(
    ruleName: string,
    key: string,
    context?: { userId?: string; ipAddress?: string },
  ): Promise<RateLimitResult> {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const redisKey = `${this.prefix}:${rule.name}:${rule.keyType}:${key}`;
    const now = Date.now();
    const windowStart = now - rule.windowMs;
    const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

    this.totalChecks++;

    try {
      const pipeline = this.redis.multi();
      // Remove expired entries
      pipeline.zremrangebyscore(redisKey, '-inf', String(windowStart));
      // Add the current request
      pipeline.zadd(redisKey, String(now), member);
      // Count entries in the window
      pipeline.zcard(redisKey);
      // Set key expiry to window duration (auto-cleanup)
      pipeline.expire(redisKey, Math.ceil(rule.windowMs / 1000));

      const results = await pipeline.exec();
      if (!results) {
        // Pipeline failed — allow the request (fail-open)
        return { allowed: true, remaining: rule.maxRequests - 1, resetAt: now + rule.windowMs };
      }

      const count = (results[2]?.[1] as number) ?? 0;
      const remaining = Math.max(0, rule.maxRequests - count);
      const resetAt = now + rule.windowMs;

      if (count <= rule.maxRequests) {
        return { allowed: true, remaining: remaining, resetAt };
      }

      // Over limit — remove the member we just added
      this.totalHits++;
      await this.redis.zrem(redisKey, member);

      const retryAfter = Math.ceil(rule.windowMs / 1000);

      this.getLogger().warn('Rate limit exceeded', {
        rule: rule.name,
        key: rule.keyType === 'ip' ? key : '[redacted]',
        keyType: rule.keyType,
        windowMs: rule.windowMs,
        maxRequests: rule.maxRequests,
        currentCount: count,
        userId: context?.userId,
        ipAddress: context?.ipAddress,
      });

      if (rule.onExceed === 'log_only') {
        return { allowed: true, remaining: 0, resetAt };
      }

      return { allowed: false, remaining: 0, resetAt, retryAfter };
    } catch (err) {
      // Redis unavailable — fail-open
      this.getLogger().error('Redis rate limit check failed, allowing request', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
      return { allowed: true, remaining: rule.maxRequests - 1, resetAt: now + rule.windowMs };
    }
  }

  /**
   * Check multiple rules at once — returns the most restrictive result.
   */
  async checkMultiple(
    rules: { name: string; key: string }[],
    context?: { userId?: string; ipAddress?: string },
  ): Promise<RateLimitResult> {
    let mostRestrictive: RateLimitResult = {
      allowed: true,
      remaining: Infinity,
      resetAt: 0,
    };

    for (const { name, key } of rules) {
      const result = await this.check(name, key, context);
      if (!result.allowed) return result;
      if (result.remaining < mostRestrictive.remaining) {
        mostRestrictive = result;
      }
    }

    return mostRestrictive;
  }

  /**
   * Reset rate limit for a specific key.
   */
  async reset(ruleName: string, key: string): Promise<void> {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const redisKey = `${this.prefix}:${rule.name}:${rule.keyType}:${key}`;
    await this.redis.del(redisKey);
  }

  /**
   * Get current usage for a key.
   */
  async getUsage(
    ruleName: string,
    key: string,
  ): Promise<{ count: number; limit: number; windowMs: number } | null> {
    const rule = this.rules.get(ruleName) ?? this.defaultRule;
    const redisKey = `${this.prefix}:${rule.name}:${rule.keyType}:${key}`;
    const now = Date.now();
    const windowStart = now - rule.windowMs;

    try {
      await this.redis.zremrangebyscore(redisKey, '-inf', String(windowStart));
      const count = await this.redis.zcard(redisKey);
      return { count, limit: rule.maxRequests, windowMs: rule.windowMs };
    } catch {
      return null;
    }
  }

  /**
   * Get statistics.
   */
  getStats(): {
    activeWindows: number;
    rules: number;
    totalHits: number;
    totalChecks: number;
  } {
    return {
      activeWindows: 0, // Not tracked locally for Redis
      rules: this.rules.size,
      totalHits: this.totalHits,
      totalChecks: this.totalChecks,
    };
  }

  /**
   * Disconnect from Redis.
   */
  async stop(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // Ignore disconnect errors
    }
  }
}
