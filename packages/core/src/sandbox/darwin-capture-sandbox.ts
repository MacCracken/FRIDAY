/**
 * Darwin (macOS) Capture Sandbox
 *
 * Specialized sandbox for screen capture on macOS using seatbelt profiles.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see ADR 017: Sandboxed Execution
 * @see NEXT_STEP_05: Sandboxing
 */

import { platform } from 'node:os';
import type { SecureLogger } from '../logging/logger.js';
import {
  type CaptureSandboxConfig,
  type CaptureSandboxResult,
  type CaptureSandboxViolation,
  DEFAULT_CAPTURE_SANDBOX,
} from './capture-sandbox.js';

export class DarwinCaptureSandbox {
  private config: CaptureSandboxConfig;
  private logger: SecureLogger;
  private violations: CaptureSandboxViolation[] = [];
  private initialized = false;

  constructor(config: Partial<CaptureSandboxConfig> = {}) {
    this.config = { ...DEFAULT_CAPTURE_SANDBOX, ...config };

    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'DarwinCaptureSandbox' });
    } catch {
      this.logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => this.logger,
        level: 'info',
      };
    }
  }

  isAvailable(): boolean {
    return platform() === 'darwin';
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('DarwinCaptureSandbox is only available on macOS');
    }

    this.logger.info(
      {
        maxMemory: this.config.maxMemory,
        maxCpuPercent: this.config.maxCpuPercent,
        maxDuration: this.config.maxDuration,
        allowNetwork: this.config.allowNetwork,
        syscallPolicy: this.config.syscallPolicy,
      },
      'Initializing Darwin capture sandbox'
    );

    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConfig(): CaptureSandboxConfig {
    return { ...this.config };
  }

  async run<T>(fn: () => Promise<T>): Promise<CaptureSandboxResult<T>> {
    if (!this.initialized) {
      await this.initialize();
    }

    const _startTime = Date.now();
    this.violations = [];

    try {
      const result = await fn();

      return {
        success: true,
        result,
        violations: this.violations,
      };
    } catch (error) {
      this.logger.error({ error }, 'Capture sandbox error');

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        violations: this.violations,
      };
    }
  }

  recordViolation(violation: CaptureSandboxViolation): void {
    this.violations.push(violation);
    this.logger.warn({ ...violation }, 'Sandbox violation');
  }

  generateSeatbeltProfile(): string {
    const lines = [
      '(version 1)',
      '',
      '; Default deny all',
      '(deny default)',
      '',
      '; Allow basic process operations',
      '(allow process-exec (with no-sandbox))',
      '(allow process-fork)',
      '',
      '; File system - read only system paths',
      '(allow file-read*',
      '  (subpath "/usr")',
      '  (subpath "/System")',
      '  (subpath "/Library")',
      '  (subpath "/private/var/db/dyld"))',
      '',
      '; Temp directory access for capture',
      '(allow file-read* file-write*',
      '  (subpath "/tmp")',
      '  (regex #"^/tmp/capture-.*$"))',
      '',
      '; Block sensitive areas',
      '(deny file-read* file-write*',
      '  (subpath "/etc")',
      '  (subpath "/Users")',
      '  (subpath "/private/var/root")',
      '  (subpath "/private/var/Users"))',
      '',
    ];

    if (this.config.allowNetwork) {
      lines.push('; Network allowed');
      lines.push('(allow network*');
      if (this.config.allowedHosts?.length) {
        lines.push(`  (host "${this.config.allowedHosts.join('" "')}"))`);
      } else {
        lines.push('  (remote-ip "*"))');
      }
    } else {
      lines.push('; Network - deny all');
      lines.push('(deny network*)');
    }

    lines.push('');
    lines.push('; Display/Graphics access for capture');
    lines.push('(allow iokit-open-service');
    lines.push('  (iokit-registry-entry-class "IOFramebuffer"))');
    lines.push('');
    lines.push('; CoreGraphics for screen capture');
    lines.push('(allow user-preference-read');
    lines.push('  (preference-domain "com.apple.coregraphics"))');
    lines.push('');
    lines.push('; Mach IPC - restrict to known services');
    lines.push('(allow mach-lookup');
    lines.push('  (global-name "com.apple.coregraphics"))');

    return lines.join('\n');
  }

  validatePath(path: string, mode: 'read' | 'write' | 'exec'): boolean {
    for (const blocked of this.config.blockedPaths) {
      if (path.startsWith(blocked) || path === blocked) {
        this.recordViolation({
          type: 'filesystem',
          description: `Access to blocked path: ${path}`,
          path,
          timestamp: Date.now(),
          severity: 'high',
        });
        return false;
      }
    }

    if (mode === 'write') {
      for (const pattern of this.config.writePaths) {
        if (this.matchPathPattern(path, pattern)) {
          return true;
        }
      }

      this.recordViolation({
        type: 'filesystem',
        description: `Write to non-temp path: ${path}`,
        path,
        timestamp: Date.now(),
        severity: 'medium',
      });
      return false;
    }

    for (const allowed of this.config.allowedPaths) {
      if (path.startsWith(allowed) || path === allowed) {
        return true;
      }
    }

    this.recordViolation({
      type: 'filesystem',
      description: `Read of non-allowed path: ${path}`,
      path,
      timestamp: Date.now(),
      severity: 'low',
    });
    return false;
  }

  private matchPathPattern(path: string, pattern: string): boolean {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return path.startsWith(prefix);
    }
    return path === pattern;
  }

  checkResourceLimits(usage: { memoryMb?: number; cpuPercent?: number }): boolean {
    if (usage.memoryMb && usage.memoryMb > this.config.maxMemory) {
      this.recordViolation({
        type: 'resource',
        description: `Memory limit exceeded: ${usage.memoryMb}MB > ${this.config.maxMemory}MB`,
        timestamp: Date.now(),
        severity: 'critical',
      });
      return false;
    }

    if (usage.cpuPercent && usage.cpuPercent > this.config.maxCpuPercent) {
      this.recordViolation({
        type: 'resource',
        description: `CPU limit exceeded: ${usage.cpuPercent}% > ${this.config.maxCpuPercent}%`,
        timestamp: Date.now(),
        severity: 'high',
      });
      return false;
    }

    return true;
  }

  getViolations(): CaptureSandboxViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }
}

export function createCaptureSandbox(config?: Partial<CaptureSandboxConfig>): DarwinCaptureSandbox {
  return new DarwinCaptureSandbox(config);
}
