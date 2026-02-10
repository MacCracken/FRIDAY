import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter, createRateLimiter } from './rate-limiter.js';

function createTestLimiter(): RateLimiter {
  return new RateLimiter({
    defaultWindowMs: 60000,
    defaultMaxRequests: 10,
  });
}

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = createTestLimiter();
  });

  afterEach(() => {
    limiter.stop();
  });

  describe('basic rate limiting', () => {
    it('should allow requests within limit', () => {
      const result = limiter.check('default', 'user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('should reject requests exceeding limit', () => {
      // Use up all 10 requests
      for (let i = 0; i < 10; i++) {
        const r = limiter.check('default', 'user-1');
        expect(r.allowed).toBe(true);
      }

      // 11th should be rejected
      const result = limiter.check('default', 'user-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('window reset', () => {
    it('should reset after windowMs expires', () => {
      vi.useFakeTimers();

      // Use up all requests
      for (let i = 0; i < 10; i++) {
        limiter.check('default', 'user-1');
      }
      expect(limiter.check('default', 'user-1').allowed).toBe(false);

      // Advance time past window
      vi.advanceTimersByTime(60001);

      // Should be allowed again
      const result = limiter.check('default', 'user-1');
      expect(result.allowed).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('addRule() / removeRule()', () => {
    it('should add and use custom rules', () => {
      limiter.addRule({
        name: 'strict',
        windowMs: 1000,
        maxRequests: 2,
        keyType: 'user',
        onExceed: 'reject',
      });

      expect(limiter.check('strict', 'user-1').allowed).toBe(true);
      expect(limiter.check('strict', 'user-1').allowed).toBe(true);
      expect(limiter.check('strict', 'user-1').allowed).toBe(false);
    });

    it('should remove rules', () => {
      limiter.addRule({
        name: 'temp',
        windowMs: 1000,
        maxRequests: 1,
        keyType: 'user',
        onExceed: 'reject',
      });

      expect(limiter.removeRule('temp')).toBe(true);
      expect(limiter.removeRule('nonexistent')).toBe(false);
    });
  });

  describe('checkMultiple()', () => {
    it('should return most restrictive result', () => {
      limiter.addRule({
        name: 'loose',
        windowMs: 60000,
        maxRequests: 100,
        keyType: 'user',
        onExceed: 'reject',
      });
      limiter.addRule({
        name: 'tight',
        windowMs: 60000,
        maxRequests: 2,
        keyType: 'user',
        onExceed: 'reject',
      });

      // Both should pass initially
      const r1 = limiter.checkMultiple([
        { name: 'loose', key: 'user-1' },
        { name: 'tight', key: 'user-1' },
      ]);
      expect(r1.allowed).toBe(true);

      // Use up tight rule
      limiter.check('tight', 'user-1');

      // Now tight should block
      const r2 = limiter.checkMultiple([
        { name: 'loose', key: 'user-1' },
        { name: 'tight', key: 'user-1' },
      ]);
      expect(r2.allowed).toBe(false);
    });
  });

  describe('reset()', () => {
    it('should clear a specific key', () => {
      for (let i = 0; i < 10; i++) {
        limiter.check('default', 'user-1');
      }
      expect(limiter.check('default', 'user-1').allowed).toBe(false);

      limiter.reset('default', 'user-1');

      expect(limiter.check('default', 'user-1').allowed).toBe(true);
    });
  });

  describe('getUsage()', () => {
    it('should return current count', () => {
      limiter.check('default', 'user-1');
      limiter.check('default', 'user-1');

      const usage = limiter.getUsage('default', 'user-1');
      expect(usage).not.toBeNull();
      expect(usage!.count).toBe(2);
      expect(usage!.limit).toBe(10);
    });

    it('should return null for unknown key', () => {
      const usage = limiter.getUsage('default', 'unknown');
      expect(usage).toBeNull();
    });
  });

  describe('log_only onExceed mode', () => {
    it('should allow but log when exceeded', () => {
      limiter.addRule({
        name: 'monitor',
        windowMs: 60000,
        maxRequests: 1,
        keyType: 'user',
        onExceed: 'log_only',
      });

      expect(limiter.check('monitor', 'user-1').allowed).toBe(true);
      // Exceeds limit but log_only allows it
      const result = limiter.check('monitor', 'user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });
  });

  describe('getStats()', () => {
    it('should return correct counts', () => {
      limiter.addRule({
        name: 'rule1',
        windowMs: 60000,
        maxRequests: 10,
        keyType: 'user',
        onExceed: 'reject',
      });

      limiter.check('default', 'user-1');
      limiter.check('rule1', 'user-2');

      const stats = limiter.getStats();
      expect(stats.activeWindows).toBe(2);
      expect(stats.rules).toBe(1);
    });
  });

  describe('stop()', () => {
    it('should clear cleanup interval', () => {
      limiter.stop();
      // Should not throw when called again
      limiter.stop();
    });
  });

  describe('createRateLimiter()', () => {
    it('should create a limiter with default rules', () => {
      const rl = createRateLimiter({
        rateLimiting: {
          defaultWindowMs: 60000,
          defaultMaxRequests: 100,
        },
        inputValidation: {
          maxInputLength: 10000,
          maxFileSize: 1048576,
          enableInjectionDetection: true,
        },
      } as any);

      // Should have pre-configured rules like api_requests
      const result = rl.check('api_requests', 'user-1');
      expect(result.allowed).toBe(true);

      rl.stop();
    });
  });
});
