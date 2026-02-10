/**
 * Linux Secret Service Provider — uses `secret-tool` CLI (libsecret).
 * All CLI calls use execFileSync with array args (no shell injection).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import type { KeyringProvider } from './types.js';

export class LinuxSecretServiceProvider implements KeyringProvider {
  readonly name = 'linux-secret-service';
  private available: boolean | null = null;

  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    if (process.platform !== 'linux') {
      this.available = false;
      return false;
    }

    try {
      execFileSync('which', ['secret-tool'], { stdio: 'pipe' });
      this.available = true;
    } catch {
      this.available = false;
    }

    return this.available;
  }

  get(service: string, key: string): string | undefined {
    try {
      const result = execFileSync(
        'secret-tool',
        ['lookup', 'service', service, 'name', key],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
      const value = result.toString('utf-8').trimEnd();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  set(service: string, key: string, value: string): void {
    const result = spawnSync(
      'secret-tool',
      ['store', `--label=${service}:${key}`, 'service', service, 'name', key],
      { input: value, stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
    );

    if (result.status !== 0) {
      throw new Error(
        `secret-tool store failed: ${result.stderr?.toString('utf-8').trim() ?? 'unknown error'}`,
      );
    }
  }

  delete(service: string, key: string): void {
    try {
      execFileSync(
        'secret-tool',
        ['clear', 'service', service, 'name', key],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
    } catch {
      // Ignore errors on delete (key may not exist)
    }
  }
}
