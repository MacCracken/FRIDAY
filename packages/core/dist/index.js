/**
 * @friday/core
 *
 * SecureClaw Core Agent Engine
 *
 * A security-first autonomous agent system with comprehensive logging,
 * audit trail, and performance metrics.
 */
// Main entry point
export { SecureClaw, createSecureClaw } from './secureclaw.js';
// Configuration
export { loadConfig, getSecret, requireSecret, validateSecrets } from './config/loader.js';
// Logging
export { createLogger, initializeLogger, getLogger, isLoggerInitialized } from './logging/logger.js';
export { AuditChain, InMemoryAuditStorage } from './logging/audit-chain.js';
// Security
export { InputValidator, createValidator } from './security/input-validator.js';
export { RateLimiter, createRateLimiter } from './security/rate-limiter.js';
export { RBAC, getRBAC, initializeRBAC, PermissionDeniedError } from './security/rbac.js';
export { SecretStore, createSecretStore, encrypt, decrypt, encryptValue, decryptValue, } from './security/secrets.js';
// Task Execution
export { TaskExecutor, createTaskExecutor } from './task/executor.js';
// Utilities
export { sha256, hmacSha256, secureCompare, randomHex, uuidv7, generateSecureToken, sanitizeForLogging } from './utils/crypto.js';
// Re-export shared types
export * from '@friday/shared';
//# sourceMappingURL=index.js.map