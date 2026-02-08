/**
 * Security Types for SecureClaw
 *
 * Security considerations:
 * - All security events are immutable once created
 * - Severity levels are strictly typed
 * - Audit entries include chain integrity fields
 */
import { z } from 'zod';
// Severity levels for security events
export const Severity = {
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error',
    CRITICAL: 'critical',
};
export const SeveritySchema = z.enum(['info', 'warn', 'error', 'critical']);
// Security event types
export const SecurityEventType = {
    AUTH_SUCCESS: 'auth_success',
    AUTH_FAILURE: 'auth_failure',
    RATE_LIMIT: 'rate_limit',
    INJECTION_ATTEMPT: 'injection_attempt',
    PERMISSION_DENIED: 'permission_denied',
    ANOMALY: 'anomaly',
    SANDBOX_VIOLATION: 'sandbox_violation',
    CONFIG_CHANGE: 'config_change',
    SECRET_ACCESS: 'secret_access',
};
export const SecurityEventTypeSchema = z.enum([
    'auth_success',
    'auth_failure',
    'rate_limit',
    'injection_attempt',
    'permission_denied',
    'anomaly',
    'sandbox_violation',
    'config_change',
    'secret_access',
]);
// Security event schema
export const SecurityEventSchema = z.object({
    id: z.string().uuid(),
    type: SecurityEventTypeSchema,
    severity: SeveritySchema,
    message: z.string().max(1024),
    // Context (all optional, sanitized)
    userId: z.string().optional(),
    ipAddress: z.string().ip().optional(),
    userAgent: z.string().max(512).optional(),
    resource: z.string().max(256).optional(),
    action: z.string().max(128).optional(),
    // Additional details (must be serializable, no functions)
    details: z.record(z.string(), z.unknown()).optional(),
    // Timestamps
    timestamp: z.number().int().positive(),
    // Acknowledgment
    acknowledged: z.boolean().default(false),
    acknowledgedBy: z.string().optional(),
    acknowledgedAt: z.number().int().positive().optional(),
});
// Role definitions for RBAC
export const Role = {
    ADMIN: 'admin',
    OPERATOR: 'operator',
    AUDITOR: 'auditor',
    VIEWER: 'viewer',
};
export const RoleSchema = z.enum(['admin', 'operator', 'auditor', 'viewer']);
// Permission definition
export const PermissionSchema = z.object({
    resource: z.string(),
    actions: z.array(z.string()),
    conditions: z.array(z.object({
        field: z.string(),
        operator: z.enum(['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte']),
        value: z.unknown(),
    })).optional(),
});
// Role with permissions
export const RoleDefinitionSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    permissions: z.array(PermissionSchema),
    inheritFrom: z.array(z.string()).optional(),
});
// Audit log entry with chain integrity
export const AuditEntrySchema = z.object({
    // Identification
    id: z.string().uuid(),
    correlationId: z.string().uuid().optional(),
    // Event data
    event: z.string(),
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'security']),
    message: z.string(),
    // Context
    userId: z.string().optional(),
    taskId: z.string().uuid().optional(),
    // Sanitized metadata (no secrets)
    metadata: z.record(z.string(), z.unknown()).optional(),
    // Timestamps
    timestamp: z.number().int().positive(),
    // Chain integrity (critical for audit trail)
    integrity: z.object({
        version: z.string(),
        signature: z.string().length(64), // HMAC-SHA256 hex
        previousEntryHash: z.string().length(64), // SHA-256 hex
    }),
});
// Rate limit rule
export const RateLimitRuleSchema = z.object({
    name: z.string(),
    windowMs: z.number().int().positive(),
    maxRequests: z.number().int().positive(),
    keyType: z.enum(['ip', 'user', 'api_key', 'global']),
    onExceed: z.enum(['reject', 'delay', 'log_only']).default('reject'),
    skipIf: z.function().args(z.unknown()).returns(z.boolean()).optional(),
});
// Authentication token payload
export const TokenPayloadSchema = z.object({
    sub: z.string(), // User ID
    role: RoleSchema,
    permissions: z.array(z.string()),
    iat: z.number().int().positive(), // Issued at
    exp: z.number().int().positive(), // Expiry
    jti: z.string().uuid(), // Token ID for revocation
});
//# sourceMappingURL=security.js.map