/**
 * Configuration Loader for SecureClaw
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
import { ConfigSchema, PartialConfigSchema, } from '@friday/shared';
// Default config file locations (checked in order)
const DEFAULT_CONFIG_PATHS = [
    './secureclaw.yaml',
    './secureclaw.yml',
    './config/secureclaw.yaml',
    '~/.secureclaw/config.yaml',
    '/etc/secureclaw/config.yaml',
];
/**
 * Expand ~ to home directory
 */
function expandPath(path) {
    if (path.startsWith('~/')) {
        return resolve(homedir(), path.slice(2));
    }
    return resolve(path);
}
/**
 * Load configuration from a YAML file
 */
function loadConfigFile(path) {
    const expandedPath = expandPath(path);
    if (!existsSync(expandedPath)) {
        return null;
    }
    try {
        const content = readFileSync(expandedPath, 'utf-8');
        const parsed = parseYaml(content);
        // Validate against partial schema (allows missing fields)
        const result = PartialConfigSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Invalid configuration in ${expandedPath}: ${result.error.message}`);
        }
        return result.data;
    }
    catch (error) {
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
function loadEnvConfig() {
    const config = {};
    // Build core settings
    const core = {};
    if (process.env['SECURECLAW_ENV']) {
        core['environment'] = process.env['SECURECLAW_ENV'];
    }
    if (process.env['SECURECLAW_LOG_LEVEL']) {
        core['logLevel'] = process.env['SECURECLAW_LOG_LEVEL'];
    }
    if (process.env['SECURECLAW_WORKSPACE']) {
        core['workspace'] = process.env['SECURECLAW_WORKSPACE'];
    }
    if (Object.keys(core).length > 0) {
        config.core = core;
    }
    // Build gateway settings
    const gateway = {};
    if (process.env['SECURECLAW_HOST']) {
        gateway['host'] = process.env['SECURECLAW_HOST'];
    }
    if (process.env['SECURECLAW_PORT']) {
        const port = parseInt(process.env['SECURECLAW_PORT'], 10);
        if (!isNaN(port)) {
            gateway['port'] = port;
        }
    }
    if (Object.keys(gateway).length > 0) {
        config.gateway = gateway;
    }
    // Build model settings
    const model = {};
    if (process.env['SECURECLAW_MODEL']) {
        model['model'] = process.env['SECURECLAW_MODEL'];
    }
    if (process.env['SECURECLAW_PROVIDER']) {
        model['provider'] = process.env['SECURECLAW_PROVIDER'];
    }
    if (Object.keys(model).length > 0) {
        config.model = model;
    }
    return config;
}
/**
 * Deep merge two config objects
 * Later values override earlier ones
 */
function mergeConfigs(base, override) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseValue = result[key];
        if (value !== undefined && typeof value === 'object' && !Array.isArray(value) && value !== null) {
            if (typeof baseValue === 'object' && !Array.isArray(baseValue) && baseValue !== null) {
                // Recursively merge objects
                result[key] = mergeConfigs(baseValue, value);
            }
            else {
                result[key] = value;
            }
        }
        else if (value !== undefined) {
            result[key] = value;
        }
    }
    return result;
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
export function loadConfig(options = {}) {
    let fileConfig = {};
    // Try to load config file
    if (options.configPath) {
        const loaded = loadConfigFile(options.configPath);
        if (!loaded) {
            throw new Error(`Config file not found: ${options.configPath}`);
        }
        fileConfig = loaded;
    }
    else {
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
 * Get a secret value from environment variable
 * This is the only way to access secrets - they are never stored in config objects
 */
export function getSecret(envVarName) {
    return process.env[envVarName];
}
/**
 * Get a required secret value from environment variable
 * Throws if the secret is not set
 */
export function requireSecret(envVarName) {
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
export function validateSecrets(config) {
    const requiredSecrets = [];
    // Always require signing key for audit chain
    if (config.logging.audit.enabled) {
        requiredSecrets.push(config.logging.audit.signingKeyEnv);
    }
    // API key based on provider
    if (config.model.provider !== 'ollama') {
        requiredSecrets.push(config.model.apiKeyEnv);
    }
    // Token secret for JWT
    requiredSecrets.push(config.gateway.auth.tokenSecret);
    // Check encryption key if enabled
    if (config.security.encryption.enabled) {
        requiredSecrets.push(config.security.encryption.keyEnv);
    }
    const missing = requiredSecrets.filter(name => !getSecret(name));
    if (missing.length > 0) {
        throw new Error(`Missing required secrets:\n  ${missing.join('\n  ')}`);
    }
}
//# sourceMappingURL=loader.js.map