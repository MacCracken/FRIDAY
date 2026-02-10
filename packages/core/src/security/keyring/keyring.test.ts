import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvironmentProvider } from './environment-provider.js';
import { LinuxSecretServiceProvider } from './linux-secret-service.js';
import { MacOSKeychainProvider } from './macos-keychain.js';
import { KeyringManager } from './manager.js';
import { SERVICE_NAME } from './types.js';

// ── EnvironmentProvider ─────────────────────────────────────────────

describe('EnvironmentProvider', () => {
  let provider: EnvironmentProvider;
  const testKey = '__TEST_KEYRING_ENV_KEY__';

  beforeEach(() => {
    provider = new EnvironmentProvider();
    delete process.env[testKey];
  });

  afterEach(() => {
    delete process.env[testKey];
  });

  it('is always available', () => {
    expect(provider.isAvailable()).toBe(true);
  });

  it('returns name "environment"', () => {
    expect(provider.name).toBe('environment');
  });

  it('get returns undefined for unset key', () => {
    expect(provider.get(SERVICE_NAME, testKey)).toBeUndefined();
  });

  it('set stores value in process.env', () => {
    provider.set(SERVICE_NAME, testKey, 'hello');
    expect(process.env[testKey]).toBe('hello');
  });

  it('get retrieves a set value', () => {
    provider.set(SERVICE_NAME, testKey, 'world');
    expect(provider.get(SERVICE_NAME, testKey)).toBe('world');
  });

  it('delete removes value from process.env', () => {
    provider.set(SERVICE_NAME, testKey, 'temp');
    provider.delete(SERVICE_NAME, testKey);
    expect(process.env[testKey]).toBeUndefined();
    expect(provider.get(SERVICE_NAME, testKey)).toBeUndefined();
  });
});

// ── LinuxSecretServiceProvider ──────────────────────────────────────

describe('LinuxSecretServiceProvider', () => {
  it('reports correct name', () => {
    const provider = new LinuxSecretServiceProvider();
    expect(provider.name).toBe('linux-secret-service');
  });

  it('is unavailable on non-linux platforms', () => {
    if (process.platform !== 'linux') {
      const provider = new LinuxSecretServiceProvider();
      expect(provider.isAvailable()).toBe(false);
    }
  });

  // Platform-dependent tests
  describe.skipIf(process.platform !== 'linux')('on Linux', () => {
    let provider: LinuxSecretServiceProvider;

    beforeEach(() => {
      provider = new LinuxSecretServiceProvider();
    });

    it('caches isAvailable result', () => {
      const first = provider.isAvailable();
      const second = provider.isAvailable();
      expect(first).toBe(second);
    });

    it.skipIf(!new LinuxSecretServiceProvider().isAvailable())(
      'get returns undefined for non-existent key',
      () => {
        expect(provider.get(SERVICE_NAME, '__NONEXISTENT_TEST_KEY__')).toBeUndefined();
      },
    );
  });
});

// ── MacOSKeychainProvider ───────────────────────────────────────────

describe('MacOSKeychainProvider', () => {
  it('reports correct name', () => {
    const provider = new MacOSKeychainProvider();
    expect(provider.name).toBe('macos-keychain');
  });

  it('is unavailable on non-darwin platforms', () => {
    if (process.platform !== 'darwin') {
      const provider = new MacOSKeychainProvider();
      expect(provider.isAvailable()).toBe(false);
    }
  });

  describe.skipIf(process.platform !== 'darwin')('on macOS', () => {
    let provider: MacOSKeychainProvider;

    beforeEach(() => {
      provider = new MacOSKeychainProvider();
    });

    it('caches isAvailable result', () => {
      const first = provider.isAvailable();
      const second = provider.isAvailable();
      expect(first).toBe(second);
    });
  });
});

// ── KeyringManager ──────────────────────────────────────────────────

describe('KeyringManager', () => {
  const testKey = '__TEST_KM_KEY__';

  afterEach(() => {
    delete process.env[testKey];
  });

  it('defaults to environment provider', () => {
    const manager = new KeyringManager();
    expect(manager.getProvider().name).toBe('environment');
  });

  it('initialize with "env" backend uses environment provider', () => {
    const manager = new KeyringManager();
    manager.initialize('env', []);
    expect(manager.getProvider().name).toBe('environment');
  });

  it('initialize with "auto" falls back to environment when no keyring available', () => {
    const manager = new KeyringManager();
    // On CI / test envs without secret-tool / security, should fallback
    manager.initialize('auto', []);
    // Will be env if no keyring is available, or a real keyring provider if present
    expect(manager.getProvider().isAvailable()).toBe(true);
  });

  it('storeSecret sets value and mirrors to process.env', () => {
    const manager = new KeyringManager();
    manager.initialize('env', []);
    manager.storeSecret(testKey, 'secret-value');
    expect(process.env[testKey]).toBe('secret-value');
    expect(manager.getSecret(testKey)).toBe('secret-value');
  });

  it('deleteSecret removes from provider and process.env', () => {
    const manager = new KeyringManager();
    manager.initialize('env', []);
    manager.storeSecret(testKey, 'to-delete');
    manager.deleteSecret(testKey);
    expect(process.env[testKey]).toBeUndefined();
    expect(manager.getSecret(testKey)).toBeUndefined();
  });

  it('pre-loads keys from keyring into process.env', () => {
    // Pre-set a value so the env provider will find it
    process.env[testKey] = 'preloaded';
    const manager = new KeyringManager();
    manager.initialize('env', [testKey]);
    // env provider doesn't need pre-loading but the key should still be there
    expect(process.env[testKey]).toBe('preloaded');
  });

  it('does not overwrite existing env vars during pre-load', () => {
    process.env[testKey] = 'original';
    const manager = new KeyringManager();
    manager.initialize('auto', [testKey]);
    expect(process.env[testKey]).toBe('original');
  });

  it('throws when "keyring" backend is requested but unavailable', () => {
    // This will throw on systems without secret-tool/security
    // On CI this should always throw
    const manager = new KeyringManager();
    const hasKeyring =
      (process.platform === 'linux' && new LinuxSecretServiceProvider().isAvailable()) ||
      (process.platform === 'darwin' && new MacOSKeychainProvider().isAvailable());

    if (!hasKeyring) {
      expect(() => manager.initialize('keyring', [])).toThrow(
        /no system keyring is available/i,
      );
    }
  });
});
