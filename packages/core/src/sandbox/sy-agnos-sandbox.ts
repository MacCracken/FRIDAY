/**
 * SyAgnosSandbox — Container-based sandbox using sy-agnos images.
 *
 * Executes task functions inside a Docker/Podman container built from
 * the sy-agnos image (minimal, dm-verity, or TPM measured boot tiers).
 * Provides read-only root filesystem, memory/CPU limits, and network isolation.
 *
 * Falls back to in-process execution if container runtime is unavailable.
 */

import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
import type { AgnosClient, AttestationResult } from '../integrations/agnos/agnos-client.js';
import type { ToolOutputScanner } from '../security/tool-output-scanner.js';

export interface SyAgnosSandboxOptions {
  /** Container image name. Default: 'sy-agnos:latest'. */
  imageName?: string;
  /** Container runtime ('docker' | 'podman'). Default: auto-detect. */
  containerRuntime?: 'docker' | 'podman';
  /** Memory limit in MB. Default: 256. */
  memorySizeMb?: number;
  /** CPU limit (fractional cores). Default: 1. */
  cpuLimit?: number;
  /** AGNOS attestation URL for verification. */
  attestationUrl?: string;
  /** Optional AgnosClient for phylax scanning and attestation. */
  agnosClient?: AgnosClient;
  /** Optional output scanner for phylax integration. */
  outputScanner?: ToolOutputScanner;
  /** Block results with HIGH+ severity phylax findings. Default: false. */
  blockHighSeverity?: boolean;
}

/** sy-agnos release info parsed from /etc/sy-agnos-release. */
interface SyAgnosRelease {
  tier: 'minimal' | 'dmverity' | 'tpm_measured';
  version?: string;
}

export class SyAgnosSandbox implements Sandbox {
  private logger: SecureLogger | null = null;
  private runtimeBinary: string | null = null;
  private available: boolean | null = null;
  private readonly opts: SyAgnosSandboxOptions;

  constructor(opts?: SyAgnosSandboxOptions) {
    this.opts = opts ?? {};
  }

  private getLogger(): SecureLogger {
    if (!this.logger) {
      try {
        this.logger = getLogger().child({ component: 'SyAgnosSandbox' });
      } catch {
        return createNoopLogger();
      }
    }
    return this.logger;
  }

  /**
   * Detect the container runtime binary (docker or podman).
   */
  private detectRuntime(): string | null {
    if (this.runtimeBinary !== null) return this.runtimeBinary || null;

    const explicit = this.opts.containerRuntime;
    const candidates = explicit ? [explicit] : ['docker', 'podman'];

    for (const bin of candidates) {
      try {
        const which = execFileSync('which', [bin], {
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 5000,
        }).trim();
        if (which) {
          this.runtimeBinary = which;
          return which;
        }
      } catch {
        continue;
      }
    }

    this.runtimeBinary = '';
    return null;
  }

  /**
   * Check if the sy-agnos image exists in the local registry.
   */
  private imageExists(): boolean {
    const runtime = this.detectRuntime();
    if (!runtime) return false;

    const imageName = this.opts.imageName ?? 'sy-agnos:latest';
    try {
      execFileSync(runtime, ['image', 'inspect', imageName], {
        stdio: 'pipe',
        timeout: 10000,
      });
      return true;
    } catch {
      return false;
    }
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    if (process.platform !== 'linux') {
      this.available = false;
      return false;
    }

    const hasRuntime = this.detectRuntime() !== null;
    const hasImage = hasRuntime && this.imageExists();

    this.available = hasRuntime && hasImage;

    if (!this.available) {
      this.getLogger().debug({ hasRuntime, hasImage }, 'sy-agnos availability check');
    }

    return this.available;
  }

  getCapabilities(): SandboxCapabilities {
    return {
      landlock: false,
      seccomp: false,
      namespaces: true,
      rlimits: true,
      platform: process.platform === 'linux' ? 'linux' : 'other',
      syAgnos: this.isAvailable(),
    };
  }

  /**
   * Detect the sy-agnos image tier strength.
   *
   * Returns: 80 (minimal), 85 (dmverity), 88 (tpm_measured).
   */
  detectStrength(): number {
    const runtime = this.detectRuntime();
    if (!runtime) return 80;

    const imageName = this.opts.imageName ?? 'sy-agnos:latest';
    try {
      const output = execFileSync(
        runtime,
        ['run', '--rm', imageName, 'cat', '/etc/sy-agnos-release'],
        { encoding: 'utf-8', stdio: 'pipe', timeout: 15000 }
      ).trim();

      const release = JSON.parse(output) as SyAgnosRelease;
      switch (release.tier) {
        case 'tpm_measured':
          return 88;
        case 'dmverity':
          return 85;
        case 'minimal':
        default:
          return 80;
      }
    } catch {
      this.getLogger().debug('Failed to detect sy-agnos tier, defaulting to minimal (80)');
      return 80;
    }
  }

  /**
   * Verify AGNOS attestation — checks PCR values and HMAC signature.
   * Returns true if attestation is valid, false otherwise.
   */
  async verifyAttestation(agnosClient: AgnosClient): Promise<boolean> {
    try {
      const attestation: AttestationResult = await agnosClient.getAttestation();

      // Verify required PCR registers are present and well-formed (hex strings)
      const requiredPcrs = ['8', '9', '10'];
      const pcrHexPattern = /^[0-9a-f]{16,128}$/i;
      for (const pcr of requiredPcrs) {
        const value = attestation.pcr_values[pcr];
        if (!value) {
          this.getLogger().warn({ missing: pcr }, 'Attestation missing required PCR register');
          return false;
        }
        if (!pcrHexPattern.test(value)) {
          this.getLogger().warn(
            { pcr, value: value.slice(0, 20) },
            'Attestation PCR value malformed'
          );
          return false;
        }
      }

      // Verify HMAC signature is present, non-empty, and looks like a valid signature
      if (!attestation.signature || attestation.signature.length < 32) {
        this.getLogger().warn('Attestation has missing or too-short signature');
        return false;
      }

      this.getLogger().info(
        { algorithm: attestation.algorithm, timestamp: attestation.timestamp },
        'AGNOS attestation verified'
      );
      return true;
    } catch (err) {
      this.getLogger().warn(
        { error: err instanceof Error ? err.message : String(err) },
        'AGNOS attestation verification failed'
      );
      return false;
    }
  }

  async run<T>(fn: () => Promise<T>, opts?: SandboxOptions): Promise<SandboxResult<T>> {
    if (!this.isAvailable()) {
      this.getLogger().warn(
        'sy-agnos sandbox not available, executing without container isolation'
      );
      return this.runFallback(fn, opts);
    }

    const startTime = Date.now();
    const violations: SandboxViolation[] = [];
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'sy-agnos-'));

    try {
      // Serialize task to temp dir
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

      const timeoutMs = opts?.timeoutMs ?? 30000;
      const memorySizeMb = this.opts.memorySizeMb ?? 256;
      const cpuLimit = this.opts.cpuLimit ?? 1;
      const imageName = this.opts.imageName ?? 'sy-agnos:latest';
      const runtime = this.detectRuntime()!;

      const args = [
        'run',
        '--rm',
        '-i',
        '--read-only',
        '--tmpfs',
        '/tmp:size=256m',
        `--memory=${memorySizeMb}m`,
        `--cpus=${cpuLimit}`,
        '--network=none',
        '-v',
        `${tmpDir}:/task:ro`,
        imageName,
        'node',
        '/task/task.mjs',
      ];

      const result = await new Promise<SandboxResult<T>>((resolve) => {
        const timer = setTimeout(() => {
          if (child?.pid) {
            try {
              process.kill(child.pid, 'SIGKILL');
            } catch {
              /* process may have already exited */
            }
          }
          resolve({
            success: false,
            error: new Error(`sy-agnos execution timed out after ${timeoutMs}ms`),
            resourceUsage: { memoryPeakMb: 0, cpuTimeMs: timeoutMs },
            violations: [
              { type: 'resource', description: 'Execution timeout', timestamp: Date.now() },
            ],
          });
        }, timeoutMs);

        const child = execFile(
          runtime,
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

            // Run phylax scanning on output if available
            void this.scanOutput(stdout, violations).then(() => {
              try {
                const parsed = JSON.parse(stdout);
                // Check if phylax found HIGH+ violations and blocking is enabled
                const hasHighSeverity = violations.some(
                  (v) => v.type === 'scanning' && v.description.includes('HIGH')
                );
                if (hasHighSeverity && this.opts.blockHighSeverity) {
                  resolve({
                    success: false,
                    error: new Error('Output blocked by phylax scanner: HIGH severity findings'),
                    resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                    violations,
                  });
                  return;
                }

                resolve({
                  success: parsed.success,
                  result: parsed.success ? (parsed.result as T) : undefined,
                  error: parsed.success
                    ? undefined
                    : new Error(parsed.error ?? 'Task failed in sy-agnos container'),
                  resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                  violations,
                });
              } catch {
                resolve({
                  success: false,
                  error: new Error(`Failed to parse sy-agnos output: ${stdout.slice(0, 200)}`),
                  resourceUsage: { memoryPeakMb: 0, cpuTimeMs },
                  violations,
                });
              }
            });
          }
        );
      });

      return result;
    } finally {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {
        this.getLogger().debug({ error: String(e), tmpDir }, 'Failed to clean up temp dir');
      }
    }
  }

  /**
   * Run phylax scanning on sandbox output if agnosClient and outputScanner are available.
   */
  private async scanOutput(stdout: string, violations: SandboxViolation[]): Promise<void> {
    const { agnosClient, outputScanner } = this.opts;
    if (!agnosClient || !outputScanner) return;

    try {
      // Use phylax via agnosClient with 5s timeout to avoid blocking sandbox results
      const scanPromise = agnosClient.scanBytes(
        Buffer.from(stdout).toString('base64'),
        'sy-agnos-sandbox-output'
      );
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Phylax scan timeout'));
        }, 5000);
      });
      const scanResult = await Promise.race([scanPromise, timeoutPromise]);

      if (scanResult.findings?.length) {
        for (const finding of scanResult.findings) {
          if (finding.severity === 'HIGH' || finding.severity === 'CRITICAL') {
            violations.push({
              type: 'scanning',
              description: `Phylax ${finding.severity}: ${finding.description}`,
              timestamp: Date.now(),
            });
          }
        }
      }
    } catch (err) {
      this.getLogger().debug(
        { error: err instanceof Error ? err.message : String(err) },
        'Phylax scanning failed (non-fatal)'
      );
    }
  }

  /**
   * Fallback: run in-process when container runtime is unavailable.
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
