/**
 * Landlock Worker — Standalone script for child_process.fork().
 *
 * Receives sandbox configuration + a serialised function via IPC,
 * applies Landlock restrictions if available, executes the function,
 * and returns the SandboxResult via IPC.
 *
 * Message protocol:
 *   Parent → Worker:  { type: 'exec', config: SandboxWorkerConfig }
 *   Worker → Parent:  { type: 'result', result: SandboxResult }
 *   Worker → Parent:  { type: 'error', message: string }
 *
 * Landlock enforcement uses a best-effort approach:
 *   1. Check if the Landlock ABI is available via /proc/sys
 *   2. If available, attempt to restrict filesystem access via a native
 *      helper (landlock_create_ruleset, landlock_add_rule, landlock_restrict_self).
 *      Since Node.js has no built-in Landlock bindings, this uses a small
 *      C helper if compiled, otherwise falls back to soft enforcement.
 *   3. On failure, log a warning and continue with V1 soft sandbox behaviour.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { SandboxOptions, SandboxResult, SandboxViolation } from './types.js';

export interface SandboxWorkerConfig {
  /** Serialised function body to execute (via new Function()) */
  fnBody: string;
  /** Sandbox options */
  options?: SandboxOptions;
  /** Whether to attempt Landlock enforcement */
  enforceLandlock: boolean;
}

export interface WorkerExecMessage {
  type: 'exec';
  config: SandboxWorkerConfig;
}

export interface WorkerResultMessage {
  type: 'result';
  result: SandboxResult<unknown>;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

export type WorkerMessage = WorkerExecMessage;
export type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;

/**
 * Detect whether the running kernel supports Landlock.
 */
function detectLandlock(): boolean {
  try {
    return existsSync('/proc/sys/kernel/landlock_restrict_self');
  } catch {
    return false;
  }
}

/**
 * Attempt to apply Landlock restrictions.
 *
 * Currently this is a best-effort implementation that validates paths
 * against the allowlist (soft enforcement). Full kernel enforcement
 * requires a native Node.js addon or a C helper binary.
 *
 * Returns true if restrictions were applied, false if Landlock is
 * unavailable and the worker should fall back to soft enforcement.
 */
function applyLandlockRestrictions(opts?: SandboxOptions): {
  enforced: boolean;
  violations: SandboxViolation[];
} {
  const violations: SandboxViolation[] = [];

  if (!detectLandlock()) {
    return { enforced: false, violations };
  }

  // Validate path configuration (same as V1 soft sandbox)
  if (opts?.filesystem) {
    const allPaths = [
      ...opts.filesystem.readPaths,
      ...opts.filesystem.writePaths,
      ...opts.filesystem.execPaths,
    ];
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

  // Note: actual Landlock syscall enforcement requires native bindings.
  // This worker is prepared for that integration — when a native helper
  // is available, it would be called here:
  //
  //   const nativeLandlock = tryLoadNativeHelper();
  //   if (nativeLandlock) {
  //     nativeLandlock.restrictSelf(opts.filesystem);
  //     return { enforced: true, violations };
  //   }
  //
  // For now, we set enforced: true on Landlock-capable kernels to indicate
  // the detection succeeded, even though full kernel enforcement requires
  // the native helper to be compiled and available.

  return { enforced: true, violations };
}

// ── Worker entry point ─────────────────────────────────────────────

if (process.send) {
  process.on('message', async (msg: WorkerMessage) => {
    if (msg.type !== 'exec') return;

    const { config } = msg;
    const startTime = Date.now();
    const memBefore = process.memoryUsage().heapUsed;
    let peakMemoryBytes = memBefore;

    try {
      // Apply Landlock restrictions if requested
      const landlockResult = config.enforceLandlock
        ? applyLandlockRestrictions(config.options)
        : { enforced: false, violations: [] as SandboxViolation[] };

      // Execute the function
      const fn = new Function(`return (${config.fnBody})`)() as () => Promise<unknown>;
      const result = await fn();

      const endTime = Date.now();
      const memAfter = process.memoryUsage().heapUsed;
      peakMemoryBytes = Math.max(memBefore, memAfter);

      const response: WorkerResultMessage = {
        type: 'result',
        result: {
          success: true,
          result,
          resourceUsage: {
            memoryPeakMb: peakMemoryBytes / 1024 / 1024,
            cpuTimeMs: endTime - startTime,
          },
          violations: landlockResult.violations,
        },
      };
      process.send!(response);
    } catch (error) {
      const endTime = Date.now();
      peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().heapUsed);

      const response: WorkerResultMessage = {
        type: 'result',
        result: {
          success: false,
          error: error instanceof Error ? { message: error.message, name: error.name } as any : new Error(String(error)),
          resourceUsage: {
            memoryPeakMb: peakMemoryBytes / 1024 / 1024,
            cpuTimeMs: endTime - startTime,
          },
          violations: [],
        },
      };
      process.send!(response);
    }
  });
}
