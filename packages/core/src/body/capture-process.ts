/**
 * Capture Process
 *
 * Manages the lifecycle of a sandboxed screen capture process including
 * initialization, execution, monitoring, and cleanup.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see ADR 017: Sandboxed Execution
 * @see NEXT_STEP_05: Sandboxing
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { platform } from 'node:os';
import type { SecureLogger } from '../logging/logger.js';
import type { CaptureScope } from '../body/types.js';
import type {
  CaptureSandboxConfig,
  CaptureSandboxViolation,
  CaptureProcessHandle,
  CaptureSandboxEvent,
} from '../sandbox/capture-sandbox.js';
import { DEFAULT_CAPTURE_SANDBOX } from '../sandbox/capture-sandbox.js';
import { LinuxCaptureSandbox } from '../sandbox/linux-capture-sandbox.js';
import { DarwinCaptureSandbox } from '../sandbox/darwin-capture-sandbox.js';

export type CaptureProcessStatus =
  | 'created'
  | 'starting'
  | 'running'
  | 'capturing'
  | 'stopping'
  | 'terminated'
  | 'failed';

export interface CaptureProcessConfig {
  scope: CaptureScope;
  sandboxConfig?: Partial<CaptureSandboxConfig>;
  command?: string;
  args?: string[];
  onEvent?: (event: CaptureSandboxEvent) => void;
  onViolation?: (violation: CaptureSandboxViolation) => void;
}

export class CaptureProcess {
  private scope: CaptureScope;
  private config: CaptureSandboxConfig;
  private sandbox: LinuxCaptureSandbox | DarwinCaptureSandbox;
  private child: ChildProcess | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private monitorInterval: NodeJS.Timeout | null = null;
  private status: CaptureProcessStatus = 'created';
  private startTime = 0;
  private pid: number | null = null;
  private logger: SecureLogger;
  private onEvent?: (event: CaptureSandboxEvent) => void;
  private onViolation?: (violation: CaptureSandboxViolation) => void;

  constructor(cfg: CaptureProcessConfig) {
    this.scope = cfg.scope;
    this.config = { ...DEFAULT_CAPTURE_SANDBOX, ...cfg.sandboxConfig };
    this.onEvent = cfg.onEvent;
    this.onViolation = cfg.onViolation;

    if (platform() === 'linux') {
      this.sandbox = new LinuxCaptureSandbox(this.config);
    } else if (platform() === 'darwin') {
      this.sandbox = new DarwinCaptureSandbox(this.config);
    } else {
      throw new Error(`Platform ${platform()} not supported for capture sandbox`);
    }

    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'CaptureProcess' });
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

  async start(): Promise<CaptureProcessHandle> {
    if (this.status !== 'created') {
      throw new Error(`Cannot start capture process in status: ${this.status}`);
    }

    this.status = 'starting';
    this.emitEvent('sandbox.initializing');

    try {
      await this.sandbox.initialize();
      this.emitEvent('sandbox.ready');

      const command = 'echo';
      const args = ['capture-process-ready'];

      this.child = spawn(command, args, {
        detached: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.getSanitizedEnv(),
      });

      this.pid = this.child.pid ?? null;
      this.startTime = Date.now();
      this.status = 'running';

      this.emitEvent('capture.started', { pid: this.pid });

      this.setupProcessHandlers();
      this.startTimeout();
      this.startMonitoring();

      this.logger.info({ pid: this.pid }, 'Capture process started');

      return {
        pid: this.pid ?? 0,
        startTime: this.startTime,
        sandboxed: true,
      };
    } catch (error) {
      this.status = 'failed';
      this.emitEvent('sandbox.terminated');
      throw error;
    }
  }

  async capture(): Promise<Buffer> {
    if (this.status !== 'running') {
      throw new Error(`Cannot capture in status: ${this.status}`);
    }

    if (!this.child) {
      throw new Error('Capture process not started');
    }

    this.status = 'capturing';

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      const onData = (chunk: Buffer) => {
        chunks.push(chunk);
      };
      this.child!.stdout?.removeAllListeners('data');
      this.child!.stdout?.on('data', onData);

      this.child!.once('error', (error) => {
        this.child!.stdout?.off('data', onData);
        this.status = 'failed';
        reject(error);
      });

      this.child!.once('exit', (code, signal) => {
        if (code === 0) {
          const result = Buffer.concat(chunks);
          this.status = 'running';
          this.emitEvent('capture.completed');
          resolve(result);
        } else {
          this.status = 'failed';
          this.emitEvent('capture.failed', { code, signal });
          reject(new Error(`Capture process exited with code ${code}, signal ${signal}`));
        }
      });

      this.child!.stdin?.write(
        JSON.stringify({
          action: 'capture',
          scope: this.scope,
        }) + '\n'
      );
    });
  }

  async terminate(reason: string): Promise<void> {
    if (this.status === 'terminated' || this.status === 'failed') {
      return;
    }

    this.status = 'stopping';

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    if (this.child) {
      this.child.kill('SIGTERM');

      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 5000);
    }

    this.status = 'terminated';
    this.emitEvent('sandbox.terminated', { reason });

    this.logger.info({ reason, pid: this.pid }, 'Capture process terminated');
  }

  getStatus(): CaptureProcessStatus {
    return this.status;
  }

  getPid(): number | null {
    return this.pid;
  }

  getScope(): CaptureScope {
    return { ...this.scope };
  }

  private setupProcessHandlers(): void {
    if (!this.child) return;

    this.child.on('exit', (code, signal) => {
      if (this.status !== 'stopping' && this.status !== 'terminated') {
        this.logger.error({ code, signal }, 'Capture process exited unexpectedly');
        this.status = 'failed';
        this.emitEvent('capture.failed', { code, signal });
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      const message = data.toString().trim();
      if (message) {
        this.logger.warn({ message }, 'Capture process stderr');
      }
    });
  }

  private startTimeout(): void {
    const timeoutMs = this.config.maxDuration * 1000;
    this.timeoutId = setTimeout(() => {
      void this.terminate('timeout');
      this.emitEvent('sandbox.timeout');
    }, timeoutMs);
  }

  private startMonitoring(): void {
    this.monitorInterval = setInterval(() => {
      if (!this.pid || this.status !== 'running') return;
      const pid = this.pid;

      void (async () => {
        try {
          const usage = await this.getResourceUsage(pid);

          const ok = this.sandbox.checkResourceLimits({
            memoryMb: usage.memoryMb,
            cpuPercent: usage.cpuPercent,
          });

          if (!ok) {
            const violations = this.sandbox.getViolations();
            const latest = violations[violations.length - 1];
            if (latest) {
              this.onViolation?.(latest);
            }
            await this.terminate('resource_limit_exceeded');
          }
        } catch {
          // Process may have exited
        }
      })();
    }, 1000);
  }

  private async getResourceUsage(pid: number): Promise<{
    memoryMb: number;
    cpuPercent: number;
  }> {
    try {
      const { readFileSync } = require('node:fs');
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      const parts = stat.split(' ');

      const utime = parseInt(parts[13], 10);
      const stime = parseInt(parts[14], 10);

      const { readFileSync: rf } = require('node:fs');
      const memPath = `/proc/${pid}/status`;
      let memoryKb = 0;
      try {
        const memStat = rf(memPath, 'utf8');
        const match = memStat.match(/VmRSS:\s+(\d+)/);
        if (match) {
          memoryKb = parseInt(match[1], 10);
        }
      } catch {
        // Ignore
      }

      const cpuTime = (utime + stime) / 100;
      const wallTime = (Date.now() - this.startTime) / 1000;
      const cpuPercent = wallTime > 0 ? (cpuTime / wallTime) * 100 : 0;

      return {
        memoryMb: Math.round(memoryKb / 1024),
        cpuPercent: Math.round(cpuPercent),
      };
    } catch {
      return { memoryMb: 0, cpuPercent: 0 };
    }
  }

  private getSanitizedEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    const safeVars = ['PATH', 'HOME', 'TMPDIR', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'TZ'];

    for (const key of safeVars) {
      if (process.env[key]) {
        env[key] = process.env[key]!;
      }
    }

    env.CAPTURE_SANDBOX = '1';
    env.CAPTURE_MAX_DURATION = String(this.config.maxDuration);
    env.CAPTURE_MAX_MEMORY = String(this.config.maxMemory);

    return env;
  }

  private emitEvent(type: CaptureSandboxEvent['type'], details?: Record<string, unknown>): void {
    const event: CaptureSandboxEvent = {
      type,
      timestamp: Date.now(),
      pid: this.pid ?? undefined,
      details,
    };
    this.onEvent?.(event);
  }
}

export function createCaptureProcess(config: CaptureProcessConfig): CaptureProcess {
  return new CaptureProcess(config);
}
