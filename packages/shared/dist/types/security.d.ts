/**
 * Security Types for SecureClaw
 *
 * Security considerations:
 * - All security events are immutable once created
 * - Severity levels are strictly typed
 * - Audit entries include chain integrity fields
 */
import { z } from 'zod';
export declare const Severity: {
    readonly INFO: "info";
    readonly WARN: "warn";
    readonly ERROR: "error";
    readonly CRITICAL: "critical";
};
export type Severity = (typeof Severity)[keyof typeof Severity];
export declare const SeveritySchema: z.ZodEnum<["info", "warn", "error", "critical"]>;
export declare const SecurityEventType: {
    readonly AUTH_SUCCESS: "auth_success";
    readonly AUTH_FAILURE: "auth_failure";
    readonly RATE_LIMIT: "rate_limit";
    readonly INJECTION_ATTEMPT: "injection_attempt";
    readonly PERMISSION_DENIED: "permission_denied";
    readonly ANOMALY: "anomaly";
    readonly SANDBOX_VIOLATION: "sandbox_violation";
    readonly CONFIG_CHANGE: "config_change";
    readonly SECRET_ACCESS: "secret_access";
};
export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];
export declare const SecurityEventTypeSchema: z.ZodEnum<["auth_success", "auth_failure", "rate_limit", "injection_attempt", "permission_denied", "anomaly", "sandbox_violation", "config_change", "secret_access"]>;
export declare const SecurityEventSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["auth_success", "auth_failure", "rate_limit", "injection_attempt", "permission_denied", "anomaly", "sandbox_violation", "config_change", "secret_access"]>;
    severity: z.ZodEnum<["info", "warn", "error", "critical"]>;
    message: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    ipAddress: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
    resource: z.ZodOptional<z.ZodString>;
    action: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    timestamp: z.ZodNumber;
    acknowledged: z.ZodDefault<z.ZodBoolean>;
    acknowledgedBy: z.ZodOptional<z.ZodString>;
    acknowledgedAt: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    message: string;
    type: "auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access";
    id: string;
    severity: "error" | "info" | "warn" | "critical";
    timestamp: number;
    acknowledged: boolean;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    resource?: string | undefined;
    action?: string | undefined;
    details?: Record<string, unknown> | undefined;
    acknowledgedBy?: string | undefined;
    acknowledgedAt?: number | undefined;
}, {
    message: string;
    type: "auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access";
    id: string;
    severity: "error" | "info" | "warn" | "critical";
    timestamp: number;
    userId?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    resource?: string | undefined;
    action?: string | undefined;
    details?: Record<string, unknown> | undefined;
    acknowledged?: boolean | undefined;
    acknowledgedBy?: string | undefined;
    acknowledgedAt?: number | undefined;
}>;
export type SecurityEvent = z.infer<typeof SecurityEventSchema>;
export declare const Role: {
    readonly ADMIN: "admin";
    readonly OPERATOR: "operator";
    readonly AUDITOR: "auditor";
    readonly VIEWER: "viewer";
};
export type Role = (typeof Role)[keyof typeof Role];
export declare const RoleSchema: z.ZodEnum<["admin", "operator", "auditor", "viewer"]>;
export declare const PermissionSchema: z.ZodObject<{
    resource: z.ZodString;
    actions: z.ZodArray<z.ZodString, "many">;
    conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        field: z.ZodString;
        operator: z.ZodEnum<["eq", "neq", "in", "nin", "gt", "gte", "lt", "lte"]>;
        value: z.ZodUnknown;
    }, "strip", z.ZodTypeAny, {
        operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
        field: string;
        value?: unknown;
    }, {
        operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
        field: string;
        value?: unknown;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    resource: string;
    actions: string[];
    conditions?: {
        operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
        field: string;
        value?: unknown;
    }[] | undefined;
}, {
    resource: string;
    actions: string[];
    conditions?: {
        operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
        field: string;
        value?: unknown;
    }[] | undefined;
}>;
export type Permission = z.infer<typeof PermissionSchema>;
export declare const RoleDefinitionSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    permissions: z.ZodArray<z.ZodObject<{
        resource: z.ZodString;
        actions: z.ZodArray<z.ZodString, "many">;
        conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            field: z.ZodString;
            operator: z.ZodEnum<["eq", "neq", "in", "nin", "gt", "gte", "lt", "lte"]>;
            value: z.ZodUnknown;
        }, "strip", z.ZodTypeAny, {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }, {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        resource: string;
        actions: string[];
        conditions?: {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }[] | undefined;
    }, {
        resource: string;
        actions: string[];
        conditions?: {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }[] | undefined;
    }>, "many">;
    inheritFrom: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    permissions: {
        resource: string;
        actions: string[];
        conditions?: {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }[] | undefined;
    }[];
    description?: string | undefined;
    inheritFrom?: string[] | undefined;
}, {
    id: string;
    name: string;
    permissions: {
        resource: string;
        actions: string[];
        conditions?: {
            operator: "eq" | "neq" | "in" | "nin" | "gt" | "gte" | "lt" | "lte";
            field: string;
            value?: unknown;
        }[] | undefined;
    }[];
    description?: string | undefined;
    inheritFrom?: string[] | undefined;
}>;
export type RoleDefinition = z.infer<typeof RoleDefinitionSchema>;
export declare const AuditEntrySchema: z.ZodObject<{
    id: z.ZodString;
    correlationId: z.ZodOptional<z.ZodString>;
    event: z.ZodString;
    level: z.ZodEnum<["trace", "debug", "info", "warn", "error", "security"]>;
    message: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    taskId: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    timestamp: z.ZodNumber;
    integrity: z.ZodObject<{
        version: z.ZodString;
        signature: z.ZodString;
        previousEntryHash: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        version: string;
        signature: string;
        previousEntryHash: string;
    }, {
        version: string;
        signature: string;
        previousEntryHash: string;
    }>;
}, "strip", z.ZodTypeAny, {
    message: string;
    id: string;
    timestamp: number;
    event: string;
    level: "error" | "info" | "warn" | "trace" | "debug" | "security";
    integrity: {
        version: string;
        signature: string;
        previousEntryHash: string;
    };
    userId?: string | undefined;
    correlationId?: string | undefined;
    taskId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}, {
    message: string;
    id: string;
    timestamp: number;
    event: string;
    level: "error" | "info" | "warn" | "trace" | "debug" | "security";
    integrity: {
        version: string;
        signature: string;
        previousEntryHash: string;
    };
    userId?: string | undefined;
    correlationId?: string | undefined;
    taskId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
}>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export declare const RateLimitRuleSchema: z.ZodObject<{
    name: z.ZodString;
    windowMs: z.ZodNumber;
    maxRequests: z.ZodNumber;
    keyType: z.ZodEnum<["ip", "user", "api_key", "global"]>;
    onExceed: z.ZodDefault<z.ZodEnum<["reject", "delay", "log_only"]>>;
    skipIf: z.ZodOptional<z.ZodFunction<z.ZodTuple<[z.ZodUnknown], z.ZodUnknown>, z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    windowMs: number;
    maxRequests: number;
    keyType: "ip" | "user" | "api_key" | "global";
    onExceed: "reject" | "delay" | "log_only";
    skipIf?: ((args_0: unknown, ...args: unknown[]) => boolean) | undefined;
}, {
    name: string;
    windowMs: number;
    maxRequests: number;
    keyType: "ip" | "user" | "api_key" | "global";
    onExceed?: "reject" | "delay" | "log_only" | undefined;
    skipIf?: ((args_0: unknown, ...args: unknown[]) => boolean) | undefined;
}>;
export type RateLimitRule = z.infer<typeof RateLimitRuleSchema>;
export declare const TokenPayloadSchema: z.ZodObject<{
    sub: z.ZodString;
    role: z.ZodEnum<["admin", "operator", "auditor", "viewer"]>;
    permissions: z.ZodArray<z.ZodString, "many">;
    iat: z.ZodNumber;
    exp: z.ZodNumber;
    jti: z.ZodString;
}, "strip", z.ZodTypeAny, {
    role: "admin" | "operator" | "auditor" | "viewer";
    permissions: string[];
    sub: string;
    iat: number;
    exp: number;
    jti: string;
}, {
    role: "admin" | "operator" | "auditor" | "viewer";
    permissions: string[];
    sub: string;
    iat: number;
    exp: number;
    jti: string;
}>;
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;
//# sourceMappingURL=security.d.ts.map