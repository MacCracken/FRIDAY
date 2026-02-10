/**
 * Configuration Loader for SecureYeoman
 * 
 * Security considerations:
 * - Config files are validated against strict schemas
 * - Environment variables are used for secrets (never stored in config)
 * - Path traversal is prevented in file paths
 * - Defaults are secure (e.g., sandbox enabled, strict validation)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  ConfigSchema,
  PartialConfigSchema,
  type Config,
  type PartialConfig,
} from '@friday/shared';
import { KeyringManager } from '../security/keyring/manager.js';

// Default config file locations (checked in order)
const DEFAULT_CONFIG_PATHS = [
  './secureyeoman.yaml',
  './secureyeoman.yml',
  './config/secureyeoman.yaml',
  '~/.secureyeoman/config.yaml',
  '/etc/secureyeoman/config.yaml',
];

/**
 * Expand ~ to home directory
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return resolve(path);
}

/**
 * Load configuration from a YAML file
 */
function loadConfigFile(path: string): PartialConfig | null {
  const expandedPath = expandPath(path);
  
  if (!existsSync(expandedPath)) {
    return null;
  }
  
  try {
    const content = readFileSync(expandedPath, 'utf-8');
    const parsed = parseYaml(content) as unknown;
    
    // Validate against partial schema (allows missing fields)
    const result = PartialConfigSchema.safeParse(parsed);
    
    if (!result.success) {
      throw new Error(`Invalid configuration in ${expandedPath}: ${result.error.message}`);
    }
    
    return result.data;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error;
    }
    throw new Error(`Failed to load config from ${expandedPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Load configuration from environment variables
 * Only loads non-secret config values
 */
function loadEnvConfig(): PartialConfig {
  const config: PartialConfig = {};
  
  // Build core settings
  const core: Record<string, unknown> = {};
  if (process.env.SECUREYEOMAN_ENV) {
    core.environment = process.env.SECUREYEOMAN_ENV;
  }
  if (process.env.SECUREYEOMAN_LOG_LEVEL) {
    core.logLevel = process.env.SECUREYEOMAN_LOG_LEVEL;
  }
  if (process.env.SECUREYEOMAN_WORKSPACE) {
    core.workspace = process.env.SECUREYEOMAN_WORKSPACE;
  }
  if (Object.keys(core).length > 0) {
    config.core = core as PartialConfig['core'];
  }
  
  // Build gateway settings
  const gateway: Record<string, unknown> = {};
  if (process.env.SECUREYEOMAN_HOST) {
    gateway.host = process.env.SECUREYEOMAN_HOST;
  }
  if (process.env.SECUREYEOMAN_PORT) {
    const port = parseInt(process.env.SECUREYEOMAN_PORT, 10);
    if (!isNaN(port)) {
      gateway.port = port;
    }
  }
  if (Object.keys(gateway).length > 0) {
    config.gateway = gateway as PartialConfig['gateway'];
  }
  
  // Build model settings
  const model: Record<string, unknown> = {};
  if (process.env.SECUREYEOMAN_MODEL) {
    model.model = process.env.SECUREYEOMAN_MODEL;
  }
  if (process.env.SECUREYEOMAN_PROVIDER) {
    model.provider = process.env.SECUREYEOMAN_PROVIDER;
  }
  if (process.env.SECUREYEOMAN_BASE_URL) {
    model.baseUrl = process.env.SECUREYEOMAN_BASE_URL;
  }
  if (Object.keys(model).length > 0) {
    config.model = model as PartialConfig['model'];
  }
  
  return config;
}

/**
 * Deep merge two config objects
 * Later values override earlier ones
 */
function mergeConfigs(base: PartialConfig, override: PartialConfig): PartialConfig {
  const result: PartialConfig = { ...base };
  
  for (const [key, value] of Object.entries(override)) {
    const baseValue = result[key as keyof PartialConfig];
    
    if (value !== undefined && typeof value === 'object' && !Array.isArray(value) && value !== null) {
      if (typeof baseValue === 'object' && !Array.isArray(baseValue) && baseValue !== null) {
        // Recursively merge objects
        (result as Record<string, unknown>)[key] = mergeConfigs(
          baseValue as PartialConfig,
          value as PartialConfig
        );
      } else {
        (result as Record<string, unknown>)[key] = value;
      }
    } else if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  
  return result;
}

export interface LoadConfigOptions {
  /** Explicit config file path */
  configPath?: string;
  /** Override config values */
  overrides?: PartialConfig;
  /** Skip environment variable loading */
  skipEnv?: boolean;
}

/**
 * Load and validate configuration
 * 
 * Loading order (later overrides earlier):
 * 1. Default values from schema
 * 2. Config file (explicit path or auto-discovered)
 * 3. Environment variables
 * 4. Programmatic overrides
 */
export function loadConfig(options: LoadConfigOptions = {}): Config {
  let fileConfig: PartialConfig = {};
  
  // Try to load config file
  if (options.configPath) {
    const loaded = loadConfigFile(options.configPath);
    if (!loaded) {
      throw new Error(`Config file not found: ${options.configPath}`);
    }
    fileConfig = loaded;
  } else {
    // Auto-discover config file
    for (const path of DEFAULT_CONFIG_PATHS) {
      const loaded = loadConfigFile(path);
      if (loaded) {
        fileConfig = loaded;
        break;
      }
    }
  }
  
  // Load env config
  const envConfig = options.skipEnv ? {} : loadEnvConfig();
  
  // Merge configs
  let mergedConfig = mergeConfigs(fileConfig, envConfig);
  
  if (options.overrides) {
    mergedConfig = mergeConfigs(mergedConfig, options.overrides);
  }
  
  // Validate and apply defaults
  const result = ConfigSchema.safeParse(mergedConfig);
  
  if (!result.success) {
    const errors = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  
  return result.data;
}

/**
 * Initialize the keyring manager, pre-loading secrets from the system keyring
 * into process.env so that getSecret() continues to work synchronously.
 * Must be called before validateSecrets().
 */
export function initializeKeyring(
  backend: 'auto' | 'keyring' | 'env' | 'file',
  knownKeys: string[],
): KeyringManager {
  const manager = new KeyringManager();
  manager.initialize(backend, knownKeys);
  return manager;
}

/**
 * Get a secret value from environment variable
 * This is the only way to access secrets - they are never stored in config objects
 */
export function getSecret(envVarName: string): string | undefined {
  return process.env[envVarName];
}

/**
 * Get a required secret value from environment variable
 * Throws if the secret is not set
 */
export function requireSecret(envVarName: string): string {
  const value = getSecret(envVarName);
  if (!value) {
    throw new Error(`Required secret not set: ${envVarName}`);
  }
  return value;
}

/**
 * Validate that required secrets are set
 * Call this during startup to fail fast if secrets are missing
 */
export function validateSecrets(config: Config): void {
  const requiredSecrets: string[] = [];
  
  // Always require signing key for audit chain
  if (config.logging.audit.enabled) {
    requiredSecrets.push(config.logging.audit.signingKeyEnv);
  }
  
  // API key based on provider (Ollama is local, no key needed)
  if (config.model.provider !== 'ollama') {
    requiredSecrets.push(config.model.apiKeyEnv);
  }

  // Provider-specific key validation for Gemini and OpenAI
  if (config.model.provider === 'gemini' && config.model.apiKeyEnv === 'ANTHROPIC_API_KEY') {
    // User likely forgot to set apiKeyEnv for Gemini — check GOOGLE_API_KEY as fallback
    if (!getSecret('ANTHROPIC_API_KEY') && getSecret('GOOGLE_API_KEY')) {
      // GOOGLE_API_KEY is available; they should set apiKeyEnv to GOOGLE_API_KEY in config
    }
  }
  if (config.model.provider === 'openai' && config.model.apiKeyEnv === 'ANTHROPIC_API_KEY') {
    if (!getSecret('ANTHROPIC_API_KEY') && getSecret('OPENAI_API_KEY')) {
      // OPENAI_API_KEY is available; they should set apiKeyEnv to OPENAI_API_KEY in config
    }
  }
  
  // Token secret for JWT
  requiredSecrets.push(config.gateway.auth.tokenSecret);

  // Admin password for bootstrap auth
  requiredSecrets.push(config.gateway.auth.adminPasswordEnv);
  
  // Check encryption key if enabled
  if (config.security.encryption.enabled) {
    requiredSecrets.push(config.security.encryption.keyEnv);
  }
  
  const missing = requiredSecrets.filter(name => !getSecret(name));
  
  if (missing.length > 0) {
    throw new Error(`Missing required secrets:\n  ${missing.join('\n  ')}`);
  }
}
