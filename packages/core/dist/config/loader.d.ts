/**
 * Configuration Loader for SecureClaw
 *
 * Security considerations:
 * - Config files are validated against strict schemas
 * - Environment variables are used for secrets (never stored in config)
 * - Path traversal is prevented in file paths
 * - Defaults are secure (e.g., sandbox enabled, strict validation)
 */
import { type Config, type PartialConfig } from '@friday/shared';
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
export declare function loadConfig(options?: LoadConfigOptions): Config;
/**
 * Get a secret value from environment variable
 * This is the only way to access secrets - they are never stored in config objects
 */
export declare function getSecret(envVarName: string): string | undefined;
/**
 * Get a required secret value from environment variable
 * Throws if the secret is not set
 */
export declare function requireSecret(envVarName: string): string;
/**
 * Validate that required secrets are set
 * Call this during startup to fail fast if secrets are missing
 */
export declare function validateSecrets(config: Config): void;
//# sourceMappingURL=loader.d.ts.map