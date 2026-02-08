/**
 * Metrics Types for SecureClaw
 *
 * Security considerations:
 * - Metrics should never contain sensitive data
 * - All numeric values are validated for reasonable ranges
 * - Timestamps prevent replay attacks in metric reporting
 */
import { z } from 'zod';
export declare const TaskMetricsSchema: z.ZodObject<{
    total: z.ZodNumber;
    byStatus: z.ZodRecord<z.ZodEnum<["pending", "running", "completed", "failed", "cancelled", "timeout"]>, z.ZodNumber>;
    byType: z.ZodRecord<z.ZodEnum<["execute", "query", "file", "network", "system"]>, z.ZodNumber>;
    successRate: z.ZodNumber;
    failureRate: z.ZodNumber;
    avgDurationMs: z.ZodNumber;
    minDurationMs: z.ZodNumber;
    maxDurationMs: z.ZodNumber;
    p50DurationMs: z.ZodNumber;
    p95DurationMs: z.ZodNumber;
    p99DurationMs: z.ZodNumber;
    queueDepth: z.ZodNumber;
    inProgress: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    total: number;
    byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
    byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
    successRate: number;
    failureRate: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    queueDepth: number;
    inProgress: number;
}, {
    total: number;
    byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
    byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
    successRate: number;
    failureRate: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    queueDepth: number;
    inProgress: number;
}>;
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;
export declare const ResourceMetricsSchema: z.ZodObject<{
    cpuPercent: z.ZodNumber;
    memoryUsedMb: z.ZodNumber;
    memoryLimitMb: z.ZodNumber;
    memoryPercent: z.ZodNumber;
    diskUsedMb: z.ZodNumber;
    diskLimitMb: z.ZodOptional<z.ZodNumber>;
    tokensUsedToday: z.ZodNumber;
    tokensLimitDaily: z.ZodOptional<z.ZodNumber>;
    tokensCachedToday: z.ZodNumber;
    costUsdToday: z.ZodNumber;
    costUsdMonth: z.ZodNumber;
    apiCallsTotal: z.ZodNumber;
    apiErrorsTotal: z.ZodNumber;
    apiLatencyAvgMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    cpuPercent: number;
    memoryUsedMb: number;
    memoryLimitMb: number;
    memoryPercent: number;
    diskUsedMb: number;
    tokensUsedToday: number;
    tokensCachedToday: number;
    costUsdToday: number;
    costUsdMonth: number;
    apiCallsTotal: number;
    apiErrorsTotal: number;
    apiLatencyAvgMs: number;
    diskLimitMb?: number | undefined;
    tokensLimitDaily?: number | undefined;
}, {
    cpuPercent: number;
    memoryUsedMb: number;
    memoryLimitMb: number;
    memoryPercent: number;
    diskUsedMb: number;
    tokensUsedToday: number;
    tokensCachedToday: number;
    costUsdToday: number;
    costUsdMonth: number;
    apiCallsTotal: number;
    apiErrorsTotal: number;
    apiLatencyAvgMs: number;
    diskLimitMb?: number | undefined;
    tokensLimitDaily?: number | undefined;
}>;
export type ResourceMetrics = z.infer<typeof ResourceMetricsSchema>;
export declare const SecurityMetricsSchema: z.ZodObject<{
    authAttemptsTotal: z.ZodNumber;
    authSuccessTotal: z.ZodNumber;
    authFailuresTotal: z.ZodNumber;
    activeSessions: z.ZodNumber;
    permissionChecksTotal: z.ZodNumber;
    permissionDenialsTotal: z.ZodNumber;
    blockedRequestsTotal: z.ZodNumber;
    rateLimitHitsTotal: z.ZodNumber;
    injectionAttemptsTotal: z.ZodNumber;
    eventsBySeverity: z.ZodRecord<z.ZodEnum<["info", "warn", "error", "critical"]>, z.ZodNumber>;
    eventsByType: z.ZodRecord<z.ZodEnum<["auth_success", "auth_failure", "rate_limit", "injection_attempt", "permission_denied", "anomaly", "sandbox_violation", "config_change", "secret_access"]>, z.ZodNumber>;
    auditEntriesTotal: z.ZodNumber;
    auditChainValid: z.ZodBoolean;
    lastAuditVerification: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    authAttemptsTotal: number;
    authSuccessTotal: number;
    authFailuresTotal: number;
    activeSessions: number;
    permissionChecksTotal: number;
    permissionDenialsTotal: number;
    blockedRequestsTotal: number;
    rateLimitHitsTotal: number;
    injectionAttemptsTotal: number;
    eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
    eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
    auditEntriesTotal: number;
    auditChainValid: boolean;
    lastAuditVerification?: number | undefined;
}, {
    authAttemptsTotal: number;
    authSuccessTotal: number;
    authFailuresTotal: number;
    activeSessions: number;
    permissionChecksTotal: number;
    permissionDenialsTotal: number;
    blockedRequestsTotal: number;
    rateLimitHitsTotal: number;
    injectionAttemptsTotal: number;
    eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
    eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
    auditEntriesTotal: number;
    auditChainValid: boolean;
    lastAuditVerification?: number | undefined;
}>;
export type SecurityMetrics = z.infer<typeof SecurityMetricsSchema>;
export declare const MetricsSnapshotSchema: z.ZodObject<{
    timestamp: z.ZodNumber;
    tasks: z.ZodObject<{
        total: z.ZodNumber;
        byStatus: z.ZodRecord<z.ZodEnum<["pending", "running", "completed", "failed", "cancelled", "timeout"]>, z.ZodNumber>;
        byType: z.ZodRecord<z.ZodEnum<["execute", "query", "file", "network", "system"]>, z.ZodNumber>;
        successRate: z.ZodNumber;
        failureRate: z.ZodNumber;
        avgDurationMs: z.ZodNumber;
        minDurationMs: z.ZodNumber;
        maxDurationMs: z.ZodNumber;
        p50DurationMs: z.ZodNumber;
        p95DurationMs: z.ZodNumber;
        p99DurationMs: z.ZodNumber;
        queueDepth: z.ZodNumber;
        inProgress: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        total: number;
        byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
        byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
        successRate: number;
        failureRate: number;
        avgDurationMs: number;
        minDurationMs: number;
        maxDurationMs: number;
        p50DurationMs: number;
        p95DurationMs: number;
        p99DurationMs: number;
        queueDepth: number;
        inProgress: number;
    }, {
        total: number;
        byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
        byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
        successRate: number;
        failureRate: number;
        avgDurationMs: number;
        minDurationMs: number;
        maxDurationMs: number;
        p50DurationMs: number;
        p95DurationMs: number;
        p99DurationMs: number;
        queueDepth: number;
        inProgress: number;
    }>;
    resources: z.ZodObject<{
        cpuPercent: z.ZodNumber;
        memoryUsedMb: z.ZodNumber;
        memoryLimitMb: z.ZodNumber;
        memoryPercent: z.ZodNumber;
        diskUsedMb: z.ZodNumber;
        diskLimitMb: z.ZodOptional<z.ZodNumber>;
        tokensUsedToday: z.ZodNumber;
        tokensLimitDaily: z.ZodOptional<z.ZodNumber>;
        tokensCachedToday: z.ZodNumber;
        costUsdToday: z.ZodNumber;
        costUsdMonth: z.ZodNumber;
        apiCallsTotal: z.ZodNumber;
        apiErrorsTotal: z.ZodNumber;
        apiLatencyAvgMs: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        cpuPercent: number;
        memoryUsedMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
        diskUsedMb: number;
        tokensUsedToday: number;
        tokensCachedToday: number;
        costUsdToday: number;
        costUsdMonth: number;
        apiCallsTotal: number;
        apiErrorsTotal: number;
        apiLatencyAvgMs: number;
        diskLimitMb?: number | undefined;
        tokensLimitDaily?: number | undefined;
    }, {
        cpuPercent: number;
        memoryUsedMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
        diskUsedMb: number;
        tokensUsedToday: number;
        tokensCachedToday: number;
        costUsdToday: number;
        costUsdMonth: number;
        apiCallsTotal: number;
        apiErrorsTotal: number;
        apiLatencyAvgMs: number;
        diskLimitMb?: number | undefined;
        tokensLimitDaily?: number | undefined;
    }>;
    security: z.ZodObject<{
        authAttemptsTotal: z.ZodNumber;
        authSuccessTotal: z.ZodNumber;
        authFailuresTotal: z.ZodNumber;
        activeSessions: z.ZodNumber;
        permissionChecksTotal: z.ZodNumber;
        permissionDenialsTotal: z.ZodNumber;
        blockedRequestsTotal: z.ZodNumber;
        rateLimitHitsTotal: z.ZodNumber;
        injectionAttemptsTotal: z.ZodNumber;
        eventsBySeverity: z.ZodRecord<z.ZodEnum<["info", "warn", "error", "critical"]>, z.ZodNumber>;
        eventsByType: z.ZodRecord<z.ZodEnum<["auth_success", "auth_failure", "rate_limit", "injection_attempt", "permission_denied", "anomaly", "sandbox_violation", "config_change", "secret_access"]>, z.ZodNumber>;
        auditEntriesTotal: z.ZodNumber;
        auditChainValid: z.ZodBoolean;
        lastAuditVerification: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        authAttemptsTotal: number;
        authSuccessTotal: number;
        authFailuresTotal: number;
        activeSessions: number;
        permissionChecksTotal: number;
        permissionDenialsTotal: number;
        blockedRequestsTotal: number;
        rateLimitHitsTotal: number;
        injectionAttemptsTotal: number;
        eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
        eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
        auditEntriesTotal: number;
        auditChainValid: boolean;
        lastAuditVerification?: number | undefined;
    }, {
        authAttemptsTotal: number;
        authSuccessTotal: number;
        authFailuresTotal: number;
        activeSessions: number;
        permissionChecksTotal: number;
        permissionDenialsTotal: number;
        blockedRequestsTotal: number;
        rateLimitHitsTotal: number;
        injectionAttemptsTotal: number;
        eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
        eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
        auditEntriesTotal: number;
        auditChainValid: boolean;
        lastAuditVerification?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    resources: {
        cpuPercent: number;
        memoryUsedMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
        diskUsedMb: number;
        tokensUsedToday: number;
        tokensCachedToday: number;
        costUsdToday: number;
        costUsdMonth: number;
        apiCallsTotal: number;
        apiErrorsTotal: number;
        apiLatencyAvgMs: number;
        diskLimitMb?: number | undefined;
        tokensLimitDaily?: number | undefined;
    };
    timestamp: number;
    security: {
        authAttemptsTotal: number;
        authSuccessTotal: number;
        authFailuresTotal: number;
        activeSessions: number;
        permissionChecksTotal: number;
        permissionDenialsTotal: number;
        blockedRequestsTotal: number;
        rateLimitHitsTotal: number;
        injectionAttemptsTotal: number;
        eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
        eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
        auditEntriesTotal: number;
        auditChainValid: boolean;
        lastAuditVerification?: number | undefined;
    };
    tasks: {
        total: number;
        byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
        byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
        successRate: number;
        failureRate: number;
        avgDurationMs: number;
        minDurationMs: number;
        maxDurationMs: number;
        p50DurationMs: number;
        p95DurationMs: number;
        p99DurationMs: number;
        queueDepth: number;
        inProgress: number;
    };
}, {
    resources: {
        cpuPercent: number;
        memoryUsedMb: number;
        memoryLimitMb: number;
        memoryPercent: number;
        diskUsedMb: number;
        tokensUsedToday: number;
        tokensCachedToday: number;
        costUsdToday: number;
        costUsdMonth: number;
        apiCallsTotal: number;
        apiErrorsTotal: number;
        apiLatencyAvgMs: number;
        diskLimitMb?: number | undefined;
        tokensLimitDaily?: number | undefined;
    };
    timestamp: number;
    security: {
        authAttemptsTotal: number;
        authSuccessTotal: number;
        authFailuresTotal: number;
        activeSessions: number;
        permissionChecksTotal: number;
        permissionDenialsTotal: number;
        blockedRequestsTotal: number;
        rateLimitHitsTotal: number;
        injectionAttemptsTotal: number;
        eventsBySeverity: Partial<Record<"error" | "info" | "warn" | "critical", number>>;
        eventsByType: Partial<Record<"auth_success" | "auth_failure" | "rate_limit" | "injection_attempt" | "permission_denied" | "anomaly" | "sandbox_violation" | "config_change" | "secret_access", number>>;
        auditEntriesTotal: number;
        auditChainValid: boolean;
        lastAuditVerification?: number | undefined;
    };
    tasks: {
        total: number;
        byStatus: Partial<Record<"pending" | "running" | "completed" | "failed" | "cancelled" | "timeout", number>>;
        byType: Partial<Record<"execute" | "query" | "file" | "network" | "system", number>>;
        successRate: number;
        failureRate: number;
        avgDurationMs: number;
        minDurationMs: number;
        maxDurationMs: number;
        p50DurationMs: number;
        p95DurationMs: number;
        p99DurationMs: number;
        queueDepth: number;
        inProgress: number;
    };
}>;
export type MetricsSnapshot = z.infer<typeof MetricsSnapshotSchema>;
export declare const TimeSeriesPointSchema: z.ZodObject<{
    timestamp: z.ZodNumber;
    value: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    value: number;
    timestamp: number;
}, {
    value: number;
    timestamp: number;
}>;
export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;
export declare const TimeSeriesSchema: z.ZodObject<{
    name: z.ZodString;
    unit: z.ZodOptional<z.ZodString>;
    points: z.ZodArray<z.ZodObject<{
        timestamp: z.ZodNumber;
        value: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        value: number;
        timestamp: number;
    }, {
        value: number;
        timestamp: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    points: {
        value: number;
        timestamp: number;
    }[];
    unit?: string | undefined;
}, {
    name: string;
    points: {
        value: number;
        timestamp: number;
    }[];
    unit?: string | undefined;
}>;
export type TimeSeries = z.infer<typeof TimeSeriesSchema>;
export declare const MetricsQuerySchema: z.ZodObject<{
    category: z.ZodDefault<z.ZodEnum<["tasks", "resources", "security", "all"]>>;
    timeRange: z.ZodDefault<z.ZodEnum<["1h", "6h", "24h", "7d", "30d"]>>;
    startTime: z.ZodOptional<z.ZodNumber>;
    endTime: z.ZodOptional<z.ZodNumber>;
    resolution: z.ZodOptional<z.ZodEnum<["1m", "5m", "15m", "1h", "1d"]>>;
}, "strip", z.ZodTypeAny, {
    category: "resources" | "security" | "tasks" | "all";
    timeRange: "1h" | "6h" | "24h" | "7d" | "30d";
    startTime?: number | undefined;
    endTime?: number | undefined;
    resolution?: "1h" | "1m" | "5m" | "15m" | "1d" | undefined;
}, {
    category?: "resources" | "security" | "tasks" | "all" | undefined;
    timeRange?: "1h" | "6h" | "24h" | "7d" | "30d" | undefined;
    startTime?: number | undefined;
    endTime?: number | undefined;
    resolution?: "1h" | "1m" | "5m" | "15m" | "1d" | undefined;
}>;
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>;
//# sourceMappingURL=metrics.d.ts.map