/**
 * LinuxSandbox — Linux sandbox with filesystem path validation and resource tracking.
 *
 * V1 implements a "soft sandbox":
 * - Filesystem access is validated against an allowlist (read/write/exec paths)
 * - Violations are detected and logged but do not kill the task by default
 * - Resource usage (memory, CPU time) is tracked
 * - Landlock kernel availability is detected and reported in capabilities
 *
 * V2 will add kernel-level Landlock enforcement via child process forking.
 */

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxOptions,
  SandboxResult,
  SandboxViolation,
} from './types.js';

export class LinuxSandbox implements Sandbox {
  private capabilities: SandboxCapabilities | null = null;
  private logger: SecureLogger | null = null;

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'LinuxSandbox' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  async run<T>(fn: () => Promise<T>, opts?: SandboxOptions): Promise<SandboxResult<T>> {
    const violations: SandboxViolation[] = [];
    const startTime = Date.now();
    const memBefore = process.memoryUsage().heapUsed;

    // Pre-execution: validate filesystem options are sane
    if (opts?.filesystem) {
      this.validatePathConfig(opts.filesystem, violations);
    }

    // Track resource limits
    const resourceLimits = opts?.resources;
    let memoryCheckInterval: NodeJS.Timeout | null = null;
    let peakMemoryBytes = memBefore;

    if (resourceLimits?.maxMemoryMb) {
      memoryCheckInterval = setInterval(() => {
        const current = process.memoryUsage().heapUsed;
        if (current > peakMemoryBytes) {
          peakMemoryBytes = current;
        }
        const currentMb = current / 1024 / 1024;
        if (resourceLimits.maxMemoryMb && currentMb > resourceLimits.maxMemoryMb) {
          violations.push({
            type: 'resource',
            description: `Memory usage ${currentMb.toFixed(1)}MB exceeds limit ${String(resourceLimits.maxMemoryMb)}MB`,
            timestamp: Date.now(),
          });
        }
      }, 100);
      memoryCheckInterval.unref();
    }

    try {
      const result = await fn();
      const endTime = Date.now();
      const cpuTimeMs = endTime - startTime;

      // Check CPU time limit
      if (resourceLimits?.maxCpuPercent && opts?.timeoutMs) {
        const maxCpuMs = opts.timeoutMs * (resourceLimits.maxCpuPercent / 100);
        if (cpuTimeMs > maxCpuMs) {
          violations.push({
            type: 'resource',
            description: `CPU time ${String(cpuTimeMs)}ms exceeds ${String(resourceLimits.maxCpuPercent)}% of timeout (${String(maxCpuMs)}ms)`,
            timestamp: Date.now(),
          });
        }
      }

      const memAfter = process.memoryUsage().heapUsed;
      if (memAfter > peakMemoryBytes) {
        peakMemoryBytes = memAfter;
      }

      if (violations.length > 0) {
        this.getLogger().warn('Sandbox violations detected during execution', {
          violationCount: violations.length,
          violations: violations.map((v) => v.description),
        });
      }

      return {
        success: true,
        result,
        resourceUsage: {
          memoryPeakMb: peakMemoryBytes / 1024 / 1024,
          cpuTimeMs,
        },
        violations,
      };
    } catch (error) {
      const endTime = Date.now();
      const memAfter = process.memoryUsage().heapUsed;
      if (memAfter > peakMemoryBytes) {
        peakMemoryBytes = memAfter;
      }

      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        resourceUsage: {
          memoryPeakMb: peakMemoryBytes / 1024 / 1024,
          cpuTimeMs: endTime - startTime,
        },
        violations,
      };
    } finally {
      if (memoryCheckInterval) {
        clearInterval(memoryCheckInterval);
      }
    }
  }

  getCapabilities(): SandboxCapabilities {
    if (!this.capabilities) {
      this.capabilities = this.detectCapabilities();
    }
    return this.capabilities;
  }

  isAvailable(): boolean {
    return process.platform === 'linux';
  }

  /**
   * Check whether a given path is allowed under the provided sandbox options.
   * Returns a violation if the path is not covered by any allowlist entry.
   */
  validatePath(
    filePath: string,
    mode: 'read' | 'write' | 'exec',
    opts: NonNullable<SandboxOptions['filesystem']>
  ): SandboxViolation | null {
    const resolved = path.resolve(filePath);
    const allowedPaths =
      mode === 'read' ? opts.readPaths : mode === 'write' ? opts.writePaths : opts.execPaths;

    for (const allowed of allowedPaths) {
      const resolvedAllowed = path.resolve(allowed);
      if (resolved === resolvedAllowed || resolved.startsWith(resolvedAllowed + path.sep)) {
        return null;
      }
    }

    return {
      type: 'filesystem',
      description: `${mode} access to "${resolved}" is not in the allowlist`,
      path: resolved,
      timestamp: Date.now(),
    };
  }

  private validatePathConfig(
    fs: NonNullable<SandboxOptions['filesystem']>,
    violations: SandboxViolation[]
  ): void {
    // Check for path traversal in configured paths
    const allPaths = [...fs.readPaths, ...fs.writePaths, ...fs.execPaths];
    for (const p of allPaths) {
      if (p.includes('..') || p.includes('\0')) {
        violations.push({
          type: 'filesystem',
          description: `Suspicious path in sandbox config: "${p}"`,
          path: p,
          timestamp: Date.now(),
        });
      }
    }
  }

  private detectCapabilities(): SandboxCapabilities {
    const caps: SandboxCapabilities = {
      landlock: false,
      seccomp: false,
      namespaces: false,
      rlimits: false,
      platform: 'linux',
    };

    // Detect Landlock support
    try {
      if (existsSync('/proc/sys/kernel/landlock_restrict_self')) {
        caps.landlock = true;
      } else {
        // Fallback: check kernel version (Landlock available since 5.13)
        const version = readFileSync('/proc/version', 'utf-8');
        const match = version.match(/Linux version (\d+)\.(\d+)/);
        if (match) {
          const majorStr = match[1];
          const minorStr = match[2];
          if (majorStr && minorStr) {
            const major = parseInt(majorStr, 10);
            const minor = parseInt(minorStr, 10);
            if (major > 5 || (major === 5 && minor >= 13)) {
              caps.landlock = true;
            }
          }
        }
      }
    } catch {
      // Not on Linux or /proc not available
    }

    // Detect namespace support
    try {
      caps.namespaces = existsSync('/proc/self/ns/user');
    } catch {
      // Ignore
    }

    // rlimits are always available on Linux
    caps.rlimits = true;

    return caps;
  }
}
