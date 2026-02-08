/**
 * Task Executor for SecureClaw
 *
 * Security considerations:
 * - All tasks run with timeout enforcement
 * - Resource usage is tracked and limited
 * - Pre-execution security checks
 * - Audit logging of all task operations
 */
import { uuidv7, sha256 } from '../utils/crypto.js';
import { getLogger } from '../logging/logger.js';
import { getRBAC } from '../security/rbac.js';
import { TaskStatus, } from '@friday/shared';
/**
 * Manages task execution with security controls
 */
export class TaskExecutor {
    config;
    handlers = new Map();
    activeTasks = new Map();
    taskQueue = [];
    validator;
    rateLimiter;
    auditChain;
    logger = null;
    processing = false;
    constructor(config, validator, rateLimiter, auditChain) {
        this.config = config;
        this.validator = validator;
        this.rateLimiter = rateLimiter;
        this.auditChain = auditChain;
    }
    getLogger() {
        if (!this.logger) {
            try {
                this.logger = getLogger().child({ component: 'TaskExecutor' });
            }
            catch {
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
     * Register a task handler
     */
    registerHandler(handler) {
        this.handlers.set(handler.type, handler);
        this.getLogger().info('Task handler registered', { type: handler.type });
    }
    /**
     * Create and submit a task for execution
     */
    async submit(create, context) {
        const logContext = {
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
                message: `Task rejected: ${validation.blockReason}`,
                userId: context.userId,
                correlationId: context.correlationId,
                metadata: {
                    taskType: create.type,
                    taskName: create.name,
                    reason: validation.blockReason,
                },
            });
            throw new Error(`Input validation failed: ${validation.blockReason}`);
        }
        // Check rate limit
        const rateLimitResult = this.rateLimiter.check('task_creation', context.userId, {
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
            throw new Error(`Rate limited. Retry after ${rateLimitResult.retryAfter} seconds`);
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
        const task = {
            id: uuidv7(),
            correlationId: context.correlationId ?? uuidv7(),
            parentTaskId: create.parentTaskId,
            type: create.type,
            name: create.name,
            description: create.description,
            inputHash: sha256(inputStr),
            status: TaskStatus.PENDING,
            createdAt: now,
            timeoutMs: Math.min(create.timeoutMs ?? this.config.defaultTimeoutMs, this.config.maxTimeoutMs),
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
        // Queue for execution
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ task, context, resolve, reject });
            this.processQueue();
        });
    }
    /**
     * Process the task queue
     */
    async processQueue() {
        if (this.processing) {
            return;
        }
        this.processing = true;
        try {
            while (this.taskQueue.length > 0 && this.activeTasks.size < this.config.maxConcurrent) {
                const item = this.taskQueue.shift();
                if (!item)
                    break;
                const { task, context, resolve, reject } = item;
                // Execute task
                this.executeTask(task, context)
                    .then(resolve)
                    .catch(reject);
            }
        }
        finally {
            this.processing = false;
        }
    }
    /**
     * Execute a single task
     */
    async executeTask(task, context) {
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
        const logContext = {
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
            // Execute with abort signal
            const result = await Promise.race([
                handler.execute(task, context),
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
        }
        catch (error) {
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
        }
        finally {
            clearTimeout(timeoutId);
            this.activeTasks.delete(task.id);
            // Process next task in queue
            this.processQueue();
        }
    }
    /**
     * Cancel a running task
     */
    async cancel(taskId, context) {
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
    getActiveCount() {
        return this.activeTasks.size;
    }
    /**
     * Get queue depth
     */
    getQueueDepth() {
        return this.taskQueue.length;
    }
    /**
     * Estimate resource usage (simplified)
     */
    estimateResources(startTime, endTime) {
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
export function createTaskExecutor(validator, rateLimiter, auditChain, config) {
    const defaultConfig = {
        maxConcurrent: 10,
        defaultTimeoutMs: 300000, // 5 minutes
        maxTimeoutMs: 3600000, // 1 hour
        ...config,
    };
    return new TaskExecutor(defaultConfig, validator, rateLimiter, auditChain);
}
//# sourceMappingURL=executor.js.map