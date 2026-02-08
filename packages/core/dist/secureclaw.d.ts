/**
 * SecureClaw - Main Entry Point
 *
 * The primary class that initializes and coordinates all SecureClaw components.
 *
 * Security considerations:
 * - All components are initialized in secure order
 * - Secrets are validated before startup
 * - Graceful shutdown ensures audit trail is complete
 */
import { type LoadConfigOptions } from './config/loader.js';
import { type SecureLogger } from './logging/logger.js';
import { type AuditChainStorage } from './logging/audit-chain.js';
import { type RBAC } from './security/rbac.js';
import { type TaskHandler, type ExecutionContext } from './task/executor.js';
import type { Config, TaskCreate, Task, MetricsSnapshot } from '@friday/shared';
export interface SecureClawOptions {
    /** Configuration options */
    config?: LoadConfigOptions;
    /** Custom audit storage backend */
    auditStorage?: AuditChainStorage;
}
export interface SecureClawState {
    initialized: boolean;
    healthy: boolean;
    startedAt?: number;
    config: Config;
}
/**
 * Main SecureClaw class
 */
export declare class SecureClaw {
    private readonly options;
    private config;
    private logger;
    private auditChain;
    private validator;
    private rateLimiter;
    private rbac;
    private taskExecutor;
    private initialized;
    private startedAt;
    private shutdownPromise;
    constructor(options?: SecureClawOptions);
    /**
     * Initialize SecureClaw
     * Must be called before any other operations
     */
    initialize(): Promise<void>;
    /**
     * Check if SecureClaw is initialized
     */
    isInitialized(): boolean;
    /**
     * Get current state
     */
    getState(): SecureClawState;
    /**
     * Check if all components are healthy
     */
    isHealthy(): boolean;
    /**
     * Register a task handler
     */
    registerTaskHandler(handler: TaskHandler): void;
    /**
     * Submit a task for execution
     */
    submitTask(create: TaskCreate, context: ExecutionContext): Promise<Task>;
    /**
     * Cancel a running task
     */
    cancelTask(taskId: string, context: ExecutionContext): Promise<boolean>;
    /**
     * Get current metrics snapshot
     */
    getMetrics(): Promise<Partial<MetricsSnapshot>>;
    /**
     * Verify audit chain integrity
     */
    verifyAuditChain(): Promise<{
        valid: boolean;
        entriesChecked: number;
        error?: string;
    }>;
    /**
     * Get the logger instance
     */
    getLogger(): SecureLogger;
    /**
     * Get the RBAC instance
     */
    getRBAC(): RBAC;
    /**
     * Get configuration
     */
    getConfig(): Config;
    /**
     * Graceful shutdown
     */
    shutdown(): Promise<void>;
    /**
     * Perform the actual shutdown
     */
    private performShutdown;
    /**
     * Clean up resources
     */
    private cleanup;
    /**
     * Ensure SecureClaw is initialized before operations
     */
    private ensureInitialized;
}
/**
 * Create and initialize a SecureClaw instance
 */
export declare function createSecureClaw(options?: SecureClawOptions): Promise<SecureClaw>;
//# sourceMappingURL=secureclaw.d.ts.map