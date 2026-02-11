/**
 * Task Executor for SecureYeoman
 * 
 * Security considerations:
 * - All tasks run with timeout enforcement
 * - Resource usage is tracked and limited
 * - Pre-execution security checks
 * - Audit logging of all task operations
 */

import { uuidv7, sha256 } from '../utils/crypto.js';
import { getLogger, createNoopLogger, type SecureLogger, type LogContext } from '../logging/logger.js';
import { type AuditChain } from '../logging/audit-chain.js';
import { type InputValidator } from '../security/input-validator.js';
import { type RateLimiterLike } from '../security/rate-limiter.js';
import { getRBAC, type PermissionCheck } from '../security/rbac.js';
import {
  TaskStatus,
  TaskType,
  type Task,
  type TaskCreate,
  type ResourceUsage,
} from '@friday/shared';
import type { Sandbox, SandboxOptions } from '../sandbox/types.js';
import type { TaskStorage } from './task-storage.js';

export interface TaskExecutorConfig {
  /** Maximum concurrent tasks */
  maxConcurrent: number;
  /** Default task timeout in ms */
  defaultTimeoutMs: number;
  /** Maximum task timeout in ms */
  maxTimeoutMs: number;
}

export interface ExecutionContext {
  userId: string;
  role: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  aiClient?: import('../ai/client.js').AIClient;
}

export interface TaskHandler {
  type: TaskType;
  execute: (task: Task, context: ExecutionContext) => Promise<unknown>;
  requiredPermissions: PermissionCheck[];
}

interface TaskEntry {
  task: Task;
  context: ExecutionContext;
  startTime: number;
  abortController: AbortController;
}

/**
 * Manages task execution with security controls
 */
export class TaskExecutor {
  private readonly config: TaskExecutorConfig;
  private readonly handlers = new Map<TaskType, TaskHandler>();
  private readonly activeTasks = new Map<string, TaskEntry>();
  private readonly taskQueue: { task: Task; context: ExecutionContext; resolve: (task: Task) => void; reject: (error: Error) => void }[] = [];
  private readonly validator: InputValidator;
  private readonly rateLimiter: RateLimiterLike;
  private readonly auditChain: AuditChain;
  private readonly sandbox: Sandbox | null;
  private readonly sandboxOptions: SandboxOptions | undefined;
  private readonly taskStorage: TaskStorage | null;
  private logger: SecureLogger | null = null;
  private processing = false;

  constructor(
    config: TaskExecutorConfig,
    validator: InputValidator,
    rateLimiter: RateLimiterLike,
    auditChain: AuditChain,
    sandbox?: Sandbox,
    sandboxOptions?: SandboxOptions,
    taskStorage?: TaskStorage,
  ) {
    this.config = config;
    this.validator = validator;
    this.rateLimiter = rateLimiter;
    this.auditChain = auditChain;
    this.sandbox = sandbox ?? null;
    this.sandboxOptions = sandboxOptions;
    this.taskStorage = taskStorage ?? null;
  }
  
  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'TaskExecutor' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }
  
  /**
   * Register a task handler
   */
  registerHandler(handler: TaskHandler): void {
    this.handlers.set(handler.type, handler);
    this.getLogger().info('Task handler registered', { type: handler.type });
  }
  
  /**
   * Create and submit a task for execution
   */
  async submit(create: TaskCreate, context: ExecutionContext): Promise<Task> {
    const logContext: LogContext = {
      userId: context.userId,
      correlationId: context.correlationId,
    };
    
    // Validate input
    const inputStr = JSON.stringify(create.input);
    const validation = this.validator.validate(inputStr, {
      userId: context.userId,
      correlationId: context.correlationId,
    });
    
    if (!validation.valid) {
      await this.auditChain.record({
        event: 'task_rejected',
        level: 'warn',
        message: `Task rejected: ${validation.blockReason ?? 'validation failed'}`,
        userId: context.userId,
        correlationId: context.correlationId,
        metadata: {
          taskType: create.type,
          taskName: create.name,
          reason: validation.blockReason,
        },
      });
      
      throw new Error(`Input validation failed: ${validation.blockReason ?? 'unknown reason'}`);
    }
    
    // Check rate limit
    const rateLimitResult = await this.rateLimiter.check('task_creation', context.userId, {
      userId: context.userId,
      ipAddress: context.ipAddress,
    });
    
    if (!rateLimitResult.allowed) {
      await this.auditChain.record({
        event: 'task_rate_limited',
        level: 'warn',
        message: 'Task creation rate limited',
        userId: context.userId,
        correlationId: context.correlationId,
        metadata: {
          retryAfter: rateLimitResult.retryAfter,
        },
      });
      
      throw new Error(`Rate limited. Retry after ${String(rateLimitResult.retryAfter ?? 60)} seconds`);
    }
    
    // Check permissions
    const handler = this.handlers.get(create.type);
    if (!handler) {
      throw new Error(`No handler registered for task type: ${create.type}`);
    }
    
    const rbac = getRBAC();
    for (const permission of handler.requiredPermissions) {
      rbac.requirePermission(context.role, permission, context.userId);
    }
    
    // Create task
    const now = Date.now();
    const task: Task = {
      id: uuidv7(),
      correlationId: context.correlationId ?? uuidv7(),
      parentTaskId: create.parentTaskId,
      type: create.type,
      name: create.name,
      description: create.description,
      inputHash: sha256(inputStr),
      status: TaskStatus.PENDING,
      createdAt: now,
      timeoutMs: Math.min(
        create.timeoutMs ?? this.config.defaultTimeoutMs,
        this.config.maxTimeoutMs
      ),
      securityContext: {
        userId: context.userId,
        role: context.role,
        permissionsUsed: handler.requiredPermissions.map(p => `${p.resource}:${p.action}`),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    };
    
    // Log task creation
    this.getLogger().info('Task created', {
      ...logContext,
      taskId: task.id,
      taskType: task.type,
      taskName: task.name,
    });
    
    await this.auditChain.record({
      event: 'task_created',
      level: 'info',
      message: `Task created: ${task.name}`,
      userId: context.userId,
      taskId: task.id,
      correlationId: task.correlationId,
      metadata: {
        taskType: task.type,
        timeoutMs: task.timeoutMs,
      },
    });
    
    // Persist task
    this.taskStorage?.storeTask(task);

    // Queue for execution
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, context, resolve, reject });
      void this.processQueue();
    });
  }
  
  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      // Loop until queue is drained or at capacity — re-check after each
      // iteration so items enqueued while we were processing are not missed.
      while (this.taskQueue.length > 0 && this.activeTasks.size < this.config.maxConcurrent) {
        const item = this.taskQueue.shift();
        if (!item) break;

        const { task, context, resolve, reject } = item;

        // Execute task
        this.executeTask(task, context)
          .then(resolve)
          .catch(reject);
      }
    } finally {
      this.processing = false;

      // Re-check: items may have been enqueued while we were processing
      if (this.taskQueue.length > 0 && this.activeTasks.size < this.config.maxConcurrent) {
        void this.processQueue();
      }
    }
  }
  
  /**
   * Execute a single task
   */
  private async executeTask(task: Task, context: ExecutionContext): Promise<Task> {
    const abortController = new AbortController();
    const startTime = Date.now();
    
    // Track active task
    this.activeTasks.set(task.id, {
      task,
      context,
      startTime,
      abortController,
    });
    
    // Update status to running
    task.status = TaskStatus.RUNNING;
    task.startedAt = startTime;
    this.taskStorage?.updateTask(task.id, { status: task.status, startedAt: startTime });

    const logContext: LogContext = {
      userId: context.userId,
      taskId: task.id,
      correlationId: task.correlationId,
    };
    
    this.getLogger().info('Task started', logContext);
    
    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, task.timeoutMs);
    
    try {
      // Get handler
      const handler = this.handlers.get(task.type);
      if (!handler) {
        throw new Error(`No handler for task type: ${task.type}`);
      }
      
      // Execute with abort signal, optionally sandboxed
      const executeFn = () => handler.execute(task, context);
      const executionPromise = this.sandbox
        ? this.sandbox.run(executeFn, this.sandboxOptions).then(async (sandboxResult) => {
            // Log sandbox violations
            if (sandboxResult.violations.length > 0) {
              this.getLogger().warn('Sandbox violations during task execution', {
                ...logContext,
                violations: sandboxResult.violations.map(v => v.description),
              });
              await this.auditChain.record({
                event: 'sandbox_violation',
                level: 'warn',
                message: `Sandbox violations in task: ${task.name}`,
                userId: context.userId,
                taskId: task.id,
                correlationId: task.correlationId,
                metadata: {
                  violations: sandboxResult.violations,
                  resourceUsage: sandboxResult.resourceUsage,
                },
              });
            }
            if (!sandboxResult.success) {
              throw sandboxResult.error ?? new Error('Sandbox execution failed');
            }
            return sandboxResult.result;
          })
        : executeFn();

      const result = await Promise.race([
        executionPromise,
        new Promise((_, reject) => {
          abortController.signal.addEventListener('abort', () => {
            reject(new Error('Task timeout'));
          });
        }),
      ]);
      
      // Success
      const endTime = Date.now();
      task.status = TaskStatus.COMPLETED;
      task.completedAt = endTime;
      task.durationMs = endTime - startTime;
      task.result = {
        success: true,
        outputHash: sha256(JSON.stringify(result)),
      };
      
      // Estimate resource usage (simplified)
      task.resources = this.estimateResources(startTime, endTime);

      // Persist completion
      this.taskStorage?.updateTask(task.id, {
        status: task.status,
        completedAt: task.completedAt,
        durationMs: task.durationMs,
        result: task.result,
        resources: task.resources,
      });

      this.getLogger().info('Task completed', {
        ...logContext,
        durationMs: task.durationMs,
      });
      
      await this.auditChain.record({
        event: 'task_completed',
        level: 'info',
        message: `Task completed: ${task.name}`,
        userId: context.userId,
        taskId: task.id,
        correlationId: task.correlationId,
        metadata: {
          durationMs: task.durationMs,
          resources: task.resources,
        },
      });
      
      return task;
      
    } catch (error) {
      const endTime = Date.now();
      const isTimeout = error instanceof Error && error.message === 'Task timeout';
      
      task.status = isTimeout ? TaskStatus.TIMEOUT : TaskStatus.FAILED;
      task.completedAt = endTime;
      task.durationMs = endTime - startTime;
      task.result = {
        success: false,
        error: {
          code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          recoverable: false,
        },
      };
      
      task.resources = this.estimateResources(startTime, endTime);

      // Persist failure
      this.taskStorage?.updateTask(task.id, {
        status: task.status,
        completedAt: task.completedAt,
        durationMs: task.durationMs,
        result: task.result,
        resources: task.resources,
      });

      this.getLogger().error('Task failed', {
        ...logContext,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: task.status,
        durationMs: task.durationMs,
      });
      
      await this.auditChain.record({
        event: 'task_failed',
        level: 'error',
        message: `Task failed: ${task.name}`,
        userId: context.userId,
        taskId: task.id,
        correlationId: task.correlationId,
        metadata: {
          error: task.result.error,
          durationMs: task.durationMs,
        },
      });
      
      return task;
      
    } finally {
      clearTimeout(timeoutId);
      this.activeTasks.delete(task.id);
      
      // Process next task in queue
      void this.processQueue();
    }
  }
  
  /**
   * Cancel a running task
   */
  async cancel(taskId: string, context: ExecutionContext): Promise<boolean> {
    const entry = this.activeTasks.get(taskId);
    
    if (!entry) {
      return false;
    }
    
    // Check permission to cancel
    const rbac = getRBAC();
    rbac.requirePermission(context.role, {
      resource: 'tasks',
      action: 'cancel',
    }, context.userId);
    
    // Abort the task
    entry.abortController.abort();
    entry.task.status = TaskStatus.CANCELLED;
    
    await this.auditChain.record({
      event: 'task_cancelled',
      level: 'info',
      message: `Task cancelled: ${entry.task.name}`,
      userId: context.userId,
      taskId: taskId,
      correlationId: entry.task.correlationId,
    });
    
    return true;
  }
  
  /**
   * Get active task count
   */
  getActiveCount(): number {
    return this.activeTasks.size;
  }
  
  /**
   * Get queue depth
   */
  getQueueDepth(): number {
    return this.taskQueue.length;
  }
  
  /**
   * Estimate resource usage (simplified)
   */
  private estimateResources(startTime: number, endTime: number): ResourceUsage {
    const durationMs = endTime - startTime;
    
    return {
      tokens: {
        input: 0,
        output: 0,
        total: 0,
        cached: 0,
      },
      memoryPeakMb: process.memoryUsage().heapUsed / 1024 / 1024,
      cpuTimeMs: durationMs, // Simplified
      networkBytes: {
        sent: 0,
        received: 0,
      },
      apiCalls: [],
    };
  }
}

/**
 * Create a task executor with default configuration
 */
export function createTaskExecutor(
  validator: InputValidator,
  rateLimiter: RateLimiterLike,
  auditChain: AuditChain,
  config?: Partial<TaskExecutorConfig>,
  sandbox?: Sandbox,
  sandboxOptions?: SandboxOptions,
  taskStorage?: TaskStorage,
): TaskExecutor {
  const defaultConfig: TaskExecutorConfig = {
    maxConcurrent: 10,
    defaultTimeoutMs: 300000, // 5 minutes
    maxTimeoutMs: 3600000, // 1 hour
    ...config,
  };

  return new TaskExecutor(defaultConfig, validator, rateLimiter, auditChain, sandbox, sandboxOptions, taskStorage);
}
