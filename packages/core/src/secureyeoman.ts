/**
 * SecureYeoman - Main Entry Point
 * 
 * The primary class that initializes and coordinates all SecureYeoman components.
 * 
 * Security considerations:
 * - All components are initialized in secure order
 * - Secrets are validated before startup
 * - Graceful shutdown ensures audit trail is complete
 */

import { loadConfig, validateSecrets, requireSecret, initializeKeyring, type LoadConfigOptions } from './config/loader.js';
import type { KeyringManager } from './security/keyring/manager.js';
import { SecretRotationManager } from './security/rotation/manager.js';
import { RotationStorage } from './security/rotation/rotation-storage.js';
import type { SecretMetadata } from './security/rotation/types.js';
import { initializeLogger, type SecureLogger } from './logging/logger.js';
import { AuditChain, InMemoryAuditStorage, type AuditChainStorage, type AuditQueryOptions, type AuditQueryResult } from './logging/audit-chain.js';
import { SQLiteAuditStorage } from './logging/sqlite-storage.js';
import { createValidator, type InputValidator } from './security/input-validator.js';
import { createRateLimiter, type RateLimiter } from './security/rate-limiter.js';
import { initializeRBAC, type RBAC } from './security/rbac.js';
import { RBACStorage } from './security/rbac-storage.js';
import { createTaskExecutor, type TaskExecutor, type TaskHandler, type ExecutionContext } from './task/executor.js';
import { SandboxManager, type SandboxManagerConfig } from './sandbox/manager.js';
import type { SandboxOptions } from './sandbox/types.js';
import { GatewayServer, createGatewayServer } from './gateway/server.js';
import { AIClient } from './ai/client.js';
import { AuthStorage } from './security/auth-storage.js';
import { AuthService } from './security/auth.js';
import { SoulStorage } from './soul/storage.js';
import { SoulManager } from './soul/manager.js';
import { TaskStorage } from './task/task-storage.js';
import { IntegrationStorage } from './integrations/storage.js';
import { IntegrationManager } from './integrations/manager.js';
import { MessageRouter } from './integrations/message-router.js';
import type { Config, TaskCreate, Task, MetricsSnapshot } from '@friday/shared';

export interface SecureYeomanOptions {
  /** Configuration options */
  config?: LoadConfigOptions;
  /** Custom audit storage backend */
  auditStorage?: AuditChainStorage;
  /** Enable gateway server on startup */
  enableGateway?: boolean;
}

export interface SecureYeomanState {
  initialized: boolean;
  healthy: boolean;
  startedAt?: number;
  config: Config;
}

/**
 * Main SecureYeoman class
 */
export class SecureYeoman {
  private config: Config | null = null;
  private logger: SecureLogger | null = null;
  private auditChain: AuditChain | null = null;
  private auditStorage: AuditChainStorage | null = null;
  private validator: InputValidator | null = null;
  private rateLimiter: RateLimiter | null = null;
  private rbac: RBAC | null = null;
  private taskExecutor: TaskExecutor | null = null;
  private aiClient: AIClient | null = null;
  private authStorage: AuthStorage | null = null;
  private authService: AuthService | null = null;
  private gateway: GatewayServer | null = null;
  private keyringManager: KeyringManager | null = null;
  private rotationManager: SecretRotationManager | null = null;
  private rotationStorage: RotationStorage | null = null;
  private rbacStorage: RBACStorage | null = null;
  private soulStorage: SoulStorage | null = null;
  private soulManager: SoulManager | null = null;
  private integrationStorage: IntegrationStorage | null = null;
  private integrationManager: IntegrationManager | null = null;
  private messageRouter: MessageRouter | null = null;
  private sandboxManager: SandboxManager | null = null;
  private taskStorage: TaskStorage | null = null;
  private initialized = false;
  private startedAt: number | null = null;
  private shutdownPromise: Promise<void> | null = null;
  
  constructor(private readonly options: SecureYeomanOptions = {}) {}
  
  /**
   * Initialize SecureYeoman
   * Must be called before any other operations
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('SecureYeoman is already initialized');
    }
    
    try {
      // Step 1: Load and validate configuration
      this.config = loadConfig(this.options.config);
      
      // Step 2: Initialize logger first (needed for other components)
      this.logger = initializeLogger(this.config.logging);
      this.logger.info('SecureYeoman initializing', {
        environment: this.config.core.environment,
        version: this.config.version,
      });

      // Step 2.5: Initialize keyring (pre-loads secrets from system keyring)
      const knownSecretKeys = [
        this.config.gateway.auth.tokenSecret,
        this.config.gateway.auth.adminPasswordEnv,
        this.config.logging.audit.signingKeyEnv,
        this.config.security.encryption.keyEnv,
        this.config.model.apiKeyEnv,
      ];
      this.keyringManager = initializeKeyring(
        this.config.security.secretBackend,
        knownSecretKeys,
      );
      this.logger.debug('Keyring initialized', {
        backend: this.keyringManager.getProvider().name,
      });

      // Step 3: Validate secrets are available
      validateSecrets(this.config);
      this.logger.debug('Secrets validated');
      
      // Step 4: Initialize security components
      //
      // RBAC is now backed by SQLite persistent storage.  Custom role
      // definitions and user-role assignments are automatically loaded
      // from the database on construction, so roles created via the API
      // survive process restarts.  The storage file lives alongside the
      // other per-component databases in the configured data directory.
      this.rbacStorage = new RBACStorage({
        dbPath: `${this.config.core.dataDir}/rbac.db`,
      });
      this.rbac = initializeRBAC(undefined, this.rbacStorage);
      this.logger.debug('RBAC initialized with persistent storage');
      
      this.validator = createValidator(this.config.security);
      this.logger.debug('Input validator initialized');
      
      this.rateLimiter = createRateLimiter(this.config.security);
      this.logger.debug('Rate limiter initialized');
      
      // Step 5: Initialize audit chain
      const signingKey = requireSecret(this.config.logging.audit.signingKeyEnv);
      const storage = this.options.auditStorage ?? new SQLiteAuditStorage({
        dbPath: `${this.config.core.dataDir}/audit.db`,
      });
      this.auditStorage = storage;

      this.auditChain = new AuditChain({
        storage,
        signingKey,
      });
      await this.auditChain.initialize();
      this.logger.debug('Audit chain initialized');

      // Step 5.5: Initialize auth service
      this.authStorage = new AuthStorage({
        dbPath: `${this.config.core.dataDir}/auth.db`,
      });

      const tokenSecret = requireSecret(this.config.gateway.auth.tokenSecret);
      const adminPassword = requireSecret(this.config.gateway.auth.adminPasswordEnv);

      this.authService = new AuthService(
        {
          tokenSecret,
          tokenExpirySeconds: this.config.gateway.auth.tokenExpirySeconds,
          refreshTokenExpirySeconds: this.config.gateway.auth.refreshTokenExpirySeconds,
          adminPassword,
        },
        {
          storage: this.authStorage,
          auditChain: this.auditChain,
          rbac: this.rbac!,
          rateLimiter: this.rateLimiter!,
          logger: this.logger.child({ component: 'AuthService' }),
        },
      );
      this.logger.debug('Auth service initialized');

      // Step 5.55: Initialize secret rotation (if enabled)
      if (this.config.security.rotation.enabled) {
        this.rotationStorage = new RotationStorage({
          dbPath: `${this.config.core.dataDir}/rotation.db`,
        });

        this.rotationManager = new SecretRotationManager(this.rotationStorage, {
          checkIntervalMs: this.config.security.rotation.checkIntervalMs,
          warningDaysBeforeExpiry: this.config.security.rotation.warningDaysBeforeExpiry,
        });

        // Track known secrets
        const now = Date.now();
        const tokenRotDays = this.config.security.rotation.tokenRotationIntervalDays;
        const signingRotDays = this.config.security.rotation.signingKeyRotationIntervalDays;

        const secretDefs: SecretMetadata[] = [
          {
            name: this.config.gateway.auth.tokenSecret,
            createdAt: now, expiresAt: now + tokenRotDays * 86_400_000,
            rotatedAt: null, rotationIntervalDays: tokenRotDays,
            autoRotate: true, source: 'internal', category: 'jwt',
          },
          {
            name: this.config.logging.audit.signingKeyEnv,
            createdAt: now, expiresAt: now + signingRotDays * 86_400_000,
            rotatedAt: null, rotationIntervalDays: signingRotDays,
            autoRotate: true, source: 'internal', category: 'audit_signing',
          },
          {
            name: this.config.gateway.auth.adminPasswordEnv,
            createdAt: now, expiresAt: null,
            rotatedAt: null, rotationIntervalDays: null,
            autoRotate: false, source: 'external', category: 'admin',
          },
          {
            name: this.config.security.encryption.keyEnv,
            createdAt: now, expiresAt: null,
            rotatedAt: null, rotationIntervalDays: null,
            autoRotate: false, source: 'external', category: 'encryption',
          },
        ];

        for (const def of secretDefs) {
          this.rotationManager.trackSecret(def);
        }

        // Wire rotation callbacks
        const authSvc = this.authService!;
        const auditCh = this.auditChain!;
        const tokenSecretEnv = this.config.gateway.auth.tokenSecret;
        const signingKeyEnv = this.config.logging.audit.signingKeyEnv;

        this.rotationManager.setCallbacks({
          onRotate: async (name, newValue) => {
            if (name === tokenSecretEnv) {
              authSvc.updateTokenSecret(newValue);
            } else if (name === signingKeyEnv) {
              await auditCh.updateSigningKey(newValue);
            }
          },
          onWarning: (name, daysLeft) => {
            this.logger?.warn('Secret expiring soon', { name, daysLeft });
          },
        });

        this.rotationManager.start();
        this.logger.debug('Secret rotation manager started');
      }

      // Step 5.6: Initialize AI client
      try {
        this.aiClient = new AIClient(
          {
            model: this.config.model,
            retryConfig: {
              maxRetries: this.config.model.maxRetries,
              baseDelayMs: this.config.model.retryDelayMs,
            },
          },
          {
            auditChain: this.auditChain,
            logger: this.logger.child({ component: 'AIClient' }),
          },
        );
        this.logger.debug('AI client initialized', { provider: this.config.model.provider });
      } catch (error) {
        // AI client failure is non-fatal — the system can run without AI
        this.logger.warn('AI client initialization failed (non-fatal)', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Step 5.7: Initialize soul system
      this.soulStorage = new SoulStorage({
        dbPath: `${this.config.core.dataDir}/soul.db`,
      });
      this.soulManager = new SoulManager(
        this.soulStorage,
        this.config.soul,
        {
          auditChain: this.auditChain,
          logger: this.logger.child({ component: 'SoulManager' }),
        },
      );
      if (this.soulManager.needsOnboarding()) {
        if (!this.soulManager.getAgentName()) {
          this.soulManager.setAgentName('FRIDAY');
        }
        this.soulManager.createDefaultPersonality();
        this.logger.debug('Soul default personality created (onboarding)');
      }
      this.logger.debug('Soul manager initialized');

      // Step 5.75: Initialize integration system
      this.integrationStorage = new IntegrationStorage({
        dbPath: `${this.config.core.dataDir}/integrations.db`,
      });
      // IntegrationManager + MessageRouter are fully wired after task executor
      // is available (see post-step-6 below). For now just store the storage.
      this.logger.debug('Integration storage initialized');

      // Step 5.8: Initialize sandbox manager
      const sandboxConfig: SandboxManagerConfig = {
        enabled: this.config.security.sandbox.enabled,
        technology: this.config.security.sandbox.technology,
        allowedReadPaths: this.config.security.sandbox.allowedReadPaths,
        allowedWritePaths: this.config.security.sandbox.allowedWritePaths,
        maxMemoryMb: this.config.security.sandbox.maxMemoryMb,
        maxCpuPercent: this.config.security.sandbox.maxCpuPercent,
        maxFileSizeMb: this.config.security.sandbox.maxFileSizeMb,
        networkAllowed: this.config.security.sandbox.networkAllowed,
      };
      this.sandboxManager = new SandboxManager(sandboxConfig, {
        logger: this.logger.child({ component: 'SandboxManager' }),
        auditChain: this.auditChain,
      });
      const sandboxCaps = this.sandboxManager.detect();
      this.logger.debug('Sandbox manager initialized', {
        enabled: this.sandboxManager.isEnabled(),
        capabilities: sandboxCaps,
      });

      // Step 5.9: Initialize task storage
      this.taskStorage = new TaskStorage({
        dbPath: `${this.config.core.dataDir}/tasks.db`,
      });
      this.logger.debug('Task storage initialized');

      // Step 6: Initialize task executor
      const sandbox = this.sandboxManager.createSandbox();
      const sandboxOpts: SandboxOptions = {
        filesystem: {
          readPaths: sandboxConfig.allowedReadPaths,
          writePaths: sandboxConfig.allowedWritePaths,
          execPaths: [],
        },
        resources: {
          maxMemoryMb: sandboxConfig.maxMemoryMb,
          maxCpuPercent: sandboxConfig.maxCpuPercent,
          maxFileSizeMb: sandboxConfig.maxFileSizeMb,
        },
        network: {
          allowed: sandboxConfig.networkAllowed,
        },
      };
      this.taskExecutor = createTaskExecutor(
        this.validator,
        this.rateLimiter,
        this.auditChain,
        undefined,
        sandbox,
        sandboxOpts,
        this.taskStorage,
      );
      this.logger.debug('Task executor initialized');

      // Step 6.5: Wire up IntegrationManager + MessageRouter (needs taskExecutor)
      this.integrationManager = new IntegrationManager(this.integrationStorage!, {
        logger: this.logger.child({ component: 'IntegrationManager' }),
        onMessage: async (msg) => {
          await this.messageRouter!.handleInbound(msg);
        },
      });
      this.messageRouter = new MessageRouter({
        logger: this.logger.child({ component: 'MessageRouter' }),
        taskExecutor: this.taskExecutor!,
        integrationManager: this.integrationManager,
        integrationStorage: this.integrationStorage!,
      });
      this.logger.debug('Integration manager and message router initialized');

      // Step 7: Record initialization in audit log
      await this.auditChain.record({
        event: 'system_initialized',
        level: 'info',
        message: 'SecureYeoman initialized successfully',
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
      
      this.logger.info('SecureYeoman initialized successfully', {
        environment: this.config.core.environment,
        gatewayEnabled: this.options.enableGateway ?? false,
      });
      
    } catch (error) {
      // Log initialization failure if logger is available
      if (this.logger) {
        this.logger.fatal('SecureYeoman initialization failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      
      // Clean up any partially initialized components
      await this.cleanup();
      
      throw error;
    }
  }
  
  /**
   * Check if SecureYeoman is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Get current state
   */
  getState(): SecureYeomanState {
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
    
    // Gather statistics from each subsystem to build a comprehensive
    // metrics snapshot. Each subsystem exposes its own getStats() method
    // that returns monotonically increasing counters and point-in-time
    // gauges. We merge them into the unified MetricsSnapshot shape that
    // the dashboard consumes via REST and WebSocket.
    const auditStats = await this.auditChain!.getStats();
    const rateLimitStats = this.rateLimiter!.getStats();
    const aiStats = this.aiClient?.getUsageStats();
    const taskStats = this.taskStorage?.getStats();

    return {
      timestamp: Date.now(),
      tasks: {
        total: taskStats?.total ?? 0,
        byStatus: taskStats?.byStatus ?? {},
        byType: taskStats?.byType ?? {},
        successRate: taskStats?.successRate ?? 0,
        failureRate: taskStats ? 1 - taskStats.successRate : 0,
        avgDurationMs: taskStats?.avgDurationMs ?? 0,
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
        tokensUsedToday: aiStats?.tokensUsedToday ?? 0,
        tokensCachedToday: aiStats?.tokensCachedToday ?? 0,
        costUsdToday: aiStats?.costUsdToday ?? 0,
        costUsdMonth: aiStats?.costUsdMonth ?? 0,
        apiCallsTotal: aiStats?.apiCallsTotal ?? 0,
        apiErrorsTotal: aiStats?.apiErrorsTotal ?? 0,
        apiLatencyAvgMs: aiStats && aiStats.apiCallCount > 0
          ? aiStats.apiLatencyTotalMs / aiStats.apiCallCount
          : 0,
      },
      security: {
        authAttemptsTotal: 0,
        authSuccessTotal: 0,
        authFailuresTotal: 0,
        activeSessions: 0,
        permissionChecksTotal: 0,
        permissionDenialsTotal: 0,
        // blockedRequestsTotal now reflects actual rate-limiter rejections
        // rather than a hardcoded zero. The totalHits counter in the rate
        // limiter is monotonically increasing and survives cleanup cycles.
        blockedRequestsTotal: rateLimitStats.totalHits,
        // rateLimitHitsTotal mirrors blockedRequestsTotal for backwards
        // compatibility — both draw from the same underlying counter.
        rateLimitHitsTotal: rateLimitStats.totalHits,
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
   * Query audit log entries
   */
  async queryAuditLog(options: AuditQueryOptions = {}): Promise<AuditQueryResult> {
    this.ensureInitialized();
    if (!this.auditStorage || !('query' in this.auditStorage) || typeof (this.auditStorage as Record<string, unknown>).query !== 'function') {
      throw new Error('Audit storage does not support querying');
    }
    return (this.auditStorage as { query(opts: AuditQueryOptions): Promise<AuditQueryResult> }).query(options);
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
   * Get the audit chain instance
   */
  getAuditChain(): AuditChain {
    this.ensureInitialized();
    return this.auditChain!;
  }

  /**
   * Get the rate limiter instance
   */
  getRateLimiter(): RateLimiter {
    this.ensureInitialized();
    return this.rateLimiter!;
  }

  /**
   * Get the auth service instance
   */
  getAuthService(): AuthService {
    this.ensureInitialized();
    if (!this.authService) {
      throw new Error('Auth service is not available');
    }
    return this.authService;
  }

  /**
   * Get the AI client instance
   */
  getAIClient(): AIClient {
    this.ensureInitialized();
    if (!this.aiClient) {
      throw new Error('AI client is not available. Check provider configuration and API keys.');
    }
    return this.aiClient;
  }

  /**
   * Get the soul manager instance
   */
  getSoulManager(): SoulManager {
    this.ensureInitialized();
    if (!this.soulManager) {
      throw new Error('Soul manager is not available');
    }
    return this.soulManager;
  }

  /**
   * Get the sandbox manager instance
   */
  getSandboxManager(): SandboxManager {
    this.ensureInitialized();
    if (!this.sandboxManager) {
      throw new Error('Sandbox manager is not available');
    }
    return this.sandboxManager;
  }

  /**
   * Get the task storage instance
   */
  getTaskStorage(): TaskStorage {
    this.ensureInitialized();
    if (!this.taskStorage) {
      throw new Error('Task storage is not available');
    }
    return this.taskStorage;
  }

  /**
   * Get the integration manager instance
   */
  getIntegrationManager(): IntegrationManager {
    this.ensureInitialized();
    if (!this.integrationManager) {
      throw new Error('Integration manager is not available');
    }
    return this.integrationManager;
  }

  /**
   * Get the integration storage instance
   */
  getIntegrationStorage(): IntegrationStorage {
    this.ensureInitialized();
    if (!this.integrationStorage) {
      throw new Error('Integration storage is not available');
    }
    return this.integrationStorage;
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
      secureYeoman: this,
      authService: this.authService ?? undefined,
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
    
    this.logger?.info('SecureYeoman shutting down');
    
    try {
      // Record shutdown in audit log
      if (this.auditChain) {
        await this.auditChain.record({
          event: 'system_shutdown',
          level: 'info',
          message: 'SecureYeoman shutdown initiated',
          metadata: {
            uptime: this.startedAt ? Date.now() - this.startedAt : 0,
          },
        });
      }
      
      // Clean up components
      await this.cleanup();
      
      this.logger?.info('SecureYeoman shutdown complete');
      
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
    
    // Clear RBAC cache and close persistent storage
    if (this.rbac) {
      this.rbac.clearCache();
    }
    if (this.rbacStorage) {
      this.rbacStorage.close();
      this.rbacStorage = null;
    }

    // Stop rotation manager
    if (this.rotationManager) {
      this.rotationManager.stop();
      this.rotationManager = null;
    }
    if (this.rotationStorage) {
      this.rotationStorage.close();
      this.rotationStorage = null;
    }

    // Close task storage
    if (this.taskStorage) {
      this.taskStorage.close();
      this.taskStorage = null;
    }

    // Close integration manager + storage
    if (this.integrationManager) {
      await this.integrationManager.close();
      this.integrationManager = null;
      this.messageRouter = null;
    } else if (this.integrationStorage) {
      this.integrationStorage.close();
    }
    this.integrationStorage = null;

    // Close soul storage
    if (this.soulStorage) {
      this.soulStorage.close();
      this.soulStorage = null;
      this.soulManager = null;
    }

    // Close auth storage
    if (this.authStorage) {
      this.authStorage.close();
      this.authStorage = null;
      this.authService = null;
    }

    // Close audit storage if it supports closing
    if (this.auditStorage && 'close' in this.auditStorage && typeof (this.auditStorage as Record<string, unknown>).close === 'function') {
      (this.auditStorage as { close(): void }).close();
      this.auditStorage = null;
    }
  }
  
  /**
   * Ensure SecureYeoman is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('SecureYeoman is not initialized. Call initialize() first.');
    }
  }
}

/**
 * Create and initialize a SecureYeoman instance
 */
export async function createSecureYeoman(options?: SecureYeomanOptions): Promise<SecureYeoman> {
  const secureYeoman = new SecureYeoman(options);
  await secureYeoman.initialize();
  return secureYeoman;
}
