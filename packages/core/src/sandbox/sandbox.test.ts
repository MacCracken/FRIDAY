import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopSandbox } from './noop-sandbox.js';
import { LinuxSandbox } from './linux-sandbox.js';
import { SandboxManager, type SandboxManagerConfig } from './manager.js';
import type { SandboxOptions } from './types.js';

describe('NoopSandbox', () => {
  let sandbox: NoopSandbox;

  beforeEach(() => {
    sandbox = new NoopSandbox();
  });

  it('should run functions and return results', async () => {
    const result = await sandbox.run(async () => 42);
    expect(result.success).toBe(true);
    expect(result.result).toBe(42);
    expect(result.violations).toEqual([]);
  });

  it('should track resource usage', async () => {
    const result = await sandbox.run(async () => 'hello');
    expect(result.resourceUsage).toBeDefined();
    expect(result.resourceUsage!.memoryPeakMb).toBeGreaterThan(0);
    expect(result.resourceUsage!.cpuTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors without crashing', async () => {
    const result = await sandbox.run(async () => {
      throw new Error('boom');
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe('boom');
    expect(result.violations).toEqual([]);
  });

  it('should handle non-Error throws', async () => {
    const result = await sandbox.run(async () => {
      throw 'string error';
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error!.message).toBe('string error');
  });

  it('should report no capabilities', () => {
    const caps = sandbox.getCapabilities();
    expect(caps.landlock).toBe(false);
    expect(caps.seccomp).toBe(false);
    expect(caps.namespaces).toBe(false);
    expect(caps.rlimits).toBe(false);
    expect(caps.platform).toBe('other');
  });

  it('should always be available', () => {
    expect(sandbox.isAvailable()).toBe(true);
  });

  it('should return results from async functions', async () => {
    const result = await sandbox.run(async () => {
      await new Promise(r => setTimeout(r, 10));
      return { data: [1, 2, 3] };
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ data: [1, 2, 3] });
  });

  it('should accept and ignore sandbox options', async () => {
    const opts: SandboxOptions = {
      filesystem: { readPaths: ['/tmp'], writePaths: [], execPaths: [] },
      resources: { maxMemoryMb: 512 },
    };
    const result = await sandbox.run(async () => 'ok', opts);
    expect(result.success).toBe(true);
    expect(result.result).toBe('ok');
  });
});

describe('LinuxSandbox', () => {
  let sandbox: LinuxSandbox;

  beforeEach(() => {
    sandbox = new LinuxSandbox();
  });

  describe('run()', () => {
    it('should execute functions and return results', async () => {
      const result = await sandbox.run(async () => 'linux result');
      expect(result.success).toBe(true);
      expect(result.result).toBe('linux result');
    });

    it('should track resource usage', async () => {
      const result = await sandbox.run(async () => {
        // Allocate some memory
        const arr = new Array(10000).fill('x');
        return arr.length;
      });
      expect(result.resourceUsage).toBeDefined();
      expect(result.resourceUsage!.memoryPeakMb).toBeGreaterThan(0);
      expect(result.resourceUsage!.cpuTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle errors', async () => {
      const result = await sandbox.run(async () => {
        throw new Error('linux error');
      });
      expect(result.success).toBe(false);
      expect(result.error!.message).toBe('linux error');
    });

    it('should detect path traversal in config', async () => {
      const opts: SandboxOptions = {
        filesystem: {
          readPaths: ['/tmp/../etc/shadow'],
          writePaths: [],
          execPaths: [],
        },
      };
      const result = await sandbox.run(async () => 'done', opts);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].type).toBe('filesystem');
      expect(result.violations[0].description).toContain('Suspicious path');
    });

    it('should detect null bytes in config paths', async () => {
      const opts: SandboxOptions = {
        filesystem: {
          readPaths: ['/tmp/file\0.txt'],
          writePaths: [],
          execPaths: [],
        },
      };
      const result = await sandbox.run(async () => 'done', opts);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].type).toBe('filesystem');
    });

    it('should track memory resource violations', async () => {
      const opts: SandboxOptions = {
        resources: {
          maxMemoryMb: 0.001, // impossibly low — will trigger violation
        },
      };
      const result = await sandbox.run(async () => {
        // Wait enough for the memory check interval
        await new Promise(r => setTimeout(r, 200));
        return 'done';
      }, opts);
      expect(result.violations.some(v => v.type === 'resource')).toBe(true);
    });

    it('should run without options', async () => {
      const result = await sandbox.run(async () => 123);
      expect(result.success).toBe(true);
      expect(result.result).toBe(123);
      expect(result.violations).toEqual([]);
    });
  });

  describe('validatePath()', () => {
    it('should allow paths within the allowlist', () => {
      const fsOpts = {
        readPaths: ['/home/user/project'],
        writePaths: ['/tmp'],
        execPaths: ['/usr/bin'],
      };
      expect(sandbox.validatePath('/home/user/project/src/file.ts', 'read', fsOpts)).toBeNull();
      expect(sandbox.validatePath('/tmp/output.txt', 'write', fsOpts)).toBeNull();
      expect(sandbox.validatePath('/usr/bin/node', 'exec', fsOpts)).toBeNull();
    });

    it('should deny paths outside the allowlist', () => {
      const fsOpts = {
        readPaths: ['/home/user/project'],
        writePaths: ['/tmp'],
        execPaths: [],
      };
      const violation = sandbox.validatePath('/etc/passwd', 'read', fsOpts);
      expect(violation).not.toBeNull();
      expect(violation!.type).toBe('filesystem');
      expect(violation!.description).toContain('not in the allowlist');
      expect(violation!.path).toContain('/etc/passwd');
    });

    it('should deny write to read-only paths', () => {
      const fsOpts = {
        readPaths: ['/home/user/project'],
        writePaths: [],
        execPaths: [],
      };
      const violation = sandbox.validatePath('/home/user/project/file.ts', 'write', fsOpts);
      expect(violation).not.toBeNull();
      expect(violation!.type).toBe('filesystem');
    });

    it('should match exact directory paths', () => {
      const fsOpts = {
        readPaths: ['/home/user'],
        writePaths: [],
        execPaths: [],
      };
      // /home/username should NOT match /home/user
      const violation = sandbox.validatePath('/home/username/file.ts', 'read', fsOpts);
      expect(violation).not.toBeNull();
    });

    it('should allow exact path match', () => {
      const fsOpts = {
        readPaths: ['/home/user/file.txt'],
        writePaths: [],
        execPaths: [],
      };
      expect(sandbox.validatePath('/home/user/file.txt', 'read', fsOpts)).toBeNull();
    });
  });

  describe('getCapabilities()', () => {
    it('should detect platform', () => {
      const caps = sandbox.getCapabilities();
      if (process.platform === 'linux') {
        expect(caps.platform).toBe('linux');
        expect(caps.rlimits).toBe(true);
      } else {
        // On non-Linux the sandbox still returns capabilities
        expect(caps.platform).toBeDefined();
      }
    });

    it('should cache capabilities', () => {
      const caps1 = sandbox.getCapabilities();
      const caps2 = sandbox.getCapabilities();
      expect(caps1).toBe(caps2); // Same reference
    });
  });

  describe('isAvailable()', () => {
    it('should return true on linux, false elsewhere', () => {
      if (process.platform === 'linux') {
        expect(sandbox.isAvailable()).toBe(true);
      } else {
        expect(sandbox.isAvailable()).toBe(false);
      }
    });
  });
});

describe('SandboxManager', () => {
  const defaultConfig: SandboxManagerConfig = {
    enabled: true,
    technology: 'auto',
    allowedReadPaths: ['/tmp'],
    allowedWritePaths: ['/tmp'],
    maxMemoryMb: 1024,
    maxCpuPercent: 50,
    maxFileSizeMb: 100,
    networkAllowed: true,
  };

  describe('detect()', () => {
    it('should detect platform capabilities', () => {
      const manager = new SandboxManager(defaultConfig);
      const caps = manager.detect();
      expect(caps.platform).toBeDefined();
      expect(typeof caps.landlock).toBe('boolean');
      expect(typeof caps.seccomp).toBe('boolean');
      expect(typeof caps.namespaces).toBe('boolean');
      expect(typeof caps.rlimits).toBe('boolean');
    });

    it('should cache capabilities', () => {
      const manager = new SandboxManager(defaultConfig);
      const caps1 = manager.detect();
      const caps2 = manager.detect();
      expect(caps1).toBe(caps2);
    });
  });

  describe('createSandbox()', () => {
    it('should create a sandbox based on platform', () => {
      const manager = new SandboxManager(defaultConfig);
      const sandbox = manager.createSandbox();
      expect(sandbox).toBeDefined();
      expect(sandbox.isAvailable()).toBe(true);
    });

    it('should return NoopSandbox when disabled', () => {
      const manager = new SandboxManager({ ...defaultConfig, enabled: false });
      const sandbox = manager.createSandbox();
      expect(sandbox.constructor.name).toBe('NoopSandbox');
    });

    it('should return NoopSandbox for technology=none', () => {
      const manager = new SandboxManager({ ...defaultConfig, technology: 'none' });
      const sandbox = manager.createSandbox();
      expect(sandbox.constructor.name).toBe('NoopSandbox');
    });

    it('should cache sandbox instance', () => {
      const manager = new SandboxManager(defaultConfig);
      const s1 = manager.createSandbox();
      const s2 = manager.createSandbox();
      expect(s1).toBe(s2);
    });

    it('should fall back to NoopSandbox for seccomp (not yet implemented)', () => {
      const manager = new SandboxManager({ ...defaultConfig, technology: 'seccomp' });
      const sandbox = manager.createSandbox();
      expect(sandbox.constructor.name).toBe('NoopSandbox');
    });

    it('should create LinuxSandbox on linux with technology=landlock', () => {
      if (process.platform !== 'linux') return; // skip on non-linux
      const manager = new SandboxManager({ ...defaultConfig, technology: 'landlock' });
      const sandbox = manager.createSandbox();
      expect(sandbox.constructor.name).toBe('LinuxSandbox');
    });
  });

  describe('isEnabled()', () => {
    it('should return true when enabled and technology != none', () => {
      const manager = new SandboxManager(defaultConfig);
      expect(manager.isEnabled()).toBe(true);
    });

    it('should return false when disabled', () => {
      const manager = new SandboxManager({ ...defaultConfig, enabled: false });
      expect(manager.isEnabled()).toBe(false);
    });

    it('should return false for technology=none', () => {
      const manager = new SandboxManager({ ...defaultConfig, technology: 'none' });
      expect(manager.isEnabled()).toBe(false);
    });
  });

  describe('getStatus()', () => {
    it('should return full status object', () => {
      const manager = new SandboxManager(defaultConfig);
      const status = manager.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.technology).toBe('auto');
      expect(status.capabilities).toBeDefined();
      expect(status.sandboxType).toBeDefined();
    });
  });

  describe('getConfig()', () => {
    it('should return the config', () => {
      const manager = new SandboxManager(defaultConfig);
      expect(manager.getConfig()).toEqual(defaultConfig);
    });
  });

  describe('getCapabilities()', () => {
    it('should delegate to detect()', () => {
      const manager = new SandboxManager(defaultConfig);
      expect(manager.getCapabilities()).toEqual(manager.detect());
    });
  });
});
