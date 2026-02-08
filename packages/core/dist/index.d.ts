/**
 * @friday/core
 *
 * SecureClaw Core Agent Engine
 *
 * A security-first autonomous agent system with comprehensive logging,
 * audit trail, and performance metrics.
 */
export { SecureClaw, createSecureClaw, type SecureClawOptions, type SecureClawState } from './secureclaw.js';
export { loadConfig, getSecret, requireSecret, validateSecrets, type LoadConfigOptions } from './config/loader.js';
export { createLogger, initializeLogger, getLogger, isLoggerInitialized, type SecureLogger, type LogContext, type LogLevel } from './logging/logger.js';
export { AuditChain, InMemoryAuditStorage, type AuditChainStorage, type AuditChainConfig, type VerificationResult } from './logging/audit-chain.js';
export { InputValidator, createValidator, type ValidationResult, type ValidationWarning, type ValidationContext } from './security/input-validator.js';
export { RateLimiter, createRateLimiter, type RateLimitResult, type RateLimitRule } from './security/rate-limiter.js';
export { RBAC, getRBAC, initializeRBAC, PermissionDeniedError, type PermissionCheck, type PermissionResult } from './security/rbac.js';
export { SecretStore, createSecretStore, encrypt, decrypt, encryptValue, decryptValue, type SecretStoreConfig, type EncryptedData, } from './security/secrets.js';
export { TaskExecutor, createTaskExecutor, type TaskExecutorConfig, type ExecutionContext, type TaskHandler } from './task/executor.js';
export { sha256, hmacSha256, secureCompare, randomHex, uuidv7, generateSecureToken, sanitizeForLogging } from './utils/crypto.js';
export * from '@friday/shared';
//# sourceMappingURL=index.d.ts.map