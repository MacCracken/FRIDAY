/**
 * Task Executor for SecureClaw
 *
 * Security considerations:
 * - All tasks run with timeout enforcement
 * - Resource usage is tracked and limited
 * - Pre-execution security checks
 * - Audit logging of all task operations
 */
import { type AuditChain } from '../logging/audit-chain.js';
import { type InputValidator } from '../security/input-validator.js';
import { type RateLimiter } from '../security/rate-limiter.js';
import { type PermissionCheck } from '../security/rbac.js';
import { TaskType, type Task, type TaskCreate } from '@friday/shared';
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
}
export interface TaskHandler {
    type: TaskType;
    execute: (task: Task, context: ExecutionContext) => Promise<unknown>;
    requiredPermissions: PermissionCheck[];
}
/**
 * Manages task execution with security controls
 */
export declare class TaskExecutor {
    private readonly config;
    private readonly handlers;
    private readonly activeTasks;
    private readonly taskQueue;
    private readonly validator;
    private readonly rateLimiter;
    private readonly auditChain;
    private logger;
    private processing;
    constructor(config: TaskExecutorConfig, validator: InputValidator, rateLimiter: RateLimiter, auditChain: AuditChain);
    private getLogger;
    /**
     * Register a task handler
     */
    registerHandler(handler: TaskHandler): void;
    /**
     * Create and submit a task for execution
     */
    submit(create: TaskCreate, context: ExecutionContext): Promise<Task>;
    /**
     * Process the task queue
     */
    private processQueue;
    /**
     * Execute a single task
     */
    private executeTask;
    /**
     * Cancel a running task
     */
    cancel(taskId: string, context: ExecutionContext): Promise<boolean>;
    /**
     * Get active task count
     */
    getActiveCount(): number;
    /**
     * Get queue depth
     */
    getQueueDepth(): number;
    /**
     * Estimate resource usage (simplified)
     */
    private estimateResources;
}
/**
 * Create a task executor with default configuration
 */
export declare function createTaskExecutor(validator: InputValidator, rateLimiter: RateLimiter, auditChain: AuditChain, config?: Partial<TaskExecutorConfig>): TaskExecutor;
//# sourceMappingURL=executor.d.ts.map