/**
 * SandboxManager — Factory and lifecycle manager for sandbox instances.
 *
 * Detects platform capabilities, creates the appropriate Sandbox
 * implementation based on config and capabilities, and exposes
 * status information for health endpoints.
 */

import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type { AuditChain } from '../logging/audit-chain.js';
import type { Sandbox, SandboxCapabilities } from './types.js';
import { NoopSandbox } from './noop-sandbox.js';
import { LinuxSandbox } from './linux-sandbox.js';

export interface SandboxManagerConfig {
  enabled: boolean;
  technology: 'auto' | 'seccomp' | 'landlock' | 'none';
  allowedReadPaths: string[];
  allowedWritePaths: string[];
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxFileSizeMb: number;
  networkAllowed: boolean;
}

export interface SandboxManagerDeps {
  logger?: SecureLogger;
  auditChain?: AuditChain;
}

export class SandboxManager {
  private readonly config: SandboxManagerConfig;
  private readonly deps: SandboxManagerDeps;
  private sandbox: Sandbox | null = null;
  private capabilities: SandboxCapabilities | null = null;
  private logger: SecureLogger | null = null;

  constructor(config: SandboxManagerConfig, deps: SandboxManagerDeps = {}) {
    this.config = config;
    this.deps = deps;
  }

  private getLogger(): SecureLogger {
    if (this.deps.logger) return this.deps.logger;
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'SandboxManager' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  /**
   * Detect platform sandbox capabilities.
   */
  detect(): SandboxCapabilities {
    if (this.capabilities) return this.capabilities;

    const platform = process.platform;
    const platformKey: SandboxCapabilities['platform'] =
      platform === 'linux' ? 'linux' :
      platform === 'darwin' ? 'darwin' :
      platform === 'win32' ? 'win32' :
      'other';

    if (platformKey === 'linux') {
      const linux = new LinuxSandbox();
      this.capabilities = linux.getCapabilities();
    } else {
      this.capabilities = {
        landlock: false,
        seccomp: false,
        namespaces: false,
        rlimits: false,
        platform: platformKey,
      };
    }

    this.getLogger().info('Sandbox capabilities detected', {
      ...this.capabilities,
    });

    return this.capabilities;
  }

  /**
   * Create the appropriate sandbox implementation based on config and capabilities.
   */
  createSandbox(): Sandbox {
    if (this.sandbox) return this.sandbox;

    if (!this.config.enabled || this.config.technology === 'none') {
      this.getLogger().info('Sandbox disabled by configuration');
      this.sandbox = new NoopSandbox();
      return this.sandbox;
    }

    const caps = this.detect();

    if (this.config.technology === 'auto') {
      if (caps.platform === 'linux') {
        this.getLogger().info('Using Linux sandbox (soft enforcement)');
        this.sandbox = new LinuxSandbox();
        return this.sandbox;
      }
      // No sandbox available for this platform
      this.getLogger().warn('No sandbox available for platform, falling back to NoopSandbox', {
        platform: caps.platform,
      });
      this.sandbox = new NoopSandbox();
      return this.sandbox;
    }

    if (this.config.technology === 'landlock') {
      if (caps.platform !== 'linux') {
        this.getLogger().warn('Landlock requested but not on Linux, falling back to NoopSandbox');
        this.sandbox = new NoopSandbox();
        return this.sandbox;
      }
      this.sandbox = new LinuxSandbox();
      return this.sandbox;
    }

    // seccomp or other — not yet implemented, fall back
    this.getLogger().warn('Requested sandbox technology not implemented, falling back to NoopSandbox', {
      technology: this.config.technology,
    });
    this.sandbox = new NoopSandbox();
    return this.sandbox;
  }

  /**
   * Get sandbox capabilities.
   */
  getCapabilities(): SandboxCapabilities {
    return this.detect();
  }

  /**
   * Get the sandbox config.
   */
  getConfig(): SandboxManagerConfig {
    return this.config;
  }

  /**
   * Whether sandboxing is enabled in config.
   */
  isEnabled(): boolean {
    return this.config.enabled && this.config.technology !== 'none';
  }

  /**
   * Get status info for the /api/v1/sandbox/status endpoint.
   */
  getStatus(): {
    enabled: boolean;
    technology: string;
    capabilities: SandboxCapabilities;
    sandboxType: string;
  } {
    const sandbox = this.createSandbox();
    return {
      enabled: this.isEnabled(),
      technology: this.config.technology,
      capabilities: this.getCapabilities(),
      sandboxType: sandbox.constructor.name,
    };
  }
}
