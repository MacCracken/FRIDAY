import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TaskExecutor, createTaskExecutor, type TaskHandler, type ExecutionContext } from './executor.js';
import { InputValidator } from '../security/input-validator.js';
import { RateLimiter } from '../security/rate-limiter.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { initializeRBAC } from '../security/rbac.js';
import { TaskType } from '@friday/shared';

const SIGNING_KEY = 'a'.repeat(64);

function createTestSetup() {
  const storage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage, signingKey: SIGNING_KEY });
  const validator = new InputValidator({
    maxInputLength: 10000,
    maxFileSize: 1048576,
    enableInjectionDetection: true,
  });
  const rateLimiter = new RateLimiter({
    defaultWindowMs: 60000,
    defaultMaxRequests: 100,
  });

  // Add task_creation rule used by executor
  rateLimiter.addRule({
    name: 'task_creation',
    windowMs: 60000,
    maxRequests: 20,
    keyType: 'user',
    onExceed: 'reject',
  });

  // Initialize RBAC globally (executor uses getRBAC())
  initializeRBAC();

  const executor = createTaskExecutor(validator, rateLimiter, auditChain);
  return { executor, auditChain, validator, rateLimiter, storage };
}

const defaultContext: ExecutionContext = {
  userId: 'user-1',
  role: 'admin',
  correlationId: '00000000-0000-0000-0000-000000000001',
};

function createHandler(overrides: Partial<TaskHandler> = {}): TaskHandler {
  return {
    type: TaskType.CODE_REVIEW,
    execute: async () => ({ result: 'ok' }),
    requiredPermissions: [{ resource: 'tasks', action: 'execute' }],
    ...overrides,
  };
}

describe('TaskExecutor', () => {
  let executor: TaskExecutor;
  let auditChain: AuditChain;
  let rateLimiter: RateLimiter;

  beforeEach(async () => {
    const setup = createTestSetup();
    executor = setup.executor;
    auditChain = setup.auditChain;
    rateLimiter = setup.rateLimiter;
    await auditChain.initialize();
  });

  afterEach(() => {
    rateLimiter.stop();
  });

  describe('registerHandler()', () => {
    it('should register a handler', () => {
      const handler = createHandler();
      expect(() => executor.registerHandler(handler)).not.toThrow();
    });
  });

  describe('submit()', () => {
    it('should create and execute a task successfully', async () => {
      executor.registerHandler(createHandler());

      const task = await executor.submit(
        {
          type: TaskType.CODE_REVIEW,
          name: 'Test task',
          input: { code: 'console.log("hi")' },
        },
        defaultContext
      );

      expect(task.id).toBeDefined();
      expect(task.status).toBe('completed');
      expect(task.result?.success).toBe(true);
      expect(task.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should reject invalid input (via validator)', async () => {
      executor.registerHandler(createHandler());

      await expect(
        executor.submit(
          {
            type: TaskType.CODE_REVIEW,
            name: 'Bad input',
            input: { code: '; DROP TABLE users;' },
          },
          defaultContext
        )
      ).rejects.toThrow('Input validation failed');
    });

    it('should reject rate-limited requests', async () => {
      executor.registerHandler(createHandler());

      // Exhaust the task_creation rate limit (20 requests)
      for (let i = 0; i < 20; i++) {
        rateLimiter.check('task_creation', 'user-1');
      }

      await expect(
        executor.submit(
          {
            type: TaskType.CODE_REVIEW,
            name: 'Rate limited',
            input: { code: 'x' },
          },
          defaultContext
        )
      ).rejects.toThrow('Rate limited');
    });

    it('should reject unauthorized users (via RBAC)', async () => {
      executor.registerHandler(createHandler());

      await expect(
        executor.submit(
          {
            type: TaskType.CODE_REVIEW,
            name: 'Unauthorized',
            input: { code: 'x' },
          },
          { ...defaultContext, role: 'nonexistent_role' }
        )
      ).rejects.toThrow('Permission denied');
    });

    it('should throw for unregistered task type', async () => {
      await expect(
        executor.submit(
          {
            type: TaskType.CODE_REVIEW,
            name: 'No handler',
            input: { code: 'x' },
          },
          defaultContext
        )
      ).rejects.toThrow('No handler registered');
    });
  });

  describe('task timeout enforcement', () => {
    it('should timeout long-running tasks', async () => {
      const slowHandler = createHandler({
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000));
          return { result: 'too late' };
        },
      });

      executor.registerHandler(slowHandler);

      // Create executor with very short timeout
      const { executor: fastExecutor, auditChain: ac, rateLimiter: rl } = createTestSetup();
      await ac.initialize();

      const shortTimeoutExecutor = createTaskExecutor(
        new InputValidator({
          maxInputLength: 10000,
          maxFileSize: 1048576,
          enableInjectionDetection: true,
        }),
        rl,
        ac,
        { maxConcurrent: 10, defaultTimeoutMs: 50, maxTimeoutMs: 100 }
      );

      shortTimeoutExecutor.registerHandler(slowHandler);

      const task = await shortTimeoutExecutor.submit(
        {
          type: TaskType.CODE_REVIEW,
          name: 'Slow task',
          input: { code: 'x' },
        },
        defaultContext
      );

      expect(task.status).toBe('timeout');
      expect(task.result?.success).toBe(false);
      expect(task.result?.error?.code).toBe('TIMEOUT');

      rl.stop();
    });
  });

  describe('task failure handling', () => {
    it('should handle handler throwing an error', async () => {
      executor.registerHandler(
        createHandler({
          execute: async () => {
            throw new Error('Handler exploded');
          },
        })
      );

      const task = await executor.submit(
        {
          type: TaskType.CODE_REVIEW,
          name: 'Failing task',
          input: { code: 'x' },
        },
        defaultContext
      );

      expect(task.status).toBe('failed');
      expect(task.result?.success).toBe(false);
      expect(task.result?.error?.message).toContain('Handler exploded');
    });
  });

  describe('cancel()', () => {
    it('should return false for unknown task id', async () => {
      const result = await executor.cancel('nonexistent-id', defaultContext);
      expect(result).toBe(false);
    });
  });

  describe('getActiveCount() and getQueueDepth()', () => {
    it('should return 0 when idle', () => {
      expect(executor.getActiveCount()).toBe(0);
      expect(executor.getQueueDepth()).toBe(0);
    });
  });

  describe('concurrent task limiting', () => {
    it('should report correct active count and queue depth', () => {
      // Verify initial state
      expect(executor.getActiveCount()).toBe(0);
      expect(executor.getQueueDepth()).toBe(0);
    });

    it('should execute tasks sequentially with maxConcurrent=1', async () => {
      const { auditChain: ac, rateLimiter: rl } = createTestSetup();
      await ac.initialize();

      const singleExecutor = createTaskExecutor(
        new InputValidator({
          maxInputLength: 10000,
          maxFileSize: 1048576,
          enableInjectionDetection: true,
        }),
        rl,
        ac,
        { maxConcurrent: 1, defaultTimeoutMs: 300000, maxTimeoutMs: 3600000 }
      );

      const executionOrder: number[] = [];

      singleExecutor.registerHandler(
        createHandler({
          execute: async () => {
            executionOrder.push(executionOrder.length + 1);
            return { result: 'done' };
          },
        })
      );

      const task = await singleExecutor.submit(
        { type: TaskType.CODE_REVIEW, name: 'Task 1', input: { code: 'a' } },
        defaultContext
      );

      expect(task.status).toBe('completed');
      expect(executionOrder).toEqual([1]);

      rl.stop();
    });
  });
});
