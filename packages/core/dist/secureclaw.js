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
import { loadConfig, validateSecrets, requireSecret } from './config/loader.js';
import { initializeLogger } from './logging/logger.js';
import { AuditChain, InMemoryAuditStorage } from './logging/audit-chain.js';
import { createValidator } from './security/input-validator.js';
import { createRateLimiter } from './security/rate-limiter.js';
import { initializeRBAC } from './security/rbac.js';
import { createTaskExecutor } from './task/executor.js';
/**
 * Main SecureClaw class
 */
export class SecureClaw {
    options;
    config = null;
    logger = null;
    auditChain = null;
    validator = null;
    rateLimiter = null;
    rbac = null;
    taskExecutor = null;
    initialized = false;
    startedAt = null;
    shutdownPromise = null;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Initialize SecureClaw
     * Must be called before any other operations
     */
    async initialize() {
        if (this.initialized) {
            throw new Error('SecureClaw is already initialized');
        }
        try {
            // Step 1: Load and validate configuration
            this.config = loadConfig(this.options.config);
            // Step 2: Initialize logger first (needed for other components)
            this.logger = initializeLogger(this.config.logging);
            this.logger.info('SecureClaw initializing', {
                environment: this.config.core.environment,
                version: this.config.version,
            });
            // Step 3: Validate secrets are available
            validateSecrets(this.config);
            this.logger.debug('Secrets validated');
            // Step 4: Initialize security components
            this.rbac = initializeRBAC();
            this.logger.debug('RBAC initialized');
            this.validator = createValidator(this.config.security);
            this.logger.debug('Input validator initialized');
            this.rateLimiter = createRateLimiter(this.config.security);
            this.logger.debug('Rate limiter initialized');
            // Step 5: Initialize audit chain
            const signingKey = requireSecret(this.config.logging.audit.signingKeyEnv);
            const storage = this.options.auditStorage ?? new InMemoryAuditStorage();
            this.auditChain = new AuditChain({
                storage,
                signingKey,
            });
            await this.auditChain.initialize();
            this.logger.debug('Audit chain initialized');
            // Step 6: Initialize task executor
            this.taskExecutor = createTaskExecutor(this.validator, this.rateLimiter, this.auditChain);
            this.logger.debug('Task executor initialized');
            // Step 7: Record initialization in audit log
            await this.auditChain.record({
                event: 'system_initialized',
                level: 'info',
                message: 'SecureClaw initialized successfully',
                metadata: {
                    environment: this.config.core.environment,
                    version: this.config.version,
                },
            });
            this.initialized = true;
            this.startedAt = Date.now();
            this.logger.info('SecureClaw initialized successfully', {
                environment: this.config.core.environment,
            });
        }
        catch (error) {
            // Log initialization failure if logger is available
            if (this.logger) {
                this.logger.fatal('SecureClaw initialization failed', {
                    error: error instanceof Error ? error.message : 'Unknown error',
                });
            }
            // Clean up any partially initialized components
            await this.cleanup();
            throw error;
        }
    }
    /**
     * Check if SecureClaw is initialized
     */
    isInitialized() {
        return this.initialized;
    }
    /**
     * Get current state
     */
    getState() {
        return {
            initialized: this.initialized,
            healthy: this.isHealthy(),
            startedAt: this.startedAt ?? undefined,
            config: this.config ?? loadConfig(this.options.config),
        };
    }
    /**
     * Check if all components are healthy
     */
    isHealthy() {
        if (!this.initialized) {
            return false;
        }
        // Add more health checks as needed
        return true;
    }
    /**
     * Register a task handler
     */
    registerTaskHandler(handler) {
        this.ensureInitialized();
        this.taskExecutor.registerHandler(handler);
    }
    /**
     * Submit a task for execution
     */
    async submitTask(create, context) {
        this.ensureInitialized();
        return this.taskExecutor.submit(create, context);
    }
    /**
     * Cancel a running task
     */
    async cancelTask(taskId, context) {
        this.ensureInitialized();
        return this.taskExecutor.cancel(taskId, context);
    }
    /**
     * Get current metrics snapshot
     */
    async getMetrics() {
        this.ensureInitialized();
        const auditStats = await this.auditChain.getStats();
        const rateLimitStats = this.rateLimiter.getStats();
        return {
            timestamp: Date.now(),
            tasks: {
                total: 0, // TODO: Implement task history
                byStatus: {},
                byType: {},
                successRate: 0,
                failureRate: 0,
                avgDurationMs: 0,
                minDurationMs: 0,
                maxDurationMs: 0,
                p50DurationMs: 0,
                p95DurationMs: 0,
                p99DurationMs: 0,
                queueDepth: this.taskExecutor.getQueueDepth(),
                inProgress: this.taskExecutor.getActiveCount(),
            },
            resources: {
                cpuPercent: 0,
                memoryUsedMb: process.memoryUsage().heapUsed / 1024 / 1024,
                memoryLimitMb: 0,
                memoryPercent: 0,
                diskUsedMb: 0,
                tokensUsedToday: 0,
                tokensCachedToday: 0,
                costUsdToday: 0,
                costUsdMonth: 0,
                apiCallsTotal: 0,
                apiErrorsTotal: 0,
                apiLatencyAvgMs: 0,
            },
            security: {
                authAttemptsTotal: 0,
                authSuccessTotal: 0,
                authFailuresTotal: 0,
                activeSessions: 0,
                permissionChecksTotal: 0,
                permissionDenialsTotal: 0,
                blockedRequestsTotal: 0,
                rateLimitHitsTotal: 0,
                injectionAttemptsTotal: 0,
                eventsBySeverity: {},
                eventsByType: {},
                auditEntriesTotal: auditStats.entriesCount,
                auditChainValid: auditStats.chainValid,
                lastAuditVerification: auditStats.lastVerification,
            },
        };
    }
    /**
     * Verify audit chain integrity
     */
    async verifyAuditChain() {
        this.ensureInitialized();
        return this.auditChain.verify();
    }
    /**
     * Get the logger instance
     */
    getLogger() {
        this.ensureInitialized();
        return this.logger;
    }
    /**
     * Get the RBAC instance
     */
    getRBAC() {
        this.ensureInitialized();
        return this.rbac;
    }
    /**
     * Get configuration
     */
    getConfig() {
        this.ensureInitialized();
        return this.config;
    }
    /**
     * Graceful shutdown
     */
    async shutdown() {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }
        this.shutdownPromise = this.performShutdown();
        return this.shutdownPromise;
    }
    /**
     * Perform the actual shutdown
     */
    async performShutdown() {
        if (!this.initialized) {
            return;
        }
        this.logger?.info('SecureClaw shutting down');
        try {
            // Record shutdown in audit log
            if (this.auditChain) {
                await this.auditChain.record({
                    event: 'system_shutdown',
                    level: 'info',
                    message: 'SecureClaw shutdown initiated',
                    metadata: {
                        uptime: this.startedAt ? Date.now() - this.startedAt : 0,
                    },
                });
            }
            // Clean up components
            await this.cleanup();
            this.logger?.info('SecureClaw shutdown complete');
        }
        catch (error) {
            this.logger?.error('Error during shutdown', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
        finally {
            this.initialized = false;
        }
    }
    /**
     * Clean up resources
     */
    async cleanup() {
        // Stop rate limiter cleanup
        if (this.rateLimiter) {
            this.rateLimiter.stop();
        }
        // Clear RBAC cache
        if (this.rbac) {
            this.rbac.clearCache();
        }
    }
    /**
     * Ensure SecureClaw is initialized before operations
     */
    ensureInitialized() {
        if (!this.initialized) {
            throw new Error('SecureClaw is not initialized. Call initialize() first.');
        }
    }
}
/**
 * Create and initialize a SecureClaw instance
 */
export async function createSecureClaw(options) {
    const secureClaw = new SecureClaw(options);
    await secureClaw.initialize();
    return secureClaw;
}
//# sourceMappingURL=secureclaw.js.map