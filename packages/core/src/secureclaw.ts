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

import { loadConfig, validateSecrets, requireSecret, type LoadConfigOptions } from './config/loader.js';
import { initializeLogger, getLogger, type SecureLogger } from './logging/logger.js';
import { AuditChain, InMemoryAuditStorage, type AuditChainStorage } from './logging/audit-chain.js';
import { createValidator, type InputValidator } from './security/input-validator.js';
import { createRateLimiter, type RateLimiter } from './security/rate-limiter.js';
import { initializeRBAC, getRBAC, type RBAC } from './security/rbac.js';
import { createTaskExecutor, type TaskExecutor, type TaskHandler, type ExecutionContext } from './task/executor.js';
import { GatewayServer, createGatewayServer } from './gateway/server.js';
import type { Config, TaskCreate, Task, MetricsSnapshot } from '@friday/shared';

export interface SecureClawOptions {
  /** Configuration options */
  config?: LoadConfigOptions;
  /** Custom audit storage backend */
  auditStorage?: AuditChainStorage;
  /** Enable gateway server on startup */
  enableGateway?: boolean;
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
export class SecureClaw {
  private config: Config | null = null;
  private logger: SecureLogger | null = null;
  private auditChain: AuditChain | null = null;
  private validator: InputValidator | null = null;
  private rateLimiter: RateLimiter | null = null;
  private rbac: RBAC | null = null;
  private taskExecutor: TaskExecutor | null = null;
  private gateway: GatewayServer | null = null;
  private initialized = false;
  private startedAt: number | null = null;
  private shutdownPromise: Promise<void> | null = null;
  
  constructor(private readonly options: SecureClawOptions = {}) {}
  
  /**
   * Initialize SecureClaw
   * Must be called before any other operations
   */
  async initialize(): Promise<void> {
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
      this.taskExecutor = createTaskExecutor(
        this.validator,
        this.rateLimiter,
        this.auditChain
      );
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
      
      // Step 8: Start gateway if enabled
      if (this.options.enableGateway) {
        await this.startGateway();
      }
      
      this.logger.info('SecureClaw initialized successfully', {
        environment: this.config.core.environment,
        gatewayEnabled: this.options.enableGateway ?? false,
      });
      
    } catch (error) {
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
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Get current state
   */
  getState(): SecureClawState {
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
  isHealthy(): boolean {
    if (!this.initialized) {
      return false;
    }
    
    // Add more health checks as needed
    return true;
  }
  
  /**
   * Register a task handler
   */
  registerTaskHandler(handler: TaskHandler): void {
    this.ensureInitialized();
    this.taskExecutor!.registerHandler(handler);
  }
  
  /**
   * Submit a task for execution
   */
  async submitTask(create: TaskCreate, context: ExecutionContext): Promise<Task> {
    this.ensureInitialized();
    return this.taskExecutor!.submit(create, context);
  }
  
  /**
   * Cancel a running task
   */
  async cancelTask(taskId: string, context: ExecutionContext): Promise<boolean> {
    this.ensureInitialized();
    return this.taskExecutor!.cancel(taskId, context);
  }
  
  /**
   * Get current metrics snapshot
   */
  async getMetrics(): Promise<Partial<MetricsSnapshot>> {
    this.ensureInitialized();
    
    const auditStats = await this.auditChain!.getStats();
    const rateLimitStats = this.rateLimiter!.getStats();
    
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
        queueDepth: this.taskExecutor!.getQueueDepth(),
        inProgress: this.taskExecutor!.getActiveCount(),
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
  async verifyAuditChain(): Promise<{ valid: boolean; entriesChecked: number; error?: string }> {
    this.ensureInitialized();
    return this.auditChain!.verify();
  }
  
  /**
   * Get the logger instance
   */
  getLogger(): SecureLogger {
    this.ensureInitialized();
    return this.logger!;
  }
  
  /**
   * Get the RBAC instance
   */
  getRBAC(): RBAC {
    this.ensureInitialized();
    return this.rbac!;
  }
  
  /**
   * Get configuration
   */
  getConfig(): Config {
    this.ensureInitialized();
    return this.config!;
  }
  
  /**
   * Get the gateway server instance
   */
  getGateway(): GatewayServer | null {
    return this.gateway;
  }
  
  /**
   * Start the gateway server
   */
  async startGateway(): Promise<void> {
    this.ensureInitialized();
    
    if (this.gateway) {
      throw new Error('Gateway is already running');
    }
    
    this.gateway = createGatewayServer({
      config: this.config!.gateway,
      secureClaw: this,
    });
    
    await this.gateway.start();
    
    this.logger!.info('Gateway server started', {
      host: this.config!.gateway.host,
      port: this.config!.gateway.port,
    });
    
    await this.auditChain!.record({
      event: 'gateway_started',
      level: 'info',
      message: 'Gateway server started',
      metadata: {
        host: this.config!.gateway.host,
        port: this.config!.gateway.port,
      },
    });
  }
  
  /**
   * Stop the gateway server
   */
  async stopGateway(): Promise<void> {
    if (!this.gateway) {
      return;
    }
    
    await this.gateway.stop();
    this.gateway = null;
    
    this.logger?.info('Gateway server stopped');
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }
  
  /**
   * Perform the actual shutdown
   */
  private async performShutdown(): Promise<void> {
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
      
    } catch (error) {
      this.logger?.error('Error during shutdown', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.initialized = false;
    }
  }
  
  /**
   * Clean up resources
   */
  private async cleanup(): Promise<void> {
    // Stop gateway server
    if (this.gateway) {
      await this.gateway.stop();
      this.gateway = null;
    }
    
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
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SecureClaw is not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create and initialize a SecureClaw instance
 */
export async function createSecureClaw(options?: SecureClawOptions): Promise<SecureClaw> {
  const secureClaw = new SecureClaw(options);
  await secureClaw.initialize();
  return secureClaw;
}
