import { describe, it, expect, vi } from 'vitest';
import { DarwinSandbox } from './darwin-sandbox.js';

describe('DarwinSandbox', () => {
  const sandbox = new DarwinSandbox();

  describe('getCapabilities()', () => {
    it('reports darwin platform capabilities', () => {
      const caps = sandbox.getCapabilities();
      expect(caps.platform).toBe('darwin');
      expect(caps.landlock).toBe(false);
      expect(caps.seccomp).toBe(false);
      expect(caps.namespaces).toBe(false);
      expect(caps.rlimits).toBe(true);
    });
  });

  describe('isAvailable()', () => {
    it('returns false on non-macOS platforms', () => {
      if (process.platform !== 'darwin') {
        expect(sandbox.isAvailable()).toBe(false);
      }
    });
  });

  describe('generateProfile()', () => {
    it('generates a deny-default profile', () => {
      const profile = sandbox.generateProfile();
      expect(profile).toContain('(version 1)');
      expect(profile).toContain('(deny default)');
    });

    it('includes system read paths', () => {
      const profile = sandbox.generateProfile();
      expect(profile).toContain('(allow file-read* (subpath "/usr"))');
      expect(profile).toContain('(allow file-read* (subpath "/System"))');
    });

    it('includes user-specified read paths', () => {
      const profile = sandbox.generateProfile({
        filesystem: {
          readPaths: ['/tmp/data'],
          writePaths: [],
          execPaths: [],
        },
      });
      expect(profile).toContain('(allow file-read* (subpath "/tmp/data"))');
    });

    it('includes user-specified write paths with read access', () => {
      const profile = sandbox.generateProfile({
        filesystem: {
          readPaths: [],
          writePaths: ['/tmp/output'],
          execPaths: [],
        },
      });
      expect(profile).toContain('(allow file-read* (subpath "/tmp/output"))');
      expect(profile).toContain('(allow file-write* (subpath "/tmp/output"))');
    });

    it('allows network by default', () => {
      const profile = sandbox.generateProfile();
      expect(profile).toContain('(allow network*)');
    });

    it('restricts network when disabled', () => {
      const profile = sandbox.generateProfile({
        network: { allowed: false },
      });
      expect(profile).not.toContain('(allow network*)');
      expect(profile).toContain('(allow network-outbound (remote ip "localhost:*"))');
    });
  });

  describe('run()', () => {
    it('executes functions and returns results', async () => {
      const result = await sandbox.run(async () => 42);
      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.resourceUsage?.cpuTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.resourceUsage?.memoryPeakMb).toBeGreaterThan(0);
    });

    it('captures errors', async () => {
      const result = await sandbox.run(async () => {
        throw new Error('test error');
      });
      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('test error');
    });
  });
});
