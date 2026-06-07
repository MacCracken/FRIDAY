/**
 * SgxSandbox — Intel SGX (Software Guard Extensions) sandbox execution.
 * Executes task functions inside an SGX enclave via Gramine-SGX.
 * Falls back to in-process execution if Gramine/SGX is not available.
 */

import { execFileSync, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import type {
  Sandbox,
  SandboxCapabilities,
  SandboxOptions,
  SandboxResult,
  SandboxViolation,
} from './types.js';

export interface SgxSandboxOptions {
  /** Path to gramine-sgx binary. Default: auto-detect from PATH. */
  graminePath?: string;
  /** SGX enclave heap size. Default: '256M'. */
  enclaveSize?: string;
}

export class SgxSandbox implements Sandbox {
  private logger: SecureLogger | null = null;
  private gramineBinary: string | null = null;
  private available: boolean | null = null;
  private readonly opts: SgxSandboxOptions;

  constructor(opts?: SgxSandboxOptions) {
    this.opts = opts ?? {};
  }

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'SgxSandbox' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  /**
   * Detect the gramine-sgx binary path.
   */
  private detectGramine(): string | null {
    if (this.gramineBinary !== null) return this.gramineBinary || null;

    const explicit = this.opts.graminePath;
    if (explicit) {
      try {
        execFileSync(explicit, ['--version'], { stdio: 'pipe', timeout: 5000 });
        this.gramineBinary = explicit;
        return explicit;
      } catch {
        this.gramineBinary = '';
        return null;
      }
    }

    // Check via which first
    try {
      const which = execFileSync('which', ['gramine-sgx'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }).trim();
      if (which) {
        this.gramineBinary = which;
        return which;
      }
    } catch {
      // not in PATH
    }

    // Common install locations
    const candidates = ['/usr/local/bin/gramine-sgx', '/usr/bin/gramine-sgx'];
    for (const c of candidates) {
      try {
        execFileSync(c, ['--version'], { stdio: 'pipe', timeout: 5000 });
        this.gramineBinary = c;
        return c;
      } catch {
        continue;
      }
    }

    this.gramineBinary = '';
    return null;
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    if (process.platform !== 'linux') {
      this.available = false;
      return false;
    }

    // Check for SGX device and Gramine
    const hasSgx = existsSync('/dev/sgx_enclave') || existsSync('/dev/isgx');
    const hasGramine = this.detectGramine() !== null;
    this.available = hasSgx && hasGramine;
    return this.available;
  }

  getCapabilities(): SandboxCapabilities {
    return {
      landlock: false,
      seccomp: false,
      namespaces: false,
      rlimits: false,
      platform: process.platform === 'linux' ? 'linux' : 'other',
      sgx: this.isAvailable(),
    };
  }

  async run<T>(fn: () => Promise<T>, opts?: SandboxOptions): Promise<SandboxResult<T>> {
    if (!this.isAvailable()) {
      this.getLogger().warn('SGX/Gramine not available, executing without enclave isolation');
      return this.runFallback(fn, opts);
    }

    const startTime = Date.now();
    const violations: SandboxViolation[] = [];
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sy-sgx-'));

    try {
      // Write task script
      const taskScript = `
const fn = ${fn.toString()};
(async () => {
  try {
    const result = await fn();
    process.stdout.write(JSON.stringify({ success: true, result }));
  } catch (err) {
    process.stdout.write(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
})();
`;
      const scriptPath = path.join(tmpDir, 'task.mjs');
      writeFileSync(scriptPath, taskScript);

      // Write Gramine manifest
      const manifestContent = this.buildManifest(scriptPath);
      const manifestPath = path.join(tmpDir, 'task.manifest.sgx');
      writeFileSync(manifestPath, manifestContent);

      const gramine = this.detectGramine()!;
      const timeoutMs = opts?.timeoutMs ?? 30000;

      const result = await new Promise<SandboxResult<T>>((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            success: false,
            error: new Error(`SGX execution timed out after ${timeoutMs}ms`),
            resourceUsage: { memoryPeakMb: 0, cpuTimeMs: timeoutMs },
            violations: [
              { type: 'resource', description: 'Execution timeout', timestamp: Date.now() },
            ],
          });
        }, timeoutMs);

        execFile(
          gramine,
          [manifestPath],
          {
            timeout: timeoutMs + 5000,
            maxBuffer: 10 * 1024 * 1024,
          },
          (err, stdout, stderr) => {
            clearTimeout(timer);
            const cpuTimeMs = Date.now() - startTime;

            if (stderr && (stderr.includes('DENIED') || stderr.includes('violation'))) {
              violations.push({
                type: 'syscall',
                description: stderr.trim(),
                timestamp: Date.now(),
              });
            }

            if (err) {
              resolve({
                success: false,
                error: new Error(err.message),
                resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                violations,
              });
              return;
            }

            try {
              const parsed = JSON.parse(stdout);
              resolve({
                success: parsed.success,
                result: parsed.success ? (parsed.result as T) : undefined,
                error: parsed.success
                  ? undefined
                  : new Error(parsed.error ?? 'Task failed in SGX enclave'),
                resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                violations,
              });
            } catch {
              resolve({
                success: false,
                error: new Error(`Failed to parse SGX output: ${stdout.slice(0, 200)}`),
                resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                violations,
              });
            }
          }
        );
      });

      return result;
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Build a Gramine-SGX manifest for the task.
   */
  private buildManifest(scriptPath: string): string {
    const enclaveSize = this.opts.enclaveSize ?? '256M';
    const maxThreads = 4;
    return `
[libos]
entrypoint = "/usr/local/bin/node"

[loader]
entrypoint = "file:{{ gramine.libos }}"
log_level = "warning"
argv = ["/usr/local/bin/node", "--experimental-vm-modules", "${scriptPath}"]
env.PATH = "/usr/local/bin:/usr/bin:/bin"
env.HOME = "/tmp"

[sgx]
enclave_size = "${enclaveSize}"
max_threads = ${maxThreads}
trusted_files = [
  "file:{{ gramine.libos }}",
  "file:${scriptPath}",
  "file:/usr/local/bin/node",
]

[fs]
mounts = [
  { path = "/tmp", type = "tmpfs" },
]
`.trim();
  }

  /**
   * Fallback: run in-process with basic resource tracking when SGX is unavailable.
   */
  private async runFallback<T>(
    fn: () => Promise<T>,
    _opts?: SandboxOptions
  ): Promise<SandboxResult<T>> {
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
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        resourceUsage: {
          memoryPeakMb: process.memoryUsage().heapUsed / 1024 / 1024,
          cpuTimeMs: Date.now() - startTime,
        },
        violations: [],
      };
    }
  }
}
