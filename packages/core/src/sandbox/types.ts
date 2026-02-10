/**
 * Sandbox Types for SecureYeoman
 *
 * Defines the cross-platform sandbox abstraction layer (P2-010).
 * Implementations provide filesystem restrictions, resource limits,
 * and violation detection for task execution.
 */

export interface SandboxCapabilities {
  landlock: boolean;
  seccomp: boolean;
  namespaces: boolean;
  rlimits: boolean;
  platform: 'linux' | 'darwin' | 'win32' | 'other';
}

export interface SandboxOptions {
  filesystem?: {
    readPaths: string[];
    writePaths: string[];
    execPaths: string[];
  };
  resources?: {
    maxMemoryMb?: number;
    maxCpuPercent?: number;
    maxFileSizeMb?: number;
  };
  network?: {
    allowed: boolean;
    allowedHosts?: string[];
  };
  timeoutMs?: number;
}

export interface SandboxResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  resourceUsage?: {
    memoryPeakMb: number;
    cpuTimeMs: number;
  };
  violations: SandboxViolation[];
}

export interface SandboxViolation {
  type: 'filesystem' | 'network' | 'resource' | 'syscall';
  description: string;
  path?: string;
  timestamp: number;
}

export interface Sandbox {
  run<T>(fn: () => Promise<T>, opts?: SandboxOptions): Promise<SandboxResult<T>>;
  getCapabilities(): SandboxCapabilities;
  isAvailable(): boolean;
}
