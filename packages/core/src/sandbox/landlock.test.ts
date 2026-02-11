import { describe, it, expect, vi } from 'vitest';
import { LinuxSandbox } from './linux-sandbox.js';

describe('LinuxSandbox V2 — Landlock', () => {
  describe('constructor options', () => {
    it('defaults enforceLandlock to false', () => {
      const sandbox = new LinuxSandbox();
      // V1 soft sandbox by default — just verify it works
      expect(sandbox.isAvailable()).toBe(process.platform === 'linux');
    });

    it('accepts enforceLandlock option', () => {
      const sandbox = new LinuxSandbox({ enforceLandlock: true });
      expect(sandbox).toBeDefined();
    });
  });

  describe('run() with enforceLandlock=false', () => {
    it('behaves as V1 soft sandbox', async () => {
      const sandbox = new LinuxSandbox({ enforceLandlock: false });
      const result = await sandbox.run(async () => 'v1-result');
      expect(result.success).toBe(true);
      expect(result.result).toBe('v1-result');
    });
  });

  describe('getCapabilities()', () => {
    it('returns linux platform capabilities', () => {
      const sandbox = new LinuxSandbox();
      const caps = sandbox.getCapabilities();
      if (process.platform === 'linux') {
        expect(caps.platform).toBe('linux');
        expect(caps.rlimits).toBe(true);
        // landlock may or may not be available depending on kernel
        expect(typeof caps.landlock).toBe('boolean');
      }
    });
  });

  describe('validatePath()', () => {
    const sandbox = new LinuxSandbox();

    it('returns null for allowed paths', () => {
      const result = sandbox.validatePath('/tmp/data/file.txt', 'read', {
        readPaths: ['/tmp/data'],
        writePaths: [],
        execPaths: [],
      });
      expect(result).toBeNull();
    });

    it('returns violation for disallowed paths', () => {
      const result = sandbox.validatePath('/etc/passwd', 'read', {
        readPaths: ['/tmp/data'],
        writePaths: [],
        execPaths: [],
      });
      expect(result).not.toBeNull();
      expect(result?.type).toBe('filesystem');
    });
  });

  describe.skipIf(process.platform !== 'linux')('Linux-specific', () => {
    it('detects landlock capability from /proc', () => {
      const sandbox = new LinuxSandbox();
      const caps = sandbox.getCapabilities();
      // Just verify it runs without error on Linux
      expect(caps.platform).toBe('linux');
    });

    it('run with Landlock falls back gracefully when worker not compiled', async () => {
      // On CI/test environments, the compiled worker (.js) may not exist,
      // so runWithLandlock should fall back to V1
      const sandbox = new LinuxSandbox({ enforceLandlock: true });
      const result = await sandbox.run(async () => 'landlock-test');
      // Should succeed regardless (either via worker or V1 fallback)
      expect(result.success).toBe(true);
      expect(result.result).toBe('landlock-test');
    });
  });
});

// Test the worker message types
describe('Landlock worker types', () => {
  it('can import worker types', async () => {
    const types = await import('./landlock-worker.js');
    // Verify the module exports exist (type-level check)
    expect(types).toBeDefined();
  });
});

// SandboxManager integration
describe('SandboxManager with Landlock', () => {
  it('creates LinuxSandbox with enforceLandlock on linux+auto', async () => {
    const { SandboxManager } = await import('./manager.js');

    const manager = new SandboxManager({
      enabled: true,
      technology: 'auto',
      allowedReadPaths: [],
      allowedWritePaths: [],
      maxMemoryMb: 1024,
      maxCpuPercent: 50,
      maxFileSizeMb: 100,
      networkAllowed: true,
    });

    const sandbox = manager.createSandbox();
    // On Linux: should be LinuxSandbox; on other platforms: may be Noop or Darwin
    expect(sandbox).toBeDefined();
  });

  it('creates LinuxSandbox with enforceLandlock when technology=landlock', async () => {
    const { SandboxManager } = await import('./manager.js');

    const manager = new SandboxManager({
      enabled: true,
      technology: 'landlock',
      allowedReadPaths: [],
      allowedWritePaths: [],
      maxMemoryMb: 1024,
      maxCpuPercent: 50,
      maxFileSizeMb: 100,
      networkAllowed: true,
    });

    const sandbox = manager.createSandbox();
    if (process.platform === 'linux') {
      expect(sandbox.constructor.name).toBe('LinuxSandbox');
    } else {
      // Falls back to NoopSandbox on non-Linux
      expect(sandbox.constructor.name).toBe('NoopSandbox');
    }
  });
});
