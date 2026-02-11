import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock ioredis ─────────────────────────────────────────────────────

const { mockRedisInstance, execResults, state, RedisMock } = vi.hoisted(() => {
  const execResults: ([Error | null, unknown][])[] = [];
  const state = {
    zremCalls: [] as string[][],
    delCalls: [] as string[],
    zcardResult: 0,
    quitCalled: false,
  };

  const pipelineMethods = {
    zremrangebyscore: vi.fn().mockReturnThis(),
    zadd: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => {
      if (execResults.length > 0) return execResults.shift();
      return [
        [null, 0],
        [null, 1],
        [null, state.zcardResult],
        [null, 1],
      ] as [Error | null, unknown][];
    }),
  };

  const mockRedisInstance = {
    connect: vi.fn().mockResolvedValue(undefined),
    multi: vi.fn(() => pipelineMethods),
    zrem: vi.fn(async (...args: string[]) => { state.zremCalls.push(args); return 1; }),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn(async () => state.zcardResult),
    del: vi.fn(async (key: string) => { state.delCalls.push(key); return 1; }),
    quit: vi.fn(async () => { state.quitCalled = true; }),
    pipelineMethods,
  };

  const RedisMock = vi.fn(function () { return mockRedisInstance; });

  return { mockRedisInstance, execResults, state, RedisMock };
});

vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
}));

import { RedisRateLimiter } from './rate-limiter-redis.js';

const baseConfig = {
  enabled: true as const,
  defaultWindowMs: 60000,
  defaultMaxRequests: 10,
};

describe('RedisRateLimiter', () => {
  let limiter: RedisRateLimiter;

  beforeEach(() => {
    vi.clearAllMocks();
    execResults.length = 0;
    state.zremCalls = [];
    state.delCalls = [];
    state.zcardResult = 0;
    state.quitCalled = false;
    limiter = new RedisRateLimiter(baseConfig, 'redis://localhost:6379', 'test:rl');
  });

  afterEach(async () => {
    await limiter.stop();
  });

  it('allows request under limit', async () => {
    state.zcardResult = 1;
    const result = await limiter.check('default', 'user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('rejects request over limit', async () => {
    execResults.push([
      [null, 0],
      [null, 1],
      [null, 11],
      [null, 1],
    ]);
    const result = await limiter.check('default', 'user1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeDefined();
  });

  it('allows request at exact limit', async () => {
    execResults.push([
      [null, 0],
      [null, 1],
      [null, 10],
      [null, 1],
    ]);
    const result = await limiter.check('default', 'user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('uses custom rules when added', async () => {
    limiter.addRule({
      name: 'strict',
      windowMs: 1000,
      maxRequests: 2,
      keyType: 'ip',
      onExceed: 'reject',
    });
    state.zcardResult = 1;
    const result = await limiter.check('strict', '10.0.0.1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('checkMultiple returns most restrictive allowed result', async () => {
    limiter.addRule({
      name: 'rule_a',
      windowMs: 60000,
      maxRequests: 100,
      keyType: 'user',
      onExceed: 'reject',
    });
    limiter.addRule({
      name: 'rule_b',
      windowMs: 60000,
      maxRequests: 5,
      keyType: 'user',
      onExceed: 'reject',
    });

    execResults.push([[null, 0], [null, 1], [null, 2], [null, 1]]);
    execResults.push([[null, 0], [null, 1], [null, 4], [null, 1]]);

    const result = await limiter.checkMultiple([
      { name: 'rule_a', key: 'user1' },
      { name: 'rule_b', key: 'user1' },
    ]);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('checkMultiple rejects immediately when any rule blocks', async () => {
    limiter.addRule({
      name: 'rule_a',
      windowMs: 60000,
      maxRequests: 100,
      keyType: 'user',
      onExceed: 'reject',
    });
    execResults.push([[null, 0], [null, 1], [null, 101], [null, 1]]);

    const result = await limiter.checkMultiple([
      { name: 'rule_a', key: 'user1' },
      { name: 'default', key: 'user1' },
    ]);
    expect(result.allowed).toBe(false);
  });

  it('log_only rule allows over-limit requests', async () => {
    limiter.addRule({
      name: 'soft',
      windowMs: 60000,
      maxRequests: 5,
      keyType: 'user',
      onExceed: 'log_only',
    });
    execResults.push([[null, 0], [null, 1], [null, 6], [null, 1]]);
    const result = await limiter.check('soft', 'user1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('reset deletes the Redis key', async () => {
    await limiter.reset('default', 'user1');
    expect(state.delCalls.length).toBe(1);
    expect(state.delCalls[0]).toContain('user1');
  });

  it('tracks totalHits and totalChecks in getStats', async () => {
    state.zcardResult = 1;
    await limiter.check('default', 'a');
    await limiter.check('default', 'b');

    execResults.push([[null, 0], [null, 1], [null, 11], [null, 1]]);
    await limiter.check('default', 'c');

    const stats = limiter.getStats();
    expect(stats.totalChecks).toBe(3);
    expect(stats.totalHits).toBe(1);
    expect(stats.rules).toBe(0);
  });

  it('removeRule removes a previously added rule', () => {
    limiter.addRule({
      name: 'temp',
      windowMs: 1000,
      maxRequests: 1,
      keyType: 'global',
      onExceed: 'reject',
    });
    expect(limiter.removeRule('temp')).toBe(true);
    expect(limiter.removeRule('temp')).toBe(false);
  });

  it('stop disconnects from Redis', async () => {
    await limiter.stop();
    expect(state.quitCalled).toBe(true);
  });

  it('fails open when pipeline returns null', async () => {
    mockRedisInstance.pipelineMethods.exec.mockResolvedValueOnce(null);
    const result = await limiter.check('default', 'user1');
    expect(result.allowed).toBe(true);
  });
});
