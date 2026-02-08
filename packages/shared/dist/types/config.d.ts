/**
 * Configuration Types for SecureClaw
 *
 * Security considerations:
 * - Secret values are never stored in config, only references (env vars)
 * - All paths are validated to prevent path traversal
 * - Timeouts and limits have maximum bounds
 */
import { z } from 'zod';
export declare const CoreConfigSchema: z.ZodObject<{
    name: z.ZodDefault<z.ZodString>;
    environment: z.ZodDefault<z.ZodEnum<["development", "staging", "production"]>>;
    logLevel: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
    workspace: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
    dataDir: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    environment: "development" | "staging" | "production";
    logLevel: "error" | "info" | "warn" | "trace" | "debug";
    workspace: string;
    dataDir: string;
}, {
    name?: string | undefined;
    environment?: "development" | "staging" | "production" | undefined;
    logLevel?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
    workspace?: string | undefined;
    dataDir?: string | undefined;
}>;
export type CoreConfig = z.infer<typeof CoreConfigSchema>;
export declare const SecurityConfigSchema: z.ZodObject<{
    rbac: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        defaultRole: z.ZodDefault<z.ZodEnum<["admin", "operator", "auditor", "viewer"]>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        defaultRole: "admin" | "operator" | "auditor" | "viewer";
    }, {
        enabled?: boolean | undefined;
        defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
    }>>;
    encryption: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        algorithm: z.ZodDefault<z.ZodEnum<["aes-256-gcm"]>>;
        keyEnv: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        algorithm: "aes-256-gcm";
        keyEnv: string;
    }, {
        enabled?: boolean | undefined;
        algorithm?: "aes-256-gcm" | undefined;
        keyEnv?: string | undefined;
    }>>;
    sandbox: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        technology: z.ZodDefault<z.ZodEnum<["auto", "seccomp", "landlock", "none"]>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        technology: "auto" | "seccomp" | "landlock" | "none";
    }, {
        enabled?: boolean | undefined;
        technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
    }>>;
    rateLimiting: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        defaultWindowMs: z.ZodDefault<z.ZodNumber>;
        defaultMaxRequests: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        defaultWindowMs: number;
        defaultMaxRequests: number;
    }, {
        enabled?: boolean | undefined;
        defaultWindowMs?: number | undefined;
        defaultMaxRequests?: number | undefined;
    }>>;
    inputValidation: z.ZodDefault<z.ZodObject<{
        maxInputLength: z.ZodDefault<z.ZodNumber>;
        maxFileSize: z.ZodDefault<z.ZodNumber>;
        enableInjectionDetection: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        maxInputLength: number;
        maxFileSize: number;
        enableInjectionDetection: boolean;
    }, {
        maxInputLength?: number | undefined;
        maxFileSize?: number | undefined;
        enableInjectionDetection?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    rbac: {
        enabled: boolean;
        defaultRole: "admin" | "operator" | "auditor" | "viewer";
    };
    encryption: {
        enabled: boolean;
        algorithm: "aes-256-gcm";
        keyEnv: string;
    };
    sandbox: {
        enabled: boolean;
        technology: "auto" | "seccomp" | "landlock" | "none";
    };
    rateLimiting: {
        enabled: boolean;
        defaultWindowMs: number;
        defaultMaxRequests: number;
    };
    inputValidation: {
        maxInputLength: number;
        maxFileSize: number;
        enableInjectionDetection: boolean;
    };
}, {
    rbac?: {
        enabled?: boolean | undefined;
        defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
    } | undefined;
    encryption?: {
        enabled?: boolean | undefined;
        algorithm?: "aes-256-gcm" | undefined;
        keyEnv?: string | undefined;
    } | undefined;
    sandbox?: {
        enabled?: boolean | undefined;
        technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
    } | undefined;
    rateLimiting?: {
        enabled?: boolean | undefined;
        defaultWindowMs?: number | undefined;
        defaultMaxRequests?: number | undefined;
    } | undefined;
    inputValidation?: {
        maxInputLength?: number | undefined;
        maxFileSize?: number | undefined;
        enableInjectionDetection?: boolean | undefined;
    } | undefined;
}>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export declare const LoggingConfigSchema: z.ZodObject<{
    level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
    format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
    output: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"file">;
        path: z.ZodEffects<z.ZodString, string, string>;
        rotation: z.ZodDefault<z.ZodEnum<["hourly", "daily", "weekly"]>>;
        retention: z.ZodDefault<z.ZodString>;
        maxSize: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "file";
        rotation: "hourly" | "daily" | "weekly";
        retention: string;
        maxSize?: string | undefined;
    }, {
        path: string;
        type: "file";
        rotation?: "hourly" | "daily" | "weekly" | undefined;
        retention?: string | undefined;
        maxSize?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"stdout">;
        format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
    }, "strip", z.ZodTypeAny, {
        type: "stdout";
        format: "json" | "pretty";
    }, {
        type: "stdout";
        format?: "json" | "pretty" | undefined;
    }>]>, "many">>;
    audit: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        chainVerification: z.ZodDefault<z.ZodEnum<["hourly", "daily", "never"]>>;
        signingKeyEnv: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        chainVerification: "never" | "hourly" | "daily";
        signingKeyEnv: string;
    }, {
        enabled?: boolean | undefined;
        chainVerification?: "never" | "hourly" | "daily" | undefined;
        signingKeyEnv?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    output: ({
        path: string;
        type: "file";
        rotation: "hourly" | "daily" | "weekly";
        retention: string;
        maxSize?: string | undefined;
    } | {
        type: "stdout";
        format: "json" | "pretty";
    })[];
    level: "error" | "info" | "warn" | "trace" | "debug";
    format: "json" | "pretty";
    audit: {
        enabled: boolean;
        chainVerification: "never" | "hourly" | "daily";
        signingKeyEnv: string;
    };
}, {
    output?: ({
        path: string;
        type: "file";
        rotation?: "hourly" | "daily" | "weekly" | undefined;
        retention?: string | undefined;
        maxSize?: string | undefined;
    } | {
        type: "stdout";
        format?: "json" | "pretty" | undefined;
    })[] | undefined;
    level?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
    format?: "json" | "pretty" | undefined;
    audit?: {
        enabled?: boolean | undefined;
        chainVerification?: "never" | "hourly" | "daily" | undefined;
        signingKeyEnv?: string | undefined;
    } | undefined;
}>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export declare const MetricsConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    export: z.ZodDefault<z.ZodObject<{
        prometheus: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            port: z.ZodDefault<z.ZodNumber>;
            path: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            enabled: boolean;
            port: number;
        }, {
            path?: string | undefined;
            enabled?: boolean | undefined;
            port?: number | undefined;
        }>>;
        websocket: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            port: z.ZodDefault<z.ZodNumber>;
            updateIntervalMs: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            port: number;
            updateIntervalMs: number;
        }, {
            enabled?: boolean | undefined;
            port?: number | undefined;
            updateIntervalMs?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        prometheus: {
            path: string;
            enabled: boolean;
            port: number;
        };
        websocket: {
            enabled: boolean;
            port: number;
            updateIntervalMs: number;
        };
    }, {
        prometheus?: {
            path?: string | undefined;
            enabled?: boolean | undefined;
            port?: number | undefined;
        } | undefined;
        websocket?: {
            enabled?: boolean | undefined;
            port?: number | undefined;
            updateIntervalMs?: number | undefined;
        } | undefined;
    }>>;
    retention: z.ZodDefault<z.ZodObject<{
        rawDataHours: z.ZodDefault<z.ZodNumber>;
        aggregatedDataDays: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        rawDataHours: number;
        aggregatedDataDays: number;
    }, {
        rawDataHours?: number | undefined;
        aggregatedDataDays?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    enabled: boolean;
    retention: {
        rawDataHours: number;
        aggregatedDataDays: number;
    };
    export: {
        prometheus: {
            path: string;
            enabled: boolean;
            port: number;
        };
        websocket: {
            enabled: boolean;
            port: number;
            updateIntervalMs: number;
        };
    };
}, {
    enabled?: boolean | undefined;
    retention?: {
        rawDataHours?: number | undefined;
        aggregatedDataDays?: number | undefined;
    } | undefined;
    export?: {
        prometheus?: {
            path?: string | undefined;
            enabled?: boolean | undefined;
            port?: number | undefined;
        } | undefined;
        websocket?: {
            enabled?: boolean | undefined;
            port?: number | undefined;
            updateIntervalMs?: number | undefined;
        } | undefined;
    } | undefined;
}>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export declare const GatewayConfigSchema: z.ZodObject<{
    host: z.ZodDefault<z.ZodString>;
    port: z.ZodDefault<z.ZodNumber>;
    tls: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        certPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        keyPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        caPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        certPath?: string | undefined;
        keyPath?: string | undefined;
        caPath?: string | undefined;
    }, {
        enabled?: boolean | undefined;
        certPath?: string | undefined;
        keyPath?: string | undefined;
        caPath?: string | undefined;
    }>>;
    cors: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        origins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        origins: string[];
    }, {
        enabled?: boolean | undefined;
        origins?: string[] | undefined;
    }>>;
    auth: z.ZodDefault<z.ZodObject<{
        tokenSecret: z.ZodDefault<z.ZodString>;
        tokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
        refreshTokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        tokenSecret: string;
        tokenExpirySeconds: number;
        refreshTokenExpirySeconds: number;
    }, {
        tokenSecret?: string | undefined;
        tokenExpirySeconds?: number | undefined;
        refreshTokenExpirySeconds?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    port: number;
    host: string;
    tls: {
        enabled: boolean;
        certPath?: string | undefined;
        keyPath?: string | undefined;
        caPath?: string | undefined;
    };
    cors: {
        enabled: boolean;
        origins: string[];
    };
    auth: {
        tokenSecret: string;
        tokenExpirySeconds: number;
        refreshTokenExpirySeconds: number;
    };
}, {
    port?: number | undefined;
    host?: string | undefined;
    tls?: {
        enabled?: boolean | undefined;
        certPath?: string | undefined;
        keyPath?: string | undefined;
        caPath?: string | undefined;
    } | undefined;
    cors?: {
        enabled?: boolean | undefined;
        origins?: string[] | undefined;
    } | undefined;
    auth?: {
        tokenSecret?: string | undefined;
        tokenExpirySeconds?: number | undefined;
        refreshTokenExpirySeconds?: number | undefined;
    } | undefined;
}>;
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;
export declare const ModelConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai", "ollama"]>>;
    model: z.ZodDefault<z.ZodString>;
    apiKeyEnv: z.ZodDefault<z.ZodString>;
    maxTokens: z.ZodDefault<z.ZodNumber>;
    temperature: z.ZodDefault<z.ZodNumber>;
    maxRequestsPerMinute: z.ZodDefault<z.ZodNumber>;
    maxTokensPerDay: z.ZodOptional<z.ZodNumber>;
    requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    provider: "anthropic" | "openai" | "ollama";
    model: string;
    apiKeyEnv: string;
    maxTokens: number;
    temperature: number;
    maxRequestsPerMinute: number;
    requestTimeoutMs: number;
    maxTokensPerDay?: number | undefined;
}, {
    provider?: "anthropic" | "openai" | "ollama" | undefined;
    model?: string | undefined;
    apiKeyEnv?: string | undefined;
    maxTokens?: number | undefined;
    temperature?: number | undefined;
    maxRequestsPerMinute?: number | undefined;
    maxTokensPerDay?: number | undefined;
    requestTimeoutMs?: number | undefined;
}>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export declare const ConfigSchema: z.ZodObject<{
    version: z.ZodDefault<z.ZodString>;
    core: z.ZodDefault<z.ZodObject<{
        name: z.ZodDefault<z.ZodString>;
        environment: z.ZodDefault<z.ZodEnum<["development", "staging", "production"]>>;
        logLevel: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
        workspace: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
        dataDir: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        environment: "development" | "staging" | "production";
        logLevel: "error" | "info" | "warn" | "trace" | "debug";
        workspace: string;
        dataDir: string;
    }, {
        name?: string | undefined;
        environment?: "development" | "staging" | "production" | undefined;
        logLevel?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        workspace?: string | undefined;
        dataDir?: string | undefined;
    }>>;
    security: z.ZodDefault<z.ZodObject<{
        rbac: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            defaultRole: z.ZodDefault<z.ZodEnum<["admin", "operator", "auditor", "viewer"]>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        }, {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        }>>;
        encryption: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            algorithm: z.ZodDefault<z.ZodEnum<["aes-256-gcm"]>>;
            keyEnv: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        }, {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        }>>;
        sandbox: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            technology: z.ZodDefault<z.ZodEnum<["auto", "seccomp", "landlock", "none"]>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        }, {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        }>>;
        rateLimiting: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            defaultWindowMs: z.ZodDefault<z.ZodNumber>;
            defaultMaxRequests: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        }, {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        }>>;
        inputValidation: z.ZodDefault<z.ZodObject<{
            maxInputLength: z.ZodDefault<z.ZodNumber>;
            maxFileSize: z.ZodDefault<z.ZodNumber>;
            enableInjectionDetection: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        }, {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        rbac: {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        };
        encryption: {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        };
        sandbox: {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        };
        rateLimiting: {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        };
        inputValidation: {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        };
    }, {
        rbac?: {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        } | undefined;
        encryption?: {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        } | undefined;
        sandbox?: {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        } | undefined;
        rateLimiting?: {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        } | undefined;
        inputValidation?: {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        } | undefined;
    }>>;
    logging: z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
        format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
        output: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"file">;
            path: z.ZodEffects<z.ZodString, string, string>;
            rotation: z.ZodDefault<z.ZodEnum<["hourly", "daily", "weekly"]>>;
            retention: z.ZodDefault<z.ZodString>;
            maxSize: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        }, {
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"stdout">;
            format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
        }, "strip", z.ZodTypeAny, {
            type: "stdout";
            format: "json" | "pretty";
        }, {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        }>]>, "many">>;
        audit: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            chainVerification: z.ZodDefault<z.ZodEnum<["hourly", "daily", "never"]>>;
            signingKeyEnv: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        }, {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        output: ({
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format: "json" | "pretty";
        })[];
        level: "error" | "info" | "warn" | "trace" | "debug";
        format: "json" | "pretty";
        audit: {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        };
    }, {
        output?: ({
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        })[] | undefined;
        level?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        format?: "json" | "pretty" | undefined;
        audit?: {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        } | undefined;
    }>>;
    metrics: z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        export: z.ZodDefault<z.ZodObject<{
            prometheus: z.ZodDefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                port: z.ZodDefault<z.ZodNumber>;
                path: z.ZodDefault<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                path: string;
                enabled: boolean;
                port: number;
            }, {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            }>>;
            websocket: z.ZodDefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                port: z.ZodDefault<z.ZodNumber>;
                updateIntervalMs: z.ZodDefault<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            }, {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        }, {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        }>>;
        retention: z.ZodDefault<z.ZodObject<{
            rawDataHours: z.ZodDefault<z.ZodNumber>;
            aggregatedDataDays: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            rawDataHours: number;
            aggregatedDataDays: number;
        }, {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        retention: {
            rawDataHours: number;
            aggregatedDataDays: number;
        };
        export: {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        };
    }, {
        enabled?: boolean | undefined;
        retention?: {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        } | undefined;
        export?: {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        } | undefined;
    }>>;
    gateway: z.ZodDefault<z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        tls: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            certPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            keyPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            caPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        }, {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        }>>;
        cors: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            origins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            origins: string[];
        }, {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        }>>;
        auth: z.ZodDefault<z.ZodObject<{
            tokenSecret: z.ZodDefault<z.ZodString>;
            tokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
            refreshTokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        }, {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        tls: {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        };
        cors: {
            enabled: boolean;
            origins: string[];
        };
        auth: {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        };
    }, {
        port?: number | undefined;
        host?: string | undefined;
        tls?: {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        } | undefined;
        cors?: {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        } | undefined;
        auth?: {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        } | undefined;
    }>>;
    model: z.ZodDefault<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai", "ollama"]>>;
        model: z.ZodDefault<z.ZodString>;
        apiKeyEnv: z.ZodDefault<z.ZodString>;
        maxTokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        maxRequestsPerMinute: z.ZodDefault<z.ZodNumber>;
        maxTokensPerDay: z.ZodOptional<z.ZodNumber>;
        requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "ollama";
        model: string;
        apiKeyEnv: string;
        maxTokens: number;
        temperature: number;
        maxRequestsPerMinute: number;
        requestTimeoutMs: number;
        maxTokensPerDay?: number | undefined;
    }, {
        provider?: "anthropic" | "openai" | "ollama" | undefined;
        model?: string | undefined;
        apiKeyEnv?: string | undefined;
        maxTokens?: number | undefined;
        temperature?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxTokensPerDay?: number | undefined;
        requestTimeoutMs?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    security: {
        rbac: {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        };
        encryption: {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        };
        sandbox: {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        };
        rateLimiting: {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        };
        inputValidation: {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        };
    };
    version: string;
    model: {
        provider: "anthropic" | "openai" | "ollama";
        model: string;
        apiKeyEnv: string;
        maxTokens: number;
        temperature: number;
        maxRequestsPerMinute: number;
        requestTimeoutMs: number;
        maxTokensPerDay?: number | undefined;
    };
    core: {
        name: string;
        environment: "development" | "staging" | "production";
        logLevel: "error" | "info" | "warn" | "trace" | "debug";
        workspace: string;
        dataDir: string;
    };
    logging: {
        output: ({
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format: "json" | "pretty";
        })[];
        level: "error" | "info" | "warn" | "trace" | "debug";
        format: "json" | "pretty";
        audit: {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        };
    };
    metrics: {
        enabled: boolean;
        retention: {
            rawDataHours: number;
            aggregatedDataDays: number;
        };
        export: {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        };
    };
    gateway: {
        port: number;
        host: string;
        tls: {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        };
        cors: {
            enabled: boolean;
            origins: string[];
        };
        auth: {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        };
    };
}, {
    security?: {
        rbac?: {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        } | undefined;
        encryption?: {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        } | undefined;
        sandbox?: {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        } | undefined;
        rateLimiting?: {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        } | undefined;
        inputValidation?: {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        } | undefined;
    } | undefined;
    version?: string | undefined;
    model?: {
        provider?: "anthropic" | "openai" | "ollama" | undefined;
        model?: string | undefined;
        apiKeyEnv?: string | undefined;
        maxTokens?: number | undefined;
        temperature?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxTokensPerDay?: number | undefined;
        requestTimeoutMs?: number | undefined;
    } | undefined;
    core?: {
        name?: string | undefined;
        environment?: "development" | "staging" | "production" | undefined;
        logLevel?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        workspace?: string | undefined;
        dataDir?: string | undefined;
    } | undefined;
    logging?: {
        output?: ({
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        })[] | undefined;
        level?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        format?: "json" | "pretty" | undefined;
        audit?: {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        } | undefined;
    } | undefined;
    metrics?: {
        enabled?: boolean | undefined;
        retention?: {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        } | undefined;
        export?: {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    gateway?: {
        port?: number | undefined;
        host?: string | undefined;
        tls?: {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        } | undefined;
        cors?: {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        } | undefined;
        auth?: {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        } | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
export declare const PartialConfigSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    core: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        name: z.ZodDefault<z.ZodString>;
        environment: z.ZodDefault<z.ZodEnum<["development", "staging", "production"]>>;
        logLevel: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
        workspace: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
        dataDir: z.ZodDefault<z.ZodEffects<z.ZodString, string, string>>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        environment: "development" | "staging" | "production";
        logLevel: "error" | "info" | "warn" | "trace" | "debug";
        workspace: string;
        dataDir: string;
    }, {
        name?: string | undefined;
        environment?: "development" | "staging" | "production" | undefined;
        logLevel?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        workspace?: string | undefined;
        dataDir?: string | undefined;
    }>>>;
    security: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        rbac: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            defaultRole: z.ZodDefault<z.ZodEnum<["admin", "operator", "auditor", "viewer"]>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        }, {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        }>>;
        encryption: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            algorithm: z.ZodDefault<z.ZodEnum<["aes-256-gcm"]>>;
            keyEnv: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        }, {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        }>>;
        sandbox: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            technology: z.ZodDefault<z.ZodEnum<["auto", "seccomp", "landlock", "none"]>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        }, {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        }>>;
        rateLimiting: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            defaultWindowMs: z.ZodDefault<z.ZodNumber>;
            defaultMaxRequests: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        }, {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        }>>;
        inputValidation: z.ZodDefault<z.ZodObject<{
            maxInputLength: z.ZodDefault<z.ZodNumber>;
            maxFileSize: z.ZodDefault<z.ZodNumber>;
            enableInjectionDetection: z.ZodDefault<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        }, {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        rbac: {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        };
        encryption: {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        };
        sandbox: {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        };
        rateLimiting: {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        };
        inputValidation: {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        };
    }, {
        rbac?: {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        } | undefined;
        encryption?: {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        } | undefined;
        sandbox?: {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        } | undefined;
        rateLimiting?: {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        } | undefined;
        inputValidation?: {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        } | undefined;
    }>>>;
    logging: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        level: z.ZodDefault<z.ZodEnum<["trace", "debug", "info", "warn", "error"]>>;
        format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
        output: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
            type: z.ZodLiteral<"file">;
            path: z.ZodEffects<z.ZodString, string, string>;
            rotation: z.ZodDefault<z.ZodEnum<["hourly", "daily", "weekly"]>>;
            retention: z.ZodDefault<z.ZodString>;
            maxSize: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        }, {
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        }>, z.ZodObject<{
            type: z.ZodLiteral<"stdout">;
            format: z.ZodDefault<z.ZodEnum<["json", "pretty"]>>;
        }, "strip", z.ZodTypeAny, {
            type: "stdout";
            format: "json" | "pretty";
        }, {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        }>]>, "many">>;
        audit: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            chainVerification: z.ZodDefault<z.ZodEnum<["hourly", "daily", "never"]>>;
            signingKeyEnv: z.ZodDefault<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        }, {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        output: ({
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format: "json" | "pretty";
        })[];
        level: "error" | "info" | "warn" | "trace" | "debug";
        format: "json" | "pretty";
        audit: {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        };
    }, {
        output?: ({
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        })[] | undefined;
        level?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        format?: "json" | "pretty" | undefined;
        audit?: {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        } | undefined;
    }>>>;
    metrics: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodBoolean>;
        export: z.ZodDefault<z.ZodObject<{
            prometheus: z.ZodDefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                port: z.ZodDefault<z.ZodNumber>;
                path: z.ZodDefault<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                path: string;
                enabled: boolean;
                port: number;
            }, {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            }>>;
            websocket: z.ZodDefault<z.ZodObject<{
                enabled: z.ZodDefault<z.ZodBoolean>;
                port: z.ZodDefault<z.ZodNumber>;
                updateIntervalMs: z.ZodDefault<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            }, {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            }>>;
        }, "strip", z.ZodTypeAny, {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        }, {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        }>>;
        retention: z.ZodDefault<z.ZodObject<{
            rawDataHours: z.ZodDefault<z.ZodNumber>;
            aggregatedDataDays: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            rawDataHours: number;
            aggregatedDataDays: number;
        }, {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        retention: {
            rawDataHours: number;
            aggregatedDataDays: number;
        };
        export: {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        };
    }, {
        enabled?: boolean | undefined;
        retention?: {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        } | undefined;
        export?: {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        } | undefined;
    }>>>;
    gateway: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        host: z.ZodDefault<z.ZodString>;
        port: z.ZodDefault<z.ZodNumber>;
        tls: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            certPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            keyPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            caPath: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        }, {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        }>>;
        cors: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodDefault<z.ZodBoolean>;
            origins: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            enabled: boolean;
            origins: string[];
        }, {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        }>>;
        auth: z.ZodDefault<z.ZodObject<{
            tokenSecret: z.ZodDefault<z.ZodString>;
            tokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
            refreshTokenExpirySeconds: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        }, {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        port: number;
        host: string;
        tls: {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        };
        cors: {
            enabled: boolean;
            origins: string[];
        };
        auth: {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        };
    }, {
        port?: number | undefined;
        host?: string | undefined;
        tls?: {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        } | undefined;
        cors?: {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        } | undefined;
        auth?: {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        } | undefined;
    }>>>;
    model: z.ZodOptional<z.ZodDefault<z.ZodObject<{
        provider: z.ZodDefault<z.ZodEnum<["anthropic", "openai", "ollama"]>>;
        model: z.ZodDefault<z.ZodString>;
        apiKeyEnv: z.ZodDefault<z.ZodString>;
        maxTokens: z.ZodDefault<z.ZodNumber>;
        temperature: z.ZodDefault<z.ZodNumber>;
        maxRequestsPerMinute: z.ZodDefault<z.ZodNumber>;
        maxTokensPerDay: z.ZodOptional<z.ZodNumber>;
        requestTimeoutMs: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        provider: "anthropic" | "openai" | "ollama";
        model: string;
        apiKeyEnv: string;
        maxTokens: number;
        temperature: number;
        maxRequestsPerMinute: number;
        requestTimeoutMs: number;
        maxTokensPerDay?: number | undefined;
    }, {
        provider?: "anthropic" | "openai" | "ollama" | undefined;
        model?: string | undefined;
        apiKeyEnv?: string | undefined;
        maxTokens?: number | undefined;
        temperature?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxTokensPerDay?: number | undefined;
        requestTimeoutMs?: number | undefined;
    }>>>;
}, "strip", z.ZodTypeAny, {
    security?: {
        rbac: {
            enabled: boolean;
            defaultRole: "admin" | "operator" | "auditor" | "viewer";
        };
        encryption: {
            enabled: boolean;
            algorithm: "aes-256-gcm";
            keyEnv: string;
        };
        sandbox: {
            enabled: boolean;
            technology: "auto" | "seccomp" | "landlock" | "none";
        };
        rateLimiting: {
            enabled: boolean;
            defaultWindowMs: number;
            defaultMaxRequests: number;
        };
        inputValidation: {
            maxInputLength: number;
            maxFileSize: number;
            enableInjectionDetection: boolean;
        };
    } | undefined;
    version?: string | undefined;
    model?: {
        provider: "anthropic" | "openai" | "ollama";
        model: string;
        apiKeyEnv: string;
        maxTokens: number;
        temperature: number;
        maxRequestsPerMinute: number;
        requestTimeoutMs: number;
        maxTokensPerDay?: number | undefined;
    } | undefined;
    core?: {
        name: string;
        environment: "development" | "staging" | "production";
        logLevel: "error" | "info" | "warn" | "trace" | "debug";
        workspace: string;
        dataDir: string;
    } | undefined;
    logging?: {
        output: ({
            path: string;
            type: "file";
            rotation: "hourly" | "daily" | "weekly";
            retention: string;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format: "json" | "pretty";
        })[];
        level: "error" | "info" | "warn" | "trace" | "debug";
        format: "json" | "pretty";
        audit: {
            enabled: boolean;
            chainVerification: "never" | "hourly" | "daily";
            signingKeyEnv: string;
        };
    } | undefined;
    metrics?: {
        enabled: boolean;
        retention: {
            rawDataHours: number;
            aggregatedDataDays: number;
        };
        export: {
            prometheus: {
                path: string;
                enabled: boolean;
                port: number;
            };
            websocket: {
                enabled: boolean;
                port: number;
                updateIntervalMs: number;
            };
        };
    } | undefined;
    gateway?: {
        port: number;
        host: string;
        tls: {
            enabled: boolean;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        };
        cors: {
            enabled: boolean;
            origins: string[];
        };
        auth: {
            tokenSecret: string;
            tokenExpirySeconds: number;
            refreshTokenExpirySeconds: number;
        };
    } | undefined;
}, {
    security?: {
        rbac?: {
            enabled?: boolean | undefined;
            defaultRole?: "admin" | "operator" | "auditor" | "viewer" | undefined;
        } | undefined;
        encryption?: {
            enabled?: boolean | undefined;
            algorithm?: "aes-256-gcm" | undefined;
            keyEnv?: string | undefined;
        } | undefined;
        sandbox?: {
            enabled?: boolean | undefined;
            technology?: "auto" | "seccomp" | "landlock" | "none" | undefined;
        } | undefined;
        rateLimiting?: {
            enabled?: boolean | undefined;
            defaultWindowMs?: number | undefined;
            defaultMaxRequests?: number | undefined;
        } | undefined;
        inputValidation?: {
            maxInputLength?: number | undefined;
            maxFileSize?: number | undefined;
            enableInjectionDetection?: boolean | undefined;
        } | undefined;
    } | undefined;
    version?: string | undefined;
    model?: {
        provider?: "anthropic" | "openai" | "ollama" | undefined;
        model?: string | undefined;
        apiKeyEnv?: string | undefined;
        maxTokens?: number | undefined;
        temperature?: number | undefined;
        maxRequestsPerMinute?: number | undefined;
        maxTokensPerDay?: number | undefined;
        requestTimeoutMs?: number | undefined;
    } | undefined;
    core?: {
        name?: string | undefined;
        environment?: "development" | "staging" | "production" | undefined;
        logLevel?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        workspace?: string | undefined;
        dataDir?: string | undefined;
    } | undefined;
    logging?: {
        output?: ({
            path: string;
            type: "file";
            rotation?: "hourly" | "daily" | "weekly" | undefined;
            retention?: string | undefined;
            maxSize?: string | undefined;
        } | {
            type: "stdout";
            format?: "json" | "pretty" | undefined;
        })[] | undefined;
        level?: "error" | "info" | "warn" | "trace" | "debug" | undefined;
        format?: "json" | "pretty" | undefined;
        audit?: {
            enabled?: boolean | undefined;
            chainVerification?: "never" | "hourly" | "daily" | undefined;
            signingKeyEnv?: string | undefined;
        } | undefined;
    } | undefined;
    metrics?: {
        enabled?: boolean | undefined;
        retention?: {
            rawDataHours?: number | undefined;
            aggregatedDataDays?: number | undefined;
        } | undefined;
        export?: {
            prometheus?: {
                path?: string | undefined;
                enabled?: boolean | undefined;
                port?: number | undefined;
            } | undefined;
            websocket?: {
                enabled?: boolean | undefined;
                port?: number | undefined;
                updateIntervalMs?: number | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    gateway?: {
        port?: number | undefined;
        host?: string | undefined;
        tls?: {
            enabled?: boolean | undefined;
            certPath?: string | undefined;
            keyPath?: string | undefined;
            caPath?: string | undefined;
        } | undefined;
        cors?: {
            enabled?: boolean | undefined;
            origins?: string[] | undefined;
        } | undefined;
        auth?: {
            tokenSecret?: string | undefined;
            tokenExpirySeconds?: number | undefined;
            refreshTokenExpirySeconds?: number | undefined;
        } | undefined;
    } | undefined;
}>;
export type PartialConfig = z.infer<typeof PartialConfigSchema>;
//# sourceMappingURL=config.d.ts.map