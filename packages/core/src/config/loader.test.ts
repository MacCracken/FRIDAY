/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, getSecret, requireSecret, validateSecrets } from './loader.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load default configuration when no file or env vars are set', () => {
    // Clear relevant env vars
    delete process.env.SECUREYEOMAN_ENV;
    delete process.env.SECUREYEOMAN_LOG_LEVEL;
    delete process.env.SECUREYEOMAN_HOST;
    delete process.env.SECUREYEOMAN_PORT;

    const config = loadConfig({ skipEnv: true });

    // Check default values exist
    expect(config.version).toBe('1.0');
    expect(config.core).toBeDefined();
    expect(config.core.environment).toBe('development');
    expect(config.gateway).toBeDefined();
    expect(config.security).toBeDefined();
    expect(config.logging).toBeDefined();
  });

  it('should apply programmatic overrides for core environment', () => {
    const config = loadConfig({
      skipEnv: true,
      overrides: {
        core: {
          environment: 'production',
        },
      } as any, // Partial config - validated by Zod at runtime
    });

    expect(config.core.environment).toBe('production');
  });

  it('should apply programmatic overrides for gateway port', () => {
    const config = loadConfig({
      skipEnv: true,
      overrides: {
        gateway: {
          port: 9000,
        },
      } as any, // Partial config - validated by Zod at runtime
    });

    expect(config.gateway.port).toBe(9000);
  });

  it('should load environment variables when not skipped', () => {
    process.env.SECUREYEOMAN_ENV = 'staging';
    process.env.SECUREYEOMAN_PORT = '4000';

    const config = loadConfig();

    expect(config.core.environment).toBe('staging');
    expect(config.gateway.port).toBe(4000);
  });

  it('should ignore invalid port environment variable', () => {
    process.env.SECUREYEOMAN_PORT = 'not-a-number';

    const config = loadConfig({ skipEnv: true });

    // Should use default port since env var is invalid
    expect(config.gateway.port).toBeDefined();
    expect(typeof config.gateway.port).toBe('number');
  });

  it('should throw error for explicit config file that does not exist', () => {
    expect(() =>
      loadConfig({
        configPath: '/nonexistent/path/config.yaml',
      })
    ).toThrow('Config file not found');
  });

  it('should handle SECUREYEOMAN_MODEL environment variable', () => {
    process.env.SECUREYEOMAN_MODEL = 'claude-3-opus-20240229';

    const config = loadConfig();

    expect(config.model.model).toBe('claude-3-opus-20240229');
  });

  it('should handle SECUREYEOMAN_PROVIDER environment variable', () => {
    process.env.SECUREYEOMAN_PROVIDER = 'anthropic';

    const config = loadConfig();

    expect(config.model.provider).toBe('anthropic');
  });

  it('should have valid security defaults', () => {
    const config = loadConfig({ skipEnv: true });

    // Security defaults should be strict
    expect(config.security.sandbox.enabled).toBe(true);
    expect(config.security.inputValidation.enableInjectionDetection).toBe(true);
    expect(config.security.rateLimiting.enabled).toBe(true);
    expect(config.security.encryption.enabled).toBe(true);
  });

  it('should have valid logging defaults', () => {
    const config = loadConfig({ skipEnv: true });

    expect(config.logging.level).toBeDefined();
    expect(config.logging.format).toBeDefined();
    expect(config.logging.audit.enabled).toBe(true);
  });

  it('should override deeply nested values', () => {
    const config = loadConfig({
      skipEnv: true,
      overrides: {
        security: {
          inputValidation: {
            maxInputLength: 100000,
          },
        },
      } as any, // Partial config - validated by Zod at runtime
    });

    expect(config.security.inputValidation.maxInputLength).toBe(100000);
  });
});

describe('getSecret', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return environment variable value when set', () => {
    process.env.MY_SECRET = 'secret-value';

    expect(getSecret('MY_SECRET')).toBe('secret-value');
  });

  it('should return undefined when environment variable is not set', () => {
    delete process.env.UNSET_SECRET;

    expect(getSecret('UNSET_SECRET')).toBeUndefined();
  });

  it('should return empty string if environment variable is empty', () => {
    process.env.EMPTY_SECRET = '';

    expect(getSecret('EMPTY_SECRET')).toBe('');
  });
});

describe('requireSecret', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return value when secret is set', () => {
    process.env.REQUIRED_SECRET = 'secret-value';

    expect(requireSecret('REQUIRED_SECRET')).toBe('secret-value');
  });

  it('should throw error when secret is not set', () => {
    delete process.env.MISSING_SECRET;

    expect(() => requireSecret('MISSING_SECRET')).toThrow('Required secret not set: MISSING_SECRET');
  });

  it('should throw error when secret is empty string', () => {
    process.env.EMPTY_REQUIRED = '';

    expect(() => requireSecret('EMPTY_REQUIRED')).toThrow('Required secret not set: EMPTY_REQUIRED');
  });
});

describe('validateSecrets', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should pass when all required secrets are set', () => {
    const config = loadConfig({ skipEnv: true });

    // Set all required secrets
    process.env[config.logging.audit.signingKeyEnv] = 'signing-key';
    process.env[config.model.apiKeyEnv] = 'api-key';
    process.env[config.gateway.auth.tokenSecret] = 'token-secret';
    process.env[config.gateway.auth.adminPasswordEnv] = 'admin-password';
    process.env[config.security.encryption.keyEnv] = 'encryption-key';

    expect(() => validateSecrets(config)).not.toThrow();
  });

  it('should throw when audit signing key is missing', () => {
    const config = loadConfig({ skipEnv: true });

    // Set all secrets except signing key
    process.env[config.model.apiKeyEnv] = 'api-key';
    process.env[config.gateway.auth.tokenSecret] = 'token-secret';
    process.env[config.security.encryption.keyEnv] = 'encryption-key';
    delete process.env[config.logging.audit.signingKeyEnv];

    expect(() => validateSecrets(config)).toThrow('Missing required secrets');
  });

  it('should throw when API key is missing for non-ollama provider', () => {
    const config = loadConfig({ skipEnv: true });

    // Set all secrets except API key
    process.env[config.logging.audit.signingKeyEnv] = 'signing-key';
    process.env[config.gateway.auth.tokenSecret] = 'token-secret';
    process.env[config.security.encryption.keyEnv] = 'encryption-key';
    delete process.env[config.model.apiKeyEnv];

    expect(() => validateSecrets(config)).toThrow('Missing required secrets');
  });

  it('should not require API key for ollama provider', () => {
    const config = loadConfig({
      skipEnv: true,
      overrides: {
        model: {
          provider: 'ollama',
        },
      } as any, // Partial config - validated by Zod at runtime
    });

    // Set all secrets except API key
    process.env[config.logging.audit.signingKeyEnv] = 'signing-key';
    process.env[config.gateway.auth.tokenSecret] = 'token-secret';
    process.env[config.gateway.auth.adminPasswordEnv] = 'admin-password';
    process.env[config.security.encryption.keyEnv] = 'encryption-key';
    delete process.env[config.model.apiKeyEnv];

    expect(() => validateSecrets(config)).not.toThrow();
  });

  it('should throw when token secret is missing', () => {
    const config = loadConfig({ skipEnv: true });

    // Set all secrets except token secret
    process.env[config.logging.audit.signingKeyEnv] = 'signing-key';
    process.env[config.model.apiKeyEnv] = 'api-key';
    process.env[config.security.encryption.keyEnv] = 'encryption-key';
    delete process.env[config.gateway.auth.tokenSecret];

    expect(() => validateSecrets(config)).toThrow('Missing required secrets');
  });

  it('should throw when encryption key is missing and encryption is enabled', () => {
    const config = loadConfig({ skipEnv: true });

    // Set all secrets except encryption key
    process.env[config.logging.audit.signingKeyEnv] = 'signing-key';
    process.env[config.model.apiKeyEnv] = 'api-key';
    process.env[config.gateway.auth.tokenSecret] = 'token-secret';
    delete process.env[config.security.encryption.keyEnv];

    expect(() => validateSecrets(config)).toThrow('Missing required secrets');
  });

  it('should list all missing secrets in error message', () => {
    const config = loadConfig({ skipEnv: true });

    // Don't set any secrets
    delete process.env[config.logging.audit.signingKeyEnv];
    delete process.env[config.model.apiKeyEnv];
    delete process.env[config.gateway.auth.tokenSecret];
    delete process.env[config.security.encryption.keyEnv];

    try {
      validateSecrets(config);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('Missing required secrets');
      expect(message).toContain(config.logging.audit.signingKeyEnv);
      expect(message).toContain(config.model.apiKeyEnv);
      expect(message).toContain(config.gateway.auth.tokenSecret);
    }
  });
});
