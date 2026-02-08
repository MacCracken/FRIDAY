/**
 * Task Types for SecureClaw
 *
 * Security considerations:
 * - All task types are strictly typed to prevent type confusion attacks
 * - Input/output are typed as unknown and must be validated before use
 * - Timestamps use numbers (Unix ms) to avoid Date serialization issues
 */
import { z } from 'zod';
export declare const TaskStatus: {
    readonly PENDING: "pending";
    readonly RUNNING: "running";
    readonly COMPLETED: "completed";
    readonly FAILED: "failed";
    readonly CANCELLED: "cancelled";
    readonly TIMEOUT: "timeout";
};
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export declare const TaskType: {
    readonly EXECUTE: "execute";
    readonly QUERY: "query";
    readonly FILE: "file";
    readonly NETWORK: "network";
    readonly SYSTEM: "system";
};
export type TaskType = (typeof TaskType)[keyof typeof TaskType];
export declare const TaskStatusSchema: z.ZodEnum<["pending", "running", "completed", "failed", "cancelled", "timeout"]>;
export declare const TaskTypeSchema: z.ZodEnum<["execute", "query", "file", "network", "system"]>;
export declare const ResourceUsageSchema: z.ZodObject<{
    tokens: z.ZodObject<{
        input: z.ZodNumber;
        output: z.ZodNumber;
        total: z.ZodNumber;
        cached: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        input: number;
        output: number;
        total: number;
        cached: number;
    }, {
        input: number;
        output: number;
        total: number;
        cached?: number | undefined;
    }>;
    memoryPeakMb: z.ZodNumber;
    cpuTimeMs: z.ZodNumber;
    networkBytes: z.ZodObject<{
        sent: z.ZodNumber;
        received: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        received: number;
        sent: number;
    }, {
        received: number;
        sent: number;
    }>;
    apiCalls: z.ZodArray<z.ZodObject<{
        provider: z.ZodString;
        endpoint: z.ZodString;
        count: z.ZodNumber;
        costUsd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: string;
        endpoint: string;
        count: number;
        costUsd?: number | undefined;
    }, {
        provider: string;
        endpoint: string;
        count: number;
        costUsd?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    tokens: {
        input: number;
        output: number;
        total: number;
        cached: number;
    };
    memoryPeakMb: number;
    cpuTimeMs: number;
    networkBytes: {
        received: number;
        sent: number;
    };
    apiCalls: {
        provider: string;
        endpoint: string;
        count: number;
        costUsd?: number | undefined;
    }[];
}, {
    tokens: {
        input: number;
        output: number;
        total: number;
        cached?: number | undefined;
    };
    memoryPeakMb: number;
    cpuTimeMs: number;
    networkBytes: {
        received: number;
        sent: number;
    };
    apiCalls: {
        provider: string;
        endpoint: string;
        count: number;
        costUsd?: number | undefined;
    }[];
}>;
export type ResourceUsage = z.infer<typeof ResourceUsageSchema>;
export declare const TaskErrorSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
    stackTraceId: z.ZodOptional<z.ZodString>;
    recoverable: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    code: string;
    message: string;
    recoverable: boolean;
    stackTraceId?: string | undefined;
}, {
    code: string;
    message: string;
    stackTraceId?: string | undefined;
    recoverable?: boolean | undefined;
}>;
export type TaskError = z.infer<typeof TaskErrorSchema>;
export declare const SecurityContextSchema: z.ZodObject<{
    userId: z.ZodString;
    role: z.ZodString;
    permissionsUsed: z.ZodArray<z.ZodString, "many">;
    ipAddress: z.ZodOptional<z.ZodString>;
    userAgent: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    userId: string;
    role: string;
    permissionsUsed: string[];
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
}, {
    userId: string;
    role: string;
    permissionsUsed: string[];
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
}>;
export type SecurityContext = z.infer<typeof SecurityContextSchema>;
export declare const TaskSchema: z.ZodObject<{
    id: z.ZodString;
    correlationId: z.ZodOptional<z.ZodString>;
    parentTaskId: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<["execute", "query", "file", "network", "system"]>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    inputHash: z.ZodString;
    status: z.ZodEnum<["pending", "running", "completed", "failed", "cancelled", "timeout"]>;
    createdAt: z.ZodNumber;
    startedAt: z.ZodOptional<z.ZodNumber>;
    completedAt: z.ZodOptional<z.ZodNumber>;
    durationMs: z.ZodOptional<z.ZodNumber>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
    result: z.ZodOptional<z.ZodObject<{
        success: z.ZodBoolean;
        outputHash: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            stackTraceId: z.ZodOptional<z.ZodString>;
            recoverable: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        }, {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        } | undefined;
    }, {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        } | undefined;
    }>>;
    resources: z.ZodOptional<z.ZodObject<{
        tokens: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            total: z.ZodNumber;
            cached: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            input: number;
            output: number;
            total: number;
            cached: number;
        }, {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        }>;
        memoryPeakMb: z.ZodNumber;
        cpuTimeMs: z.ZodNumber;
        networkBytes: z.ZodObject<{
            sent: z.ZodNumber;
            received: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            received: number;
            sent: number;
        }, {
            received: number;
            sent: number;
        }>;
        apiCalls: z.ZodArray<z.ZodObject<{
            provider: z.ZodString;
            endpoint: z.ZodString;
            count: z.ZodNumber;
            costUsd: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }, {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached: number;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    }, {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    }>>;
    securityContext: z.ZodObject<{
        userId: z.ZodString;
        role: z.ZodString;
        permissionsUsed: z.ZodArray<z.ZodString, "many">;
        ipAddress: z.ZodOptional<z.ZodString>;
        userAgent: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        userId: string;
        role: string;
        permissionsUsed: string[];
        ipAddress?: string | undefined;
        userAgent?: string | undefined;
    }, {
        userId: string;
        role: string;
        permissionsUsed: string[];
        ipAddress?: string | undefined;
        userAgent?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "execute" | "query" | "file" | "network" | "system";
    status: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";
    id: string;
    name: string;
    inputHash: string;
    createdAt: number;
    timeoutMs: number;
    securityContext: {
        userId: string;
        role: string;
        permissionsUsed: string[];
        ipAddress?: string | undefined;
        userAgent?: string | undefined;
    };
    correlationId?: string | undefined;
    parentTaskId?: string | undefined;
    description?: string | undefined;
    startedAt?: number | undefined;
    completedAt?: number | undefined;
    durationMs?: number | undefined;
    result?: {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        } | undefined;
    } | undefined;
    resources?: {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached: number;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    } | undefined;
}, {
    type: "execute" | "query" | "file" | "network" | "system";
    status: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";
    id: string;
    name: string;
    inputHash: string;
    createdAt: number;
    securityContext: {
        userId: string;
        role: string;
        permissionsUsed: string[];
        ipAddress?: string | undefined;
        userAgent?: string | undefined;
    };
    correlationId?: string | undefined;
    parentTaskId?: string | undefined;
    description?: string | undefined;
    startedAt?: number | undefined;
    completedAt?: number | undefined;
    durationMs?: number | undefined;
    timeoutMs?: number | undefined;
    result?: {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        } | undefined;
    } | undefined;
    resources?: {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    } | undefined;
}>;
export type Task = z.infer<typeof TaskSchema>;
export declare const TaskCreateSchema: z.ZodObject<{
    type: z.ZodEnum<["execute", "query", "file", "network", "system"]>;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    input: z.ZodUnknown;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
    correlationId: z.ZodOptional<z.ZodString>;
    parentTaskId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "execute" | "query" | "file" | "network" | "system";
    name: string;
    input?: unknown;
    correlationId?: string | undefined;
    parentTaskId?: string | undefined;
    description?: string | undefined;
    timeoutMs?: number | undefined;
}, {
    type: "execute" | "query" | "file" | "network" | "system";
    name: string;
    input?: unknown;
    correlationId?: string | undefined;
    parentTaskId?: string | undefined;
    description?: string | undefined;
    timeoutMs?: number | undefined;
}>;
export type TaskCreate = z.infer<typeof TaskCreateSchema>;
export declare const TaskUpdateSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["pending", "running", "completed", "failed", "cancelled", "timeout"]>>;
    result: z.ZodOptional<z.ZodObject<{
        success: z.ZodBoolean;
        outputHash: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
            stackTraceId: z.ZodOptional<z.ZodString>;
            recoverable: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        }, {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        } | undefined;
    }, {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        } | undefined;
    }>>;
    resources: z.ZodOptional<z.ZodObject<{
        tokens: z.ZodObject<{
            input: z.ZodNumber;
            output: z.ZodNumber;
            total: z.ZodNumber;
            cached: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            input: number;
            output: number;
            total: number;
            cached: number;
        }, {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        }>;
        memoryPeakMb: z.ZodNumber;
        cpuTimeMs: z.ZodNumber;
        networkBytes: z.ZodObject<{
            sent: z.ZodNumber;
            received: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            received: number;
            sent: number;
        }, {
            received: number;
            sent: number;
        }>;
        apiCalls: z.ZodArray<z.ZodObject<{
            provider: z.ZodString;
            endpoint: z.ZodString;
            count: z.ZodNumber;
            costUsd: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }, {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached: number;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    }, {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    }>>;
}, "strip", z.ZodTypeAny, {
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout" | undefined;
    result?: {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            recoverable: boolean;
            stackTraceId?: string | undefined;
        } | undefined;
    } | undefined;
    resources?: {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached: number;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    } | undefined;
}, {
    status?: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout" | undefined;
    result?: {
        success: boolean;
        outputHash?: string | undefined;
        error?: {
            code: string;
            message: string;
            stackTraceId?: string | undefined;
            recoverable?: boolean | undefined;
        } | undefined;
    } | undefined;
    resources?: {
        tokens: {
            input: number;
            output: number;
            total: number;
            cached?: number | undefined;
        };
        memoryPeakMb: number;
        cpuTimeMs: number;
        networkBytes: {
            received: number;
            sent: number;
        };
        apiCalls: {
            provider: string;
            endpoint: string;
            count: number;
            costUsd?: number | undefined;
        }[];
    } | undefined;
}>;
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;
//# sourceMappingURL=task.d.ts.map