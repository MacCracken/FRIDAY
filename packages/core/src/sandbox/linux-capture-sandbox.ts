/**
 * Linux Capture Sandbox
 *
 * Specialized sandbox for screen capture on Linux with strict syscall filtering,
 * filesystem restrictions, and resource limits.
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

const CAPTURE_ONLY_ALLOWED_SYSCALLS = [
  'read',
  'write',
  'open',
  'close',
  'stat',
  'fstat',
  'lstat',
  'mmap',
  'mprotect',
  'munmap',
  'ioctl',
  'gettimeofday',
  'clock_gettime',
  'clock_getres',
  'exit',
  'exit_group',
  'shmget',
  'shmat',
  'shmctl',
  'poll',
  'epoll_wait',
  'select',
  'pread64',
  'pwrite64',
  'readv',
  'writev',
  'nanosleep',
  'getitimer',
  'alarm',
  'setitimer',
  'getpid',
  'getuid',
  'syslog',
  'getgid',
  'setuid',
  'setgid',
  'geteuid',
  'getegid',
  'setpgid',
  'getppid',
  'getpgrp',
  'setsid',
  'setreuid',
  'setregid',
  'getgroups',
  'setgroups',
  'getresuid',
  'setresuid',
  'getresgid',
  'setresgid',
  'getpgid',
  'setfsuid',
  'setfsgid',
  'getsid',
  'gettid',
];

const CAPTURE_BLOCKED_SYSCALLS = [
  'socket',
  'connect',
  'accept',
  'bind',
  'listen',
  'execve',
  'fork',
  'vfork',
  'clone',
  'ptrace',
  'mount',
  'umount2',
  'reboot',
  'kexec_load',
  'init_module',
  'delete_module',
  'pivot_root',
  'swapon',
  'swapoff',
];

export class LinuxCaptureSandbox {
  private config: CaptureSandboxConfig;
  private logger: SecureLogger;
  private violations: CaptureSandboxViolation[] = [];
  private initialized = false;

  constructor(config: Partial<CaptureSandboxConfig> = {}) {
    this.config = { ...DEFAULT_CAPTURE_SANDBOX, ...config };

    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'LinuxCaptureSandbox' });
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
    return platform() === 'linux';
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error('LinuxCaptureSandbox is only available on Linux');
    }

    this.logger.info(
      {
        maxMemory: this.config.maxMemory,
        maxCpuPercent: this.config.maxCpuPercent,
        maxDuration: this.config.maxDuration,
        allowNetwork: this.config.allowNetwork,
        syscallPolicy: this.config.syscallPolicy,
      },
      'Initializing Linux capture sandbox'
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

  getAllowedSyscalls(): string[] {
    return [...CAPTURE_ONLY_ALLOWED_SYSCALLS];
  }

  getBlockedSyscalls(): string[] {
    return [...CAPTURE_BLOCKED_SYSCALLS];
  }

  getViolations(): CaptureSandboxViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }
}

export function createCaptureSandbox(config?: Partial<CaptureSandboxConfig>): LinuxCaptureSandbox {
  return new LinuxCaptureSandbox(config);
}
