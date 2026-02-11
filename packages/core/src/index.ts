/**
 * @friday/core
 * 
 * SecureYeoman Core Agent Engine
 * 
 * A security-first autonomous agent system with comprehensive logging,
 * audit trail, and performance metrics.
 */

// Main entry point
export { SecureYeoman, createSecureYeoman, type SecureYeomanOptions, type SecureYeomanState } from './secureyeoman.js';

// Configuration
export { loadConfig, getSecret, requireSecret, validateSecrets, initializeKeyring, type LoadConfigOptions } from './config/loader.js';

// Logging
export { 
  createLogger, 
  initializeLogger, 
  getLogger, 
  isLoggerInitialized,
  type SecureLogger, 
  type LogContext, 
  type LogLevel 
} from './logging/logger.js';

export {
  AuditChain,
  InMemoryAuditStorage,
  type AuditChainStorage,
  type AuditChainConfig,
  type VerificationResult,
  type AuditQueryOptions,
  type AuditQueryResult,
} from './logging/audit-chain.js';

export {
  SQLiteAuditStorage,
} from './logging/sqlite-storage.js';

// Security
export { 
  InputValidator, 
  createValidator, 
  type ValidationResult, 
  type ValidationWarning, 
  type ValidationContext 
} from './security/input-validator.js';

export { 
  RateLimiter, 
  createRateLimiter, 
  type RateLimitResult, 
  type RateLimitRule 
} from './security/rate-limiter.js';

export {
  RBAC,
  getRBAC,
  initializeRBAC,
  PermissionDeniedError,
  type PermissionCheck,
  type PermissionResult
} from './security/rbac.js';

export {
  RBACStorage,
  type RoleDefinitionRow,
  type UserRoleAssignmentRow,
} from './security/rbac-storage.js';

export {
  SecretStore,
  createSecretStore,
  encrypt,
  decrypt,
  encryptValue,
  decryptValue,
  type SecretStoreConfig,
  type EncryptedData,
} from './security/secrets.js';

// Keyring
export {
  KeyringManager,
  EnvironmentProvider,
  LinuxSecretServiceProvider,
  MacOSKeychainProvider,
  SERVICE_NAME,
  type KeyringProvider,
  type SecretBackend,
} from './security/keyring/index.js';

// Rotation
export {
  SecretRotationManager,
  RotationStorage,
  type RotationManagerConfig,
  type RotationCallbacks,
  type SecretMetadata,
  type RotationStatus,
} from './security/rotation/index.js';

// Sandbox
export {
  NoopSandbox,
  LinuxSandbox,
  SandboxManager,
  type Sandbox,
  type SandboxCapabilities,
  type SandboxOptions,
  type SandboxResult,
  type SandboxViolation,
  type SandboxManagerConfig,
  type SandboxManagerDeps,
} from './sandbox/index.js';

// Task Execution
export {
  TaskExecutor,
  createTaskExecutor,
  type TaskExecutorConfig,
  type ExecutionContext,
  type TaskHandler
} from './task/executor.js';

export {
  TaskStorage,
  type TaskFilter,
  type TaskStats,
} from './task/task-storage.js';

// Utilities
export { 
  sha256, 
  hmacSha256, 
  secureCompare, 
  randomHex, 
  uuidv7, 
  generateSecureToken,
  sanitizeForLogging 
} from './utils/crypto.js';

// AI
export {
  AIClient,
  type AIClientConfig,
  type AIClientDeps,
  type AIProvider,
  BaseProvider,
  type ProviderConfig,
  AnthropicProvider,
  OpenAIProvider,
  GeminiProvider,
  OllamaProvider,
  RetryManager,
  type RetryConfig,
  CostCalculator,
  UsageTracker,
  type UsageStats,
  type UsageRecord,
  AIProviderError,
  RateLimitError,
  TokenLimitError,
  InvalidResponseError,
  ProviderUnavailableError,
  AuthenticationError,
} from './ai/index.js';

// Brain
export {
  BrainStorage,
  BrainManager,
  type Memory,
  type MemoryType,
  type MemoryCreate,
  type MemoryQuery,
  type KnowledgeEntry,
  type KnowledgeCreate,
  type KnowledgeQuery,
  type BrainManagerDeps,
  type BrainStats,
} from './brain/index.js';

export {
  registerBrainRoutes,
  type BrainRoutesOptions,
} from './brain/brain-routes.js';

// Comms
export {
  AgentCrypto,
  AgentComms,
  CommsStorage,
  sanitizePayload,
  type AgentIdentity,
  type EncryptedMessage,
  type MessagePayload,
  type DecryptedLogEntry,
  type MessageLogQuery,
  type AgentCommsDeps,
} from './comms/index.js';

export {
  registerCommsRoutes,
  type CommsRoutesOptions,
} from './comms/comms-routes.js';

// Soul
export {
  SoulStorage,
  SoulManager,
  type SoulManagerDeps,
  type SkillFilter,
} from './soul/index.js';

export {
  registerSoulRoutes,
  type SoulRoutesOptions,
} from './soul/soul-routes.js';

// Auth
export {
  AuthStorage,
  type ApiKeyRow,
} from './security/auth-storage.js';

export {
  AuthService,
  AuthError,
  type AuthUser,
  type LoginResult,
  type ApiKeyCreateResult,
  type AuthServiceConfig,
  type AuthServiceDeps,
} from './security/auth.js';

export {
  createAuthHook,
  createRbacHook,
  type AuthHookOptions,
  type RbacHookOptions,
} from './gateway/auth-middleware.js';

export {
  registerAuthRoutes,
  type AuthRoutesOptions,
} from './gateway/auth-routes.js';

// Integrations
export {
  IntegrationStorage,
  IntegrationManager,
  MessageRouter,
  registerIntegrationRoutes,
  type IntegrationManagerDeps,
  type MessageRouterDeps,
  type IntegrationRoutesOptions,
  type Integration,
  type PlatformAdapter,
  type IntegrationDeps,
  type IntegrationRegistryEntry,
} from './integrations/index.js';

// Gateway
export {
  GatewayServer,
  createGatewayServer,
  type GatewayServerOptions,
} from './gateway/server.js';

// Re-export shared types
export * from '@friday/shared';
