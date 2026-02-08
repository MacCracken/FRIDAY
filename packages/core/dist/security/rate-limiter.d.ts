/**
 * Rate Limiter for SecureClaw
 *
 * Security considerations:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-user, per-IP, and global limits
 * - Automatic cleanup of expired entries
 * - Audit logging of rate limit violations
 */
import type { SecurityConfig } from '@friday/shared';
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfter?: number;
}
export interface RateLimitRule {
    name: string;
    windowMs: number;
    maxRequests: number;
    keyType: 'ip' | 'user' | 'api_key' | 'global';
    onExceed: 'reject' | 'delay' | 'log_only';
}
/**
 * Sliding window rate limiter
 */
export declare class RateLimiter {
    private readonly windows;
    private readonly rules;
    private readonly defaultRule;
    private logger;
    private cleanupInterval;
    constructor(config: SecurityConfig['rateLimiting']);
    private getLogger;
    /**
     * Add a custom rate limit rule
     */
    addRule(rule: RateLimitRule): void;
    /**
     * Remove a rate limit rule
     */
    removeRule(name: string): boolean;
    /**
     * Check if a request is allowed under rate limits
     */
    check(ruleName: string, key: string, context?: {
        userId?: string;
        ipAddress?: string;
    }): RateLimitResult;
    /**
     * Check multiple rules at once
     * Returns the most restrictive result
     */
    checkMultiple(rules: Array<{
        name: string;
        key: string;
    }>, context?: {
        userId?: string;
        ipAddress?: string;
    }): RateLimitResult;
    /**
     * Reset rate limit for a specific key
     */
    reset(ruleName: string, key: string): void;
    /**
     * Get current usage for a key
     */
    getUsage(ruleName: string, key: string): {
        count: number;
        limit: number;
        windowMs: number;
    } | null;
    /**
     * Build a unique key for the window map
     */
    private buildWindowKey;
    /**
     * Start periodic cleanup of expired windows
     */
    private startCleanup;
    /**
     * Clean up expired windows
     */
    private cleanup;
    /**
     * Stop the cleanup interval
     */
    stop(): void;
    /**
     * Get statistics about current rate limiting state
     */
    getStats(): {
        activeWindows: number;
        rules: number;
    };
}
/**
 * Create a rate limiter with common rules
 */
export declare function createRateLimiter(config: SecurityConfig): RateLimiter;
//# sourceMappingURL=rate-limiter.d.ts.map