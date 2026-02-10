/**
 * Environment Variable Keyring Provider — wraps process.env.
 * Always available as a fallback.
 */

import type { KeyringProvider } from './types.js';

export class EnvironmentProvider implements KeyringProvider {
  readonly name = 'environment';

  isAvailable(): boolean {
    return true;
  }

  get(_service: string, key: string): string | undefined {
    return process.env[key];
  }

  set(_service: string, key: string, value: string): void {
    process.env[key] = value;
  }

  delete(_service: string, key: string): void {
    delete process.env[key];
  }
}
