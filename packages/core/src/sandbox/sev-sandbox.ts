/**
 * SevSandbox — AMD SEV-SNP (Secure Encrypted Virtualization) sandbox execution.
 * Executes task functions inside an SEV-SNP protected VM via QEMU.
 * Falls back to in-process execution if QEMU/SEV is not available.
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

export interface SevSandboxOptions {
  /** Path to qemu-system-x86_64 binary. Default: auto-detect from PATH. */
  qemuPath?: string;
  /** Guest memory size. Default: '512M'. */
  memorySize?: string;
  /** Number of virtual CPUs. Default: 2. */
  vcpus?: number;
}

export class SevSandbox implements Sandbox {
  private logger: SecureLogger | null = null;
  private qemuBinary: string | null = null;
  private available: boolean | null = null;
  private readonly opts: SevSandboxOptions;

  constructor(opts?: SevSandboxOptions) {
    this.opts = opts ?? {};
  }

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'SevSandbox' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  /**
   * Detect the qemu-system-x86_64 binary path.
   */
  private detectQemu(): string | null {
    if (this.qemuBinary !== null) return this.qemuBinary || null;

    const explicit = this.opts.qemuPath;
    if (explicit) {
      try {
        execFileSync(explicit, ['--version'], { stdio: 'pipe', timeout: 5000 });
        this.qemuBinary = explicit;
        return explicit;
      } catch {
        this.qemuBinary = '';
        return null;
      }
    }

    // Check via which first
    try {
      const which = execFileSync('which', ['qemu-system-x86_64'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5000,
      }).trim();
      if (which) {
        this.qemuBinary = which;
        return which;
      }
    } catch {
      // not in PATH
    }

    // Common install locations
    const candidates = ['/usr/local/bin/qemu-system-x86_64', '/usr/bin/qemu-system-x86_64'];
    for (const c of candidates) {
      try {
        execFileSync(c, ['--version'], { stdio: 'pipe', timeout: 5000 });
        this.qemuBinary = c;
        return c;
      } catch {
        continue;
      }
    }

    this.qemuBinary = '';
    return null;
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    if (process.platform !== 'linux') {
      this.available = false;
      return false;
    }

    // Check for SEV device and QEMU
    const hasSev = existsSync('/dev/sev');
    const hasQemu = this.detectQemu() !== null;
    this.available = hasSev && hasQemu;
    return this.available;
  }

  getCapabilities(): SandboxCapabilities {
    return {
      landlock: false,
      seccomp: false,
      namespaces: false,
      rlimits: false,
      platform: process.platform === 'linux' ? 'linux' : 'other',
      sev: this.isAvailable(),
    };
  }

  async run<T>(fn: () => Promise<T>, opts?: SandboxOptions): Promise<SandboxResult<T>> {
    if (!this.isAvailable()) {
      this.getLogger().warn('SEV-SNP/QEMU not available, executing without VM isolation');
      return this.runFallback(fn, opts);
    }

    const startTime = Date.now();
    const violations: SandboxViolation[] = [];
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sy-sev-'));

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

      const qemu = this.detectQemu()!;
      const timeoutMs = opts?.timeoutMs ?? 30000;
      const memorySize = this.opts.memorySize ?? '512M';
      const vcpus = this.opts.vcpus ?? 2;

      const args = this.buildQemuArgs(scriptPath, memorySize, vcpus);

      const result = await new Promise<SandboxResult<T>>((resolve) => {
        const timer = setTimeout(() => {
          resolve({
            success: false,
            error: new Error(`SEV execution timed out after ${timeoutMs}ms`),
            resourceUsage: { memoryPeakMb: 0, cpuTimeMs: timeoutMs },
            violations: [
              { type: 'resource', description: 'Execution timeout', timestamp: Date.now() },
            ],
          });
        }, timeoutMs);

        execFile(
          qemu,
          args,
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
                  : new Error(parsed.error ?? 'Task failed in SEV-SNP VM'),
                resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                violations,
              });
            } catch {
              resolve({
                success: false,
                error: new Error(`Failed to parse SEV output: ${stdout.slice(0, 200)}`),
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
   * Build QEMU command-line arguments with SEV-SNP flags.
   */
  private buildQemuArgs(scriptPath: string, memorySize: string, vcpus: number): string[] {
    return [
      '-enable-kvm',
      '-cpu',
      'EPYC-v4',
      '-machine',
      'q35,confidential-guest-support=sev0,memory-backend=ram1',
      '-object',
      'memory-backend-memfd-private,id=ram1,size=' + memorySize,
      '-object',
      'sev-snp-guest,id=sev0,policy=0x30000,cbitpos=51,reduced-phys-bits=1',
      '-smp',
      String(vcpus),
      '-m',
      memorySize,
      '-nographic',
      '-no-reboot',
      '-virtfs',
      `local,path=${path.dirname(scriptPath)},mount_tag=task,security_model=none,readonly=on`,
      '-append',
      `task=${path.basename(scriptPath)}`,
    ];
  }

  /**
   * Fallback: run in-process with basic resource tracking when SEV is unavailable.
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
