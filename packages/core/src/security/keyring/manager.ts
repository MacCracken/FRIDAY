/**
 * Keyring Manager — orchestrates provider selection and secret pre-loading.
 *
 * At startup, secrets are loaded from the active provider into process.env
 * so that the existing sync getSecret() API continues to work unchanged.
 */

import type { KeyringProvider, SecretBackend } from './types.js';
import { SERVICE_NAME } from './types.js';
import { EnvironmentProvider } from './environment-provider.js';
import { LinuxSecretServiceProvider } from './linux-secret-service.js';
import { MacOSKeychainProvider } from './macos-keychain.js';

export class KeyringManager {
  private provider: KeyringProvider;
  private readonly fallback: EnvironmentProvider;

  constructor() {
    this.fallback = new EnvironmentProvider();
    this.provider = this.fallback;
  }

  /**
   * Initialize the manager: select a provider and pre-load known keys
   * into process.env for backwards compatibility.
   */
  initialize(backend: SecretBackend, knownKeys: string[]): void {
    this.provider = this.selectProvider(backend);
    this.preloadSecrets(knownKeys);
  }

  /**
   * Get the active provider.
   */
  getProvider(): KeyringProvider {
    return this.provider;
  }

  /**
   * Store a secret via the active provider.
   */
  storeSecret(key: string, value: string): void {
    this.provider.set(SERVICE_NAME, key, value);
    // Also mirror to process.env for sync access
    process.env[key] = value;
  }

  /**
   * Retrieve a secret via the active provider.
   */
  getSecret(key: string): string | undefined {
    return this.provider.get(SERVICE_NAME, key);
  }

  /**
   * Delete a secret from the active provider.
   */
  deleteSecret(key: string): void {
    this.provider.delete(SERVICE_NAME, key);
    delete process.env[key];
  }

  // ── Private ──────────────────────────────────────────────────────

  private selectProvider(backend: SecretBackend): KeyringProvider {
    if (backend === 'env') {
      return this.fallback;
    }

    const candidates: KeyringProvider[] = [
      new LinuxSecretServiceProvider(),
      new MacOSKeychainProvider(),
    ];

    if (backend === 'keyring') {
      const found = candidates.find((p) => p.isAvailable());
      if (!found) {
        throw new Error(
          'Keyring backend requested but no system keyring is available. ' +
          'Install secret-tool (Linux) or ensure security CLI (macOS) is accessible.',
        );
      }
      return found;
    }

    // backend === 'auto' or 'file' (file falls through to auto for now)
    const available = candidates.find((p) => p.isAvailable());
    return available ?? this.fallback;
  }

  private preloadSecrets(knownKeys: string[]): void {
    if (this.provider === this.fallback) {
      // env provider already reads from process.env, nothing to pre-load
      return;
    }

    for (const key of knownKeys) {
      // Only load from keyring if not already set in environment
      if (!process.env[key]) {
        const value = this.provider.get(SERVICE_NAME, key);
        if (value) {
          process.env[key] = value;
        }
      }
    }
  }
}
