/**
 * NoopSandbox — Fallback sandbox that applies no restrictions.
 *
 * Used when sandboxing is disabled or the platform has no sandbox support.
 * Logs a warning on first use so operators know tasks are running unrestricted.
 */

import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type { Sandbox, SandboxCapabilities, SandboxOptions, SandboxResult } from './types.js';

export class NoopSandbox implements Sandbox {
  private warned = false;
  private logger: SecureLogger | null = null;

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'NoopSandbox' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  async run<T>(fn: () => Promise<T>, _opts?: SandboxOptions): Promise<SandboxResult<T>> {
    if (!this.warned) {
      this.warned = true;
      this.getLogger().warn('Sandbox is disabled — tasks are running without restrictions');
    }

    const startTime = Date.now();
    const memBefore = process.memoryUsage().heapUsed;

    try {
      const result = await fn();
      const endTime = Date.now();
      const memAfter = process.memoryUsage().heapUsed;

      return {
        success: true,
        result,
        resourceUsage: {
          memoryPeakMb: Math.max(memBefore, memAfter) / 1024 / 1024,
          cpuTimeMs: endTime - startTime,
        },
        violations: [],
      };
    } catch (error) {
      const endTime = Date.now();
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        resourceUsage: {
          memoryPeakMb: process.memoryUsage().heapUsed / 1024 / 1024,
          cpuTimeMs: endTime - startTime,
        },
        violations: [],
      };
    }
  }

  getCapabilities(): SandboxCapabilities {
    return {
      landlock: false,
      seccomp: false,
      namespaces: false,
      rlimits: false,
      platform: 'other',
    };
  }

  isAvailable(): boolean {
    return true; // Always available (it's a passthrough)
  }
}
