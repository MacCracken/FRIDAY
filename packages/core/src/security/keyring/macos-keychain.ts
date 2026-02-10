/**
 * macOS Keychain Provider — uses `security` CLI.
 * All CLI calls use execFileSync with array args (no shell injection).
 */

import { execFileSync } from 'node:child_process';
import type { KeyringProvider } from './types.js';

export class MacOSKeychainProvider implements KeyringProvider {
  readonly name = 'macos-keychain';
  private available: boolean | null = null;

  isAvailable(): boolean {
    if (this.available !== null) return this.available;

    if (process.platform !== 'darwin') {
      this.available = false;
      return false;
    }

    try {
      execFileSync('which', ['security'], { stdio: 'pipe' });
      this.available = true;
    } catch {
      this.available = false;
    }

    return this.available;
  }

  get(service: string, key: string): string | undefined {
    try {
      const result = execFileSync(
        'security',
        ['find-generic-password', '-s', service, '-a', key, '-w'],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
      const value = result.toString('utf-8').trimEnd();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  set(service: string, key: string, value: string): void {
    try {
      // -U flag: update if exists
      execFileSync(
        'security',
        ['add-generic-password', '-U', '-s', service, '-a', key, '-w', value],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
    } catch (err) {
      throw new Error(
        `security add-generic-password failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  delete(service: string, key: string): void {
    try {
      execFileSync(
        'security',
        ['delete-generic-password', '-s', service, '-a', key],
        { stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 },
      );
    } catch {
      // Ignore errors on delete (key may not exist)
    }
  }
}
