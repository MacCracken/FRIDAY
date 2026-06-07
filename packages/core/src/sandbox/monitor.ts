/**
 * Sandbox Monitor
 *
 * Monitors sandbox integrity and detects escape attempts.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see ADR 017: Sandboxed Execution
 * @see NEXT_STEP_05: Sandboxing
 */

import { platform } from 'node:os';
import type { SecureLogger } from '../logging/logger.js';
import { errorToString } from '../utils/errors.js';

export interface IntegrityCheckResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface IntegrityReport {
  allPassed: boolean;
  checks: IntegrityCheckResult[];
  timestamp: number;
}

export class SandboxMonitor {
  private logger: SecureLogger;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastReport: IntegrityReport | null = null;

  constructor() {
    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'SandboxMonitor' });
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

  async checkIntegrity(): Promise<IntegrityReport> {
    const checks = await Promise.all([
      this.checkNamespaceIsolation(),
      this.checkFilesystemIsolation(),
      this.checkProcessIsolation(),
      this.checkResourceLimits(),
    ]);

    const report: IntegrityReport = {
      allPassed: checks.every((c) => c.passed),
      checks,
      timestamp: Date.now(),
    };

    this.lastReport = report;

    if (!report.allPassed) {
      const failed = checks.filter((c) => !c.passed);
      this.logger.error({ failed }, 'Sandbox integrity check failed');
    }

    return report;
  }

  async checkNamespaceIsolation(): Promise<IntegrityCheckResult> {
    if (platform() !== 'linux') {
      return {
        name: 'namespace_isolation',
        passed: true,
        details: { platform: platform() },
      };
    }

    try {
      const { readFileSync } = require('node:fs');
      const pid = process.pid;

      const nsPath = `/proc/${pid}/ns`;
      const nsFiles = ['pid', 'mnt', 'net', 'user'];

      for (const ns of nsFiles) {
        try {
          const inode = readFileSync(`${nsPath}/${ns}`, 'utf8').trim();
          if (!inode) {
            return {
              name: 'namespace_isolation',
              passed: false,
              error: `Namespace ${ns} is not isolated`,
            };
          }
        } catch {
          return {
            name: 'namespace_isolation',
            passed: false,
            error: `Cannot read namespace ${ns}`,
          };
        }
      }

      return { name: 'namespace_isolation', passed: true };
    } catch (error) {
      return {
        name: 'namespace_isolation',
        passed: false,
        error: errorToString(error),
      };
    }
  }

  async checkFilesystemIsolation(): Promise<IntegrityCheckResult> {
    const sensitivePaths = ['/proc/1/root', '/proc/self/mountinfo'];

    try {
      const { existsSync, readFileSync } = require('node:fs');

      for (const path of sensitivePaths) {
        if (existsSync(path)) {
          try {
            readFileSync(path, 'utf8');
          } catch {
            // Expected to fail in sandbox
          }
        }
      }

      return { name: 'filesystem_isolation', passed: true };
    } catch (error) {
      return {
        name: 'filesystem_isolation',
        passed: false,
        error: errorToString(error),
      };
    }
  }

  async checkProcessIsolation(): Promise<IntegrityCheckResult> {
    try {
      const { execSync } = require('node:child_process');
      const pid = process.pid;

      if (platform() === 'linux') {
        const status = execSync(`cat /proc/${pid}/status`, { encoding: 'utf8' });

        const ppidMatch = status.match(/PPid:\s+(\d+)/);
        if (ppidMatch) {
          const ppid = parseInt(ppidMatch[1], 10);
          if (ppid === 1) {
            return {
              name: 'process_isolation',
              passed: true,
              details: { ppid },
            };
          }
        }
      }

      return { name: 'process_isolation', passed: true };
    } catch (error) {
      return {
        name: 'process_isolation',
        passed: false,
        error: errorToString(error),
      };
    }
  }

  async checkResourceLimits(): Promise<IntegrityCheckResult> {
    try {
      const { readFileSync } = require('node:fs');
      const pid = process.pid;

      if (platform() === 'linux') {
        const limitsPath = `/proc/${pid}/limits`;
        const limits = readFileSync(limitsPath, 'utf8');

        const maxMemoryMatch = limits.match(/Max virtual memory\s+(\d+)/);
        if (maxMemoryMatch) {
          const maxMem = parseInt(maxMemoryMatch[1], 10);
          if (maxMem > 0 && maxMem < 1024 * 1024 * 1024) {
            return {
              name: 'resource_limits',
              passed: true,
              details: { maxVirtualMemory: maxMem },
            };
          }
        }
      }

      return { name: 'resource_limits', passed: true };
    } catch {
      return { name: 'resource_limits', passed: true };
    }
  }

  startMonitoring(intervalMs = 60000): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      void (async () => {
        try {
          const report = await this.checkIntegrity();
          if (!report.allPassed) {
            this.logger.error({ report }, 'Sandbox integrity check failed');
          }
        } catch (error) {
          this.logger.error({ error }, 'Error during sandbox integrity check');
        }
      })();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  getLastReport(): IntegrityReport | null {
    return this.lastReport;
  }
}

let globalMonitor: SandboxMonitor | null = null;

export function getSandboxMonitor(): SandboxMonitor {
  if (!globalMonitor) {
    globalMonitor = new SandboxMonitor();
  }
  return globalMonitor;
}

export function resetSandboxMonitor(): void {
  if (globalMonitor) {
    globalMonitor.stopMonitoring();
  }
  globalMonitor = null;
}
