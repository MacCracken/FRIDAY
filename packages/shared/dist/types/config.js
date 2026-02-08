/**
 * Configuration Types for SecureClaw
 *
 * Security considerations:
 * - Secret values are never stored in config, only references (env vars)
 * - All paths are validated to prevent path traversal
 * - Timeouts and limits have maximum bounds
 */
import { z } from 'zod';
// Safe path validation (no path traversal)
const SafePathSchema = z.string()
    .min(1)
    .max(4096)
    .refine((path) => !path.includes('..') && !path.includes('\0'), { message: 'Path contains forbidden characters' });
// Environment variable reference (for secrets)
const EnvVarRefSchema = z.string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'Must be a valid environment variable name');
// Core configuration
export const CoreConfigSchema = z.object({
    name: z.string().default('SecureClaw'),
    environment: z.enum(['development', 'staging', 'production']).default('development'),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    workspace: SafePathSchema.default('~/.secureclaw/workspace'),
    dataDir: SafePathSchema.default('~/.secureclaw/data'),
});
// Security sub-schemas with defaults
const RbacConfigSchema = z.object({
    enabled: z.boolean().default(true),
    defaultRole: z.enum(['admin', 'operator', 'auditor', 'viewer']).default('viewer'),
}).default({});
const EncryptionConfigSchema = z.object({
    enabled: z.boolean().default(true),
    algorithm: z.enum(['aes-256-gcm']).default('aes-256-gcm'),
    keyEnv: EnvVarRefSchema.default('SECURECLAW_ENCRYPTION_KEY'),
}).default({});
const SandboxConfigSchema = z.object({
    enabled: z.boolean().default(true),
    technology: z.enum(['auto', 'seccomp', 'landlock', 'none']).default('auto'),
}).default({});
const RateLimitingConfigSchema = z.object({
    enabled: z.boolean().default(true),
    defaultWindowMs: z.number().int().positive().max(3600000).default(60000),
    defaultMaxRequests: z.number().int().positive().max(10000).default(100),
}).default({});
const InputValidationConfigSchema = z.object({
    maxInputLength: z.number().int().positive().max(10000000).default(100000), // 100KB
    maxFileSize: z.number().int().positive().max(104857600).default(10485760), // 10MB
    enableInjectionDetection: z.boolean().default(true),
}).default({});
// Security configuration
export const SecurityConfigSchema = z.object({
    rbac: RbacConfigSchema,
    encryption: EncryptionConfigSchema,
    sandbox: SandboxConfigSchema,
    rateLimiting: RateLimitingConfigSchema,
    inputValidation: InputValidationConfigSchema,
});
// Audit config sub-schema
const AuditConfigSchema = z.object({
    enabled: z.boolean().default(true),
    chainVerification: z.enum(['hourly', 'daily', 'never']).default('hourly'),
    signingKeyEnv: EnvVarRefSchema.default('SECURECLAW_SIGNING_KEY'),
}).default({});
// Logging configuration
export const LoggingConfigSchema = z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['json', 'pretty']).default('json'),
    output: z.array(z.discriminatedUnion('type', [
        z.object({
            type: z.literal('file'),
            path: SafePathSchema,
            rotation: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
            retention: z.string().regex(/^\d+[dhw]$/).default('30d'),
            maxSize: z.string().regex(/^\d+[KMG]B$/).optional(),
        }),
        z.object({
            type: z.literal('stdout'),
            format: z.enum(['json', 'pretty']).default('pretty'),
        }),
    ])).default([{ type: 'stdout', format: 'pretty' }]),
    audit: AuditConfigSchema,
});
// Metrics sub-schemas
const PrometheusConfigSchema = z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().min(1024).max(65535).default(9090),
    path: z.string().default('/metrics'),
}).default({});
const MetricsWebsocketConfigSchema = z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1024).max(65535).default(18790),
    updateIntervalMs: z.number().int().positive().max(60000).default(1000),
}).default({});
const MetricsExportConfigSchema = z.object({
    prometheus: PrometheusConfigSchema,
    websocket: MetricsWebsocketConfigSchema,
}).default({});
const MetricsRetentionConfigSchema = z.object({
    rawDataHours: z.number().int().positive().max(168).default(24), // Max 1 week
    aggregatedDataDays: z.number().int().positive().max(365).default(30),
}).default({});
// Metrics configuration
export const MetricsConfigSchema = z.object({
    enabled: z.boolean().default(true),
    export: MetricsExportConfigSchema,
    retention: MetricsRetentionConfigSchema,
});
// Gateway sub-schemas
const TlsConfigSchema = z.object({
    enabled: z.boolean().default(false),
    certPath: SafePathSchema.optional(),
    keyPath: SafePathSchema.optional(),
    caPath: SafePathSchema.optional(),
}).default({});
const CorsConfigSchema = z.object({
    enabled: z.boolean().default(true),
    origins: z.array(z.string()).default(['http://localhost:3000']),
}).default({});
const AuthConfigSchema = z.object({
    tokenSecret: EnvVarRefSchema.default('SECURECLAW_TOKEN_SECRET'),
    tokenExpirySeconds: z.number().int().positive().max(86400).default(3600),
    refreshTokenExpirySeconds: z.number().int().positive().max(604800).default(86400),
}).default({});
// Gateway/API configuration  
export const GatewayConfigSchema = z.object({
    host: z.string().default('127.0.0.1'),
    port: z.number().int().min(1024).max(65535).default(18789),
    tls: TlsConfigSchema,
    cors: CorsConfigSchema,
    auth: AuthConfigSchema,
});
// Model/AI configuration
export const ModelConfigSchema = z.object({
    provider: z.enum(['anthropic', 'openai', 'ollama']).default('anthropic'),
    model: z.string().default('claude-sonnet-4-20250514'),
    apiKeyEnv: EnvVarRefSchema.default('ANTHROPIC_API_KEY'),
    // Request limits
    maxTokens: z.number().int().positive().max(200000).default(16384),
    temperature: z.number().min(0).max(2).default(0.7),
    // Rate limiting for API calls
    maxRequestsPerMinute: z.number().int().positive().max(1000).default(60),
    maxTokensPerDay: z.number().int().positive().optional(),
    // Timeout
    requestTimeoutMs: z.number().int().positive().max(300000).default(120000),
});
// Complete configuration schema
export const ConfigSchema = z.object({
    version: z.string().default('1.0'),
    core: CoreConfigSchema.default({}),
    security: SecurityConfigSchema.default({}),
    logging: LoggingConfigSchema.default({}),
    metrics: MetricsConfigSchema.default({}),
    gateway: GatewayConfigSchema.default({}),
    model: ModelConfigSchema.default({}),
});
// Partial config for merging (all fields optional)
export const PartialConfigSchema = ConfigSchema.deepPartial();
//# sourceMappingURL=config.js.map