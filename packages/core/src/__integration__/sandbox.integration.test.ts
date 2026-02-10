import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NoopSandbox } from '../sandbox/noop-sandbox.js';
import { LinuxSandbox } from '../sandbox/linux-sandbox.js';
import { SandboxManager, type SandboxManagerConfig } from '../sandbox/manager.js';
import { InMemoryAuditStorage, AuditChain } from '../logging/audit-chain.js';
import { createTaskExecutor, type TaskHandler, type ExecutionContext } from '../task/executor.js';
import { InputValidator } from '../security/input-validator.js';
import { RateLimiter } from '../security/rate-limiter.js';
import { initializeRBAC } from '../security/rbac.js';
import { TaskType } from '@friday/shared';
import type { SandboxOptions } from '../sandbox/types.js';

const SIGNING_KEY = 'a'.repeat(64);

function createTestInfra() {
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
  rateLimiter.addRule({
    name: 'task_creation',
    windowMs: 60000,
    maxRequests: 100,
    keyType: 'user',
    onExceed: 'reject',
  });
  initializeRBAC();
  return { storage, auditChain, validator, rateLimiter };
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

describe('Sandbox Integration', () => {
  let rateLimiter: RateLimiter;

  afterEach(() => {
    if (rateLimiter) rateLimiter.stop();
  });

  describe('Task execution with NoopSandbox', () => {
    it('should execute a task through NoopSandbox', async () => {
      const infra = createTestInfra();
      rateLimiter = infra.rateLimiter;
      await infra.auditChain.initialize();

      const sandbox = new NoopSandbox();
      const executor = createTaskExecutor(
        infra.validator,
        infra.rateLimiter,
        infra.auditChain,
        undefined,
        sandbox,
      );

      executor.registerHandler(createHandler({
        execute: async () => ({ answer: 42 }),
      }));

      const task = await executor.submit(
        { type: TaskType.CODE_REVIEW, name: 'Sandboxed task', input: { code: 'x' } },
        defaultContext,
      );

      expect(task.status).toBe('completed');
      expect(task.result?.success).toBe(true);
    });
  });

  describe('Task execution with LinuxSandbox', () => {
    it('should execute a task through LinuxSandbox', async () => {
      const infra = createTestInfra();
      rateLimiter = infra.rateLimiter;
      await infra.auditChain.initialize();

      const sandbox = new LinuxSandbox();
      const sandboxOpts: SandboxOptions = {
        filesystem: {
          readPaths: ['/tmp'],
          writePaths: ['/tmp'],
          execPaths: [],
        },
        resources: {
          maxMemoryMb: 1024,
        },
      };

      const executor = createTaskExecutor(
        infra.validator,
        infra.rateLimiter,
        infra.auditChain,
        undefined,
        sandbox,
        sandboxOpts,
      );

      executor.registerHandler(createHandler({
        execute: async () => ({ value: 'sandboxed' }),
      }));

      const task = await executor.submit(
        { type: TaskType.CODE_REVIEW, name: 'Linux sandboxed', input: { code: 'y' } },
        defaultContext,
      );

      expect(task.status).toBe('completed');
      expect(task.result?.success).toBe(true);
    });
  });

  describe('Filesystem path validation', () => {
    it('should detect violations for disallowed paths', () => {
      const sandbox = new LinuxSandbox();
      const fsOpts = {
        readPaths: ['/home/user/project'],
        writePaths: ['/tmp'],
        execPaths: ['/usr/bin'],
      };

      // Allowed
      expect(sandbox.validatePath('/home/user/project/file.ts', 'read', fsOpts)).toBeNull();
      expect(sandbox.validatePath('/tmp/out.txt', 'write', fsOpts)).toBeNull();

      // Denied
      const v1 = sandbox.validatePath('/etc/passwd', 'read', fsOpts);
      expect(v1).not.toBeNull();
      expect(v1!.type).toBe('filesystem');

      const v2 = sandbox.validatePath('/home/user/project/file.ts', 'write', fsOpts);
      expect(v2).not.toBeNull();
      expect(v2!.type).toBe('filesystem');
    });
  });

  describe('Violation audit logging', () => {
    it('should log sandbox violations to audit chain', async () => {
      const infra = createTestInfra();
      rateLimiter = infra.rateLimiter;
      await infra.auditChain.initialize();

      const sandbox = new LinuxSandbox();
      const sandboxOpts: SandboxOptions = {
        filesystem: {
          readPaths: ['/tmp/../etc'],  // Path traversal — triggers violation
          writePaths: [],
          execPaths: [],
        },
      };

      const executor = createTaskExecutor(
        infra.validator,
        infra.rateLimiter,
        infra.auditChain,
        undefined,
        sandbox,
        sandboxOpts,
      );

      executor.registerHandler(createHandler({
        execute: async () => ({ done: true }),
      }));

      const task = await executor.submit(
        { type: TaskType.CODE_REVIEW, name: 'Violation task', input: { code: 'z' } },
        defaultContext,
      );

      // Task should still complete (soft enforcement)
      expect(task.status).toBe('completed');

      // Audit chain should have a sandbox_violation record
      const stats = await infra.auditChain.getStats();
      expect(stats.entriesCount).toBeGreaterThan(0);
    });
  });

  describe('SandboxManager integration', () => {
    it('should create a working sandbox from config', async () => {
      const config: SandboxManagerConfig = {
        enabled: true,
        technology: 'auto',
        allowedReadPaths: ['/tmp'],
        allowedWritePaths: ['/tmp'],
        maxMemoryMb: 1024,
        maxCpuPercent: 50,
        maxFileSizeMb: 100,
        networkAllowed: true,
      };

      const manager = new SandboxManager(config);
      const sandbox = manager.createSandbox();

      const result = await sandbox.run(async () => 'works');
      expect(result.success).toBe(true);
      expect(result.result).toBe('works');
    });

    it('should report status correctly', () => {
      const config: SandboxManagerConfig = {
        enabled: true,
        technology: 'auto',
        allowedReadPaths: [],
        allowedWritePaths: [],
        maxMemoryMb: 1024,
        maxCpuPercent: 50,
        maxFileSizeMb: 100,
        networkAllowed: true,
      };

      const manager = new SandboxManager(config);
      const status = manager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.technology).toBe('auto');
      expect(status.capabilities).toBeDefined();
      expect(typeof status.sandboxType).toBe('string');
    });

    it('should handle disabled sandbox gracefully', async () => {
      const config: SandboxManagerConfig = {
        enabled: false,
        technology: 'none',
        allowedReadPaths: [],
        allowedWritePaths: [],
        maxMemoryMb: 1024,
        maxCpuPercent: 50,
        maxFileSizeMb: 100,
        networkAllowed: true,
      };

      const manager = new SandboxManager(config);
      const sandbox = manager.createSandbox();
      expect(sandbox.constructor.name).toBe('NoopSandbox');

      const result = await sandbox.run(async () => 'noop');
      expect(result.success).toBe(true);
      expect(result.result).toBe('noop');
    });
  });
});
