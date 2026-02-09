# SecureYeoman

> **S**ecure
> **E**xecution
> **C**ompliant
> **U**nified
> **R**esilient
> **E**nterprise
> **Y**oking
> **E**nforcement
> **O**perationally
> **M**onitored
> **A**utonomous
> **N**etwork

**A Highly Secured Autonomous Agent System for F.R.I.D.A.Y.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Metrics: Real-Time](https://img.shields.io/badge/Metrics-Real--Time-blue.svg)]()

---

## Table of Contents

1. [Overview](#overview)
2. [Core Philosophy](#core-philosophy)
3. [System Identity](#system-identity)
4. [Security Architecture](#security-architecture)
5. [Task Logging System](#task-logging-system)
6. [Performance Metrics](#performance-metrics)
7. [Dashboard Integration](#dashboard-integration)
8. [Execution Rules](#execution-rules)
9. [Tool Definitions](#tool-definitions)
10. [Error Handling & Incident Response](#error-handling--incident-response)
11. [Configuration](#configuration)
12. [API Reference](#api-reference)
13. [License](#license)

---

## Overview

SecureClaw is an OpenClaw-inspired autonomous agent system designed with **security-first principles** and **comprehensive self-logging** capabilities. Unlike traditional AI agents that prioritize functionality over security, SecureClaw treats security and observability as first-class citizens.

### Key Features

- **Enterprise-Grade Security**: RBAC, encryption at rest, sandboxed execution, rate limiting
- **Comprehensive Task Logging**: Every action logged with cryptographic integrity verification
- **Real-Time Performance Metrics**: Token consumption, task duration, resource usage, success rates
- **Integrated Dashboard**: Primary GUI for metrics visualization and connection management
- **Audit Trail**: Immutable, cryptographically signed logs for compliance
- **Claude-Optimized**: Leverages Claude's extended thinking and tool use capabilities

### Design Goals

| Goal | Description |
|------|-------------|
| **Security** | Never compromise on security for convenience |
| **Transparency** | All operations are logged and auditable |
| **Performance** | Minimal overhead from security/logging layers |
| **Extensibility** | Plugin architecture for custom integrations |
| **Privacy** | Local-first, user data never leaves the system |

---

## Core Philosophy

SecureClaw embodies the **Yeoman Philosophy** from F.R.I.D.A.Y.:

### The Three Pillars

```
    DEPENDABILITY          SECURITY              LOYALTY
         |                    |                    |
    Precise execution    Trusted protector    User's interest
    Reliable output      Domain guardian      Privacy first
    Graceful recovery    Threat detection     No data leaks
```

### Security Maxims

1. **Deny by Default**: All permissions are explicitly granted, never assumed
2. **Defense in Depth**: Multiple security layers, no single point of failure
3. **Least Privilege**: Minimum permissions required for each operation
4. **Fail Secure**: On error, default to the most restrictive state
5. **Audit Everything**: If it happened, there's a log entry

---

## System Identity

### Agent Persona

```yaml
name: SecureClaw
version: 1.0.0
parent_system: F.R.I.D.A.Y.
role: Secure Autonomous Agent
classification: Enterprise Security Module

identity_statement: |
  I am SecureClaw, the security-hardened autonomous agent module of F.R.I.D.A.Y.
  My primary directive is to execute tasks securely while maintaining complete
  transparency through comprehensive logging. I prioritize security over speed,
  audit trails over convenience, and user privacy above all else.

capabilities:
  - Secure task execution with sandboxing
  - Real-time performance metrics collection
  - Cryptographically verified audit logging
  - Multi-platform integration management
  - Anomaly detection and incident response

restrictions:
  - Never execute without proper authentication
  - Never bypass security protocols
  - Never delete or modify audit logs
  - Never expose secrets in logs or outputs
  - Never connect to unverified endpoints
```

### Model Configuration (Claude-Optimized)

```yaml
model_preferences:
  primary: claude-sonnet-4-20250514
  fallback: claude-3-5-haiku-20241022
  extended_thinking: enabled
  max_tokens: 16384
  temperature: 0.7

system_prompt_injection_prevention:
  enabled: true
  techniques:
    - input_sanitization
    - context_isolation
    - instruction_hierarchy
```

---

## Security Architecture

### 1. Authentication & Authorization

#### Role-Based Access Control (RBAC)

```typescript
interface Role {
  id: string;
  name: string;
  permissions: Permission[];
  inheritFrom?: string[];
}

interface Permission {
  resource: string;      // e.g., "tasks", "files", "network"
  actions: Action[];     // e.g., ["read", "write", "execute"]
  conditions?: Condition[];
}

// Predefined Roles
const ROLES = {
  ADMIN: {
    id: "role_admin",
    name: "Administrator",
    permissions: [{ resource: "*", actions: ["*"] }]
  },
  OPERATOR: {
    id: "role_operator", 
    name: "Operator",
    permissions: [
      { resource: "tasks", actions: ["read", "write", "execute"] },
      { resource: "metrics", actions: ["read"] },
      { resource: "connections", actions: ["read", "write"] }
    ]
  },
  AUDITOR: {
    id: "role_auditor",
    name: "Auditor",
    permissions: [
      { resource: "logs", actions: ["read"] },
      { resource: "metrics", actions: ["read"] },
      { resource: "audit", actions: ["read", "export"] }
    ]
  },
  VIEWER: {
    id: "role_viewer",
    name: "Viewer",
    permissions: [
      { resource: "metrics", actions: ["read"] },
      { resource: "tasks", actions: ["read"] }
    ]
  }
};
```

#### Authentication Methods

| Method | Security Level | Use Case |
|--------|---------------|----------|
| API Key | Medium | Programmatic access |
| JWT Token | High | Web dashboard |
| mTLS Certificates | Very High | Service-to-service |
| Hardware Key (FIDO2) | Maximum | Admin operations |

### 2. Encryption

#### At Rest

```yaml
encryption:
  algorithm: AES-256-GCM
  key_derivation: Argon2id
  key_storage: 
    primary: system_keyring  # OS-level secure storage
    fallback: encrypted_file  # age-encrypted
  
  encrypted_resources:
    - secrets/*
    - config/credentials.json
    - logs/audit/*
    - cache/tokens/*
```

#### In Transit

```yaml
transport_security:
  protocol: TLS 1.3
  cipher_suites:
    - TLS_AES_256_GCM_SHA384
    - TLS_CHACHA20_POLY1305_SHA256
  certificate_validation: strict
  certificate_pinning: optional
  
  websocket:
    upgrade_required: true
    heartbeat_interval: 30s
    reconnect_strategy: exponential_backoff
```

### 3. Sandboxed Execution

#### Linux Security Modules

```yaml
sandbox:
  enabled: true
  technologies:
    linux:
      seccomp: 
        mode: strict
        allowed_syscalls:
          - read
          - write
          - open
          - close
          - mmap
          - mprotect
          # ... minimal required set
      landlock:
        enabled: true
        filesystem_rules:
          - path: /home/user/.secureclaw/workspace
            permissions: [read, write]
          - path: /tmp/secureclaw
            permissions: [read, write, execute]
          - path: /
            permissions: []  # deny all else
      namespaces:
        - user
        - network
        - pid
        - mount
    
    macos:
      sandbox_exec: true
      profile: secureclaw.sb
    
    windows:
      appcontainer: true
      integrity_level: low
```

#### Resource Limits

```yaml
resource_limits:
  memory:
    soft_limit: 512MB
    hard_limit: 1GB
  cpu:
    max_percent: 50
    nice_level: 10
  disk:
    max_write_per_task: 100MB
    temp_dir_quota: 500MB
  network:
    max_connections: 10
    bandwidth_limit: 10Mbps
  time:
    task_timeout: 300s
    idle_timeout: 60s
```

### 4. Input Validation & Sanitization

```typescript
interface ValidationPipeline {
  stages: ValidationStage[];
}

const INPUT_VALIDATION: ValidationPipeline = {
  stages: [
    {
      name: "size_check",
      maxLength: 100000,  // 100KB max input
      action: "reject"
    },
    {
      name: "encoding_normalization",
      targetEncoding: "UTF-8",
      stripInvalidChars: true
    },
    {
      name: "injection_detection",
      patterns: [
        /\{\{.*system.*\}\}/i,           // Template injection
        /<script.*?>.*?<\/script>/i,      // XSS
        /;\s*(DROP|DELETE|UPDATE)/i,      // SQL injection
        /\$\{.*\}/,                        // Variable injection
        /\[\[SYSTEM\]\]/i,                 // Prompt injection markers
      ],
      action: "sanitize_and_log"
    },
    {
      name: "content_policy",
      blocklist: "config/content_blocklist.txt",
      action: "reject_and_alert"
    }
  ]
};
```

### 5. Rate Limiting

```yaml
rate_limiting:
  enabled: true
  storage: memory  # or redis for distributed
  
  rules:
    - name: api_requests
      window: 60s
      max_requests: 100
      key: ip_address
      
    - name: task_execution
      window: 300s
      max_requests: 50
      key: user_id
      
    - name: authentication_attempts
      window: 900s  # 15 minutes
      max_requests: 5
      key: ip_address
      on_exceed: block_30m
      
    - name: expensive_operations
      window: 3600s
      max_requests: 10
      key: user_id
      operations:
        - file_upload
        - bulk_export
        - model_inference
```

### 6. Network Security

```yaml
network_security:
  allowlist:
    enabled: true
    domains:
      - api.anthropic.com
      - api.openai.com
      - "*.githubusercontent.com"
      # Add trusted domains here
    
  denylist:
    enabled: true
    sources:
      - config/blocked_domains.txt
      - https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts
    
  dns:
    resolver: cloudflare-dns  # or system
    dnssec: required
    doh: preferred
    
  egress_filtering:
    enabled: true
    log_all_connections: true
    block_private_ranges: true  # except localhost
```

### 7. Secret Management

```typescript
interface SecretStore {
  backend: "keyring" | "vault" | "encrypted_file" | "env";
  
  // Secret lifecycle
  rotation: {
    enabled: boolean;
    interval: string;  // e.g., "30d"
    notify_before: string;  // e.g., "7d"
  };
  
  // Access logging
  audit: {
    log_access: boolean;
    log_modifications: boolean;
    alert_on_bulk_access: boolean;
  };
}

// Secret retrieval (never logs the actual value)
function getSecret(key: string, context: ExecutionContext): SecretHandle {
  auditLog.record({
    event: "secret_access",
    key: key,
    accessor: context.user,
    task_id: context.taskId,
    timestamp: Date.now()
  });
  
  return secretStore.getHandle(key);  // Returns handle, not value
}
```

---

## Task Logging System

### Log Entry Structure

Every task execution generates a comprehensive log entry:

```typescript
interface TaskLogEntry {
  // Identification
  id: string;                    // UUID v7 (time-sortable)
  correlation_id: string;        // Links related operations
  parent_task_id?: string;       // For subtasks
  
  // Timing
  timestamp: {
    created: number;             // Unix ms
    started?: number;
    completed?: number;
    duration_ms?: number;
  };
  
  // Execution Details
  task: {
    type: TaskType;
    name: string;
    description: string;
    input_hash: string;          // SHA-256 of input (not the input itself)
    parameters: Record<string, unknown>;  // Sanitized
  };
  
  // Status
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  result?: {
    success: boolean;
    output_hash?: string;
    error?: {
      code: string;
      message: string;
      stack_trace_id?: string;   // Reference, not inline
    };
  };
  
  // Resource Usage
  resources: {
    tokens: {
      input: number;
      output: number;
      total: number;
      cached: number;
    };
    memory_peak_mb: number;
    cpu_time_ms: number;
    network_bytes: {
      sent: number;
      received: number;
    };
    api_calls: {
      provider: string;
      endpoint: string;
      count: number;
      cost_usd?: number;
    }[];
  };
  
  // Security Context
  security: {
    user_id: string;
    role: string;
    permissions_used: string[];
    ip_address?: string;
    user_agent?: string;
  };
  
  // Integrity
  integrity: {
    version: string;
    signature: string;           // HMAC-SHA256
    previous_entry_hash: string; // Chain integrity
  };
}
```

### Log Levels

```yaml
log_levels:
  TRACE:
    code: 0
    includes: [all_details, raw_io, internal_state]
    retention: 24h
    
  DEBUG:
    code: 1
    includes: [detailed_execution, parameter_values, timing]
    retention: 7d
    
  INFO:
    code: 2
    includes: [task_lifecycle, key_events, summaries]
    retention: 30d
    
  WARN:
    code: 3
    includes: [recoverable_errors, rate_limits, deprecations]
    retention: 90d
    
  ERROR:
    code: 4
    includes: [failures, exceptions, security_events]
    retention: 365d
    
  SECURITY:
    code: 5
    includes: [auth_events, permission_changes, incidents]
    retention: 2555d  # 7 years for compliance
```

### Audit Log Chain

```typescript
class AuditChain {
  private lastHash: string = "GENESIS";
  
  append(entry: TaskLogEntry): void {
    // Calculate entry hash
    const entryData = JSON.stringify({
      ...entry,
      integrity: { ...entry.integrity, signature: "", previous_entry_hash: "" }
    });
    
    const entryHash = crypto.createHash('sha256')
      .update(entryData)
      .digest('hex');
    
    // Sign with chain
    entry.integrity.previous_entry_hash = this.lastHash;
    entry.integrity.signature = crypto.createHmac('sha256', SIGNING_KEY)
      .update(entryHash + this.lastHash)
      .digest('hex');
    
    this.lastHash = entryHash;
    
    // Persist
    this.storage.append(entry);
  }
  
  verify(): VerificationResult {
    // Verify entire chain integrity
    let expectedPrevHash = "GENESIS";
    
    for (const entry of this.storage.iterate()) {
      const computed = this.computeHash(entry);
      const expectedSig = crypto.createHmac('sha256', SIGNING_KEY)
        .update(computed + expectedPrevHash)
        .digest('hex');
      
      if (entry.integrity.signature !== expectedSig) {
        return { valid: false, broken_at: entry.id };
      }
      
      expectedPrevHash = computed;
    }
    
    return { valid: true };
  }
}
```

---

## Performance Metrics

### Metric Categories

#### 1. Task Execution Metrics

```typescript
interface TaskMetrics {
  // Counters
  tasks_total: Counter;
  tasks_by_status: Counter<{ status: string }>;
  tasks_by_type: Counter<{ type: string }>;
  
  // Histograms
  task_duration_seconds: Histogram;
  task_queue_wait_seconds: Histogram;
  
  // Gauges
  tasks_in_progress: Gauge;
  task_queue_depth: Gauge;
  
  // Derived
  success_rate: () => number;  // tasks_completed / tasks_total
  p50_duration: () => number;
  p95_duration: () => number;
  p99_duration: () => number;
}
```

#### 2. Resource Usage Metrics

```typescript
interface ResourceMetrics {
  // Token Usage
  tokens_consumed_total: Counter<{ model: string, type: "input" | "output" }>;
  tokens_cached_total: Counter;
  token_cost_usd_total: Counter<{ model: string }>;
  
  // System Resources
  memory_usage_bytes: Gauge;
  memory_peak_bytes: Gauge;
  cpu_usage_percent: Gauge;
  
  // API Calls
  api_calls_total: Counter<{ provider: string, endpoint: string }>;
  api_latency_seconds: Histogram<{ provider: string }>;
  api_errors_total: Counter<{ provider: string, error_type: string }>;
  
  // Storage
  storage_used_bytes: Gauge<{ type: "logs" | "cache" | "workspace" }>;
  storage_operations_total: Counter<{ operation: "read" | "write" | "delete" }>;
}
```

#### 3. Security Metrics

```typescript
interface SecurityMetrics {
  // Authentication
  auth_attempts_total: Counter<{ method: string, success: boolean }>;
  auth_failures_by_reason: Counter<{ reason: string }>;
  active_sessions: Gauge;
  
  // Authorization
  permission_checks_total: Counter<{ resource: string, granted: boolean }>;
  permission_denials_total: Counter<{ resource: string, user_role: string }>;
  
  // Threats
  blocked_requests_total: Counter<{ reason: string }>;
  rate_limit_hits_total: Counter<{ rule: string }>;
  injection_attempts_detected: Counter<{ type: string }>;
  
  // Audit
  audit_entries_total: Counter<{ level: string }>;
  audit_chain_verifications: Counter<{ result: "valid" | "invalid" }>;
}
```

### Metrics Export

```yaml
metrics_export:
  prometheus:
    enabled: true
    port: 9090
    path: /metrics
    
  opentelemetry:
    enabled: true
    endpoint: localhost:4317
    protocol: grpc
    
  json_file:
    enabled: true
    path: ~/.secureclaw/metrics/
    rotation: hourly
    retention: 7d
    
  websocket:
    enabled: true
    port: 18790
    path: /ws/metrics
    update_interval: 1s
```

---

## Dashboard Integration

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SecureClaw Dashboard                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Metrics View │ │ Task History │ │ Connections  │             │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘             │
│         │                │                │                      │
│  ┌──────┴────────────────┴────────────────┴───────┐             │
│  │              TanStack Query Store               │             │
│  └──────────────────────┬──────────────────────────┘             │
│                         │                                        │
│  ┌──────────────────────┴──────────────────────────┐             │
│  │           WebSocket + REST API Client           │             │
│  └──────────────────────┬──────────────────────────┘             │
└─────────────────────────┼───────────────────────────────────────┘
                          │
                          │ WSS/HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SecureClaw Gateway                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                │
│  │  WebSocket  │ │  REST API   │ │   Metrics   │                │
│  │   Server    │ │   Server    │ │   Exporter  │                │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘                │
│         │               │               │                        │
│  ┌──────┴───────────────┴───────────────┴──────┐                │
│  │              Core Agent Engine               │                │
│  └──────────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### Dashboard Components

#### 1. MetricsGraph (ReactFlow)

Real-time visualization of agent activity:

```typescript
interface MetricsGraphProps {
  // Node types
  nodes: {
    task: TaskNode;          // Active/completed tasks
    connection: ConnectionNode;  // Platform connections
    resource: ResourceNode;   // System resources
    alert: AlertNode;         // Security events
  };
  
  // Edge types
  edges: {
    dependency: Edge;        // Task dependencies
    dataFlow: Edge;          // Data movement
    alert: Edge;             // Alert triggers
  };
  
  // Layout
  layout: "dagre" | "elk" | "force";
  
  // Interactivity
  onNodeClick: (node: Node) => void;
  onNodeExpand: (node: Node) => void;  // Show details
}
```

#### 2. TaskHistory

Historical task browser with filtering:

```typescript
interface TaskHistoryProps {
  // Filters
  filters: {
    dateRange: [Date, Date];
    status: TaskStatus[];
    type: TaskType[];
    search: string;
    user: string;
  };
  
  // Pagination
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  
  // Sorting
  sortBy: "timestamp" | "duration" | "tokens" | "status";
  sortOrder: "asc" | "desc";
  
  // Actions
  onExport: (format: "json" | "csv") => void;
  onTaskSelect: (taskId: string) => void;
}
```

#### 3. SecurityEvents

Audit log viewer:

```typescript
interface SecurityEventsProps {
  // Real-time stream
  liveEvents: boolean;
  
  // Severity filter
  minSeverity: "info" | "warn" | "error" | "critical";
  
  // Event types
  eventTypes: {
    authentication: boolean;
    authorization: boolean;
    rateLimit: boolean;
    injection: boolean;
    anomaly: boolean;
  };
  
  // Actions
  onAcknowledge: (eventId: string) => void;
  onInvestigate: (eventId: string) => void;
  onExport: () => void;
}
```

#### 4. ConnectionManager

Platform connection UI:

```typescript
interface ConnectionManagerProps {
  // Supported platforms
  platforms: {
    telegram: PlatformConfig;
    discord: PlatformConfig;
    slack: PlatformConfig;
    whatsapp: PlatformConfig;
    matrix: PlatformConfig;
    // ... more
  };
  
  // Active connections
  connections: Connection[];
  
  // Actions
  onConnect: (platform: string, config: PlatformConfig) => void;
  onDisconnect: (connectionId: string) => void;
  onTest: (connectionId: string) => void;
  onRefreshToken: (connectionId: string) => void;
}

interface Connection {
  id: string;
  platform: string;
  status: "connected" | "disconnected" | "error" | "pending";
  lastActivity: Date;
  messageCount: number;
  errorCount: number;
  config: PlatformConfig;  // Secrets redacted
}
```

#### 5. ResourceMonitor

Real-time resource gauges:

```typescript
interface ResourceMonitorProps {
  // Metrics
  metrics: {
    cpu: {
      current: number;
      limit: number;
      history: TimeSeries;
    };
    memory: {
      used: number;
      limit: number;
      peak: number;
      history: TimeSeries;
    };
    tokens: {
      today: number;
      limit: number;
      costUsd: number;
      history: TimeSeries;
    };
    network: {
      sent: number;
      received: number;
      activeConnections: number;
    };
  };
  
  // Display options
  showHistorical: boolean;
  timeRange: "1h" | "6h" | "24h" | "7d";
  
  // Alerts
  thresholds: {
    cpu: number;      // Alert when exceeded
    memory: number;
    tokens: number;
  };
}
```

### WebSocket Protocol

```typescript
// Client -> Server
interface WSClientMessage {
  type: "subscribe" | "unsubscribe" | "command";
  payload: {
    channels?: string[];  // ["metrics", "tasks", "security"]
    command?: string;
    args?: Record<string, unknown>;
  };
}

// Server -> Client
interface WSServerMessage {
  type: "update" | "event" | "error" | "ack";
  channel: string;
  payload: unknown;
  timestamp: number;
  sequence: number;  // For ordering
}

// Channels
const CHANNELS = {
  METRICS: "metrics",           // Resource usage updates
  TASKS: "tasks",               // Task lifecycle events
  SECURITY: "security",         // Security events
  CONNECTIONS: "connections",   // Platform connection status
  SYSTEM: "system"              // System health
};
```

---

## Execution Rules

### Pre-Execution Checks

```typescript
async function preExecutionChecks(task: Task, context: ExecutionContext): Promise<CheckResult> {
  const checks = [
    // Authentication
    () => verifyAuthentication(context.token),
    
    // Authorization
    () => checkPermissions(context.user, task.requiredPermissions),
    
    // Rate limiting
    () => checkRateLimit(context.user, task.type),
    
    // Input validation
    () => validateInput(task.input),
    
    // Resource availability
    () => checkResourceAvailability(task.estimatedResources),
    
    // Security policy
    () => checkSecurityPolicy(task),
    
    // Sandbox readiness
    () => verifySandboxHealth(),
  ];
  
  for (const check of checks) {
    const result = await check();
    if (!result.passed) {
      await auditLog.record({
        event: "pre_execution_check_failed",
        check: result.checkName,
        reason: result.reason,
        task_id: task.id
      });
      return result;
    }
  }
  
  return { passed: true };
}
```

### Execution Wrapper

```typescript
async function executeTask(task: Task, context: ExecutionContext): Promise<TaskResult> {
  const taskLog = new TaskLogEntry(task.id);
  taskLog.markStarted();
  
  try {
    // Pre-execution
    const preCheck = await preExecutionChecks(task, context);
    if (!preCheck.passed) {
      throw new PreExecutionError(preCheck.reason);
    }
    
    // Execute in sandbox
    const result = await sandbox.run(async () => {
      // Set resource limits
      setResourceLimits(task.limits);
      
      // Set timeout
      const timeoutId = setTimeout(() => {
        throw new TimeoutError(`Task exceeded ${task.timeout}ms limit`);
      }, task.timeout);
      
      try {
        return await task.execute(context);
      } finally {
        clearTimeout(timeoutId);
      }
    });
    
    // Record success
    taskLog.markCompleted(result);
    taskLog.recordResources(getResourceUsage());
    
    return result;
    
  } catch (error) {
    // Record failure
    taskLog.markFailed(error);
    
    // Security event if applicable
    if (isSecurityEvent(error)) {
      await securityEventHandler.handle(error, context);
    }
    
    throw error;
    
  } finally {
    // Always log
    await auditChain.append(taskLog.finalize());
    
    // Update metrics
    metrics.tasks_total.inc({ type: task.type });
    metrics.task_duration_seconds.observe(taskLog.duration);
  }
}
```

### Allowed Operations

```yaml
allowed_operations:
  filesystem:
    read:
      - ~/.secureclaw/workspace/**
      - ~/.secureclaw/config/**  # read-only
      - /tmp/secureclaw/**
    write:
      - ~/.secureclaw/workspace/**
      - /tmp/secureclaw/**
    execute:
      - /tmp/secureclaw/sandbox/**
    
  network:
    outbound:
      - api.anthropic.com:443
      - api.openai.com:443
      # Add allowed endpoints
    inbound:
      - localhost:18789   # Gateway
      - localhost:3000    # Dashboard
    
  system:
    allowed_commands:
      - git
      - npm
      - node
      - python
      - curl  # with restrictions
    denied_commands:
      - sudo
      - su
      - chmod
      - chown
      - rm -rf /
```

---

## Tool Definitions

### Claude-Optimized Tool Schema

```typescript
const SECURECLAW_TOOLS = {
  // Secure file operations
  secure_read_file: {
    name: "secure_read_file",
    description: "Read a file from the sandboxed workspace. Automatically validates path and logs access.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within workspace"
        },
        encoding: {
          type: "string",
          enum: ["utf-8", "base64", "binary"],
          default: "utf-8"
        }
      },
      required: ["path"]
    }
  },
  
  secure_write_file: {
    name: "secure_write_file",
    description: "Write a file to the sandboxed workspace. Validates content and creates audit entry.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path within workspace"
        },
        content: {
          type: "string",
          description: "File content"
        },
        mode: {
          type: "string",
          enum: ["overwrite", "append", "create_only"],
          default: "overwrite"
        }
      },
      required: ["path", "content"]
    }
  },
  
  secure_execute: {
    name: "secure_execute",
    description: "Execute a command in the sandbox. Only allowed commands can run.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute"
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Command arguments"
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds",
          default: 30000
        },
        working_dir: {
          type: "string",
          description: "Working directory (relative to workspace)"
        }
      },
      required: ["command"]
    }
  },
  
  secure_fetch: {
    name: "secure_fetch",
    description: "Fetch a URL. Only allowlisted domains permitted.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch"
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          default: "GET"
        },
        headers: {
          type: "object",
          description: "Request headers"
        },
        body: {
          type: "string",
          description: "Request body (for POST/PUT)"
        }
      },
      required: ["url"]
    }
  },
  
  log_task: {
    name: "log_task",
    description: "Create an explicit log entry for task progress or important events.",
    input_schema: {
      type: "object",
      properties: {
        level: {
          type: "string",
          enum: ["debug", "info", "warn", "error"],
          default: "info"
        },
        message: {
          type: "string",
          description: "Log message"
        },
        metadata: {
          type: "object",
          description: "Additional structured data"
        }
      },
      required: ["message"]
    }
  },
  
  get_metrics: {
    name: "get_metrics",
    description: "Retrieve current performance metrics.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["tasks", "resources", "security", "all"],
          default: "all"
        },
        time_range: {
          type: "string",
          enum: ["1h", "6h", "24h", "7d"],
          default: "1h"
        }
      }
    }
  }
};
```

---

## Error Handling & Incident Response

### Error Classification

```typescript
enum ErrorSeverity {
  LOW = 1,      // Recoverable, no action needed
  MEDIUM = 2,   // Recoverable, should be monitored
  HIGH = 3,     // Requires attention
  CRITICAL = 4  // Immediate action required
}

interface ErrorClassification {
  code: string;
  severity: ErrorSeverity;
  category: "operational" | "security" | "resource" | "external";
  recoverable: boolean;
  autoRetry: boolean;
  notifyChannels: string[];
}

const ERROR_CLASSIFICATIONS: Record<string, ErrorClassification> = {
  "AUTH_FAILED": {
    code: "E1001",
    severity: ErrorSeverity.MEDIUM,
    category: "security",
    recoverable: false,
    autoRetry: false,
    notifyChannels: ["security"]
  },
  "RATE_LIMITED": {
    code: "E2001",
    severity: ErrorSeverity.LOW,
    category: "operational",
    recoverable: true,
    autoRetry: true,
    notifyChannels: []
  },
  "SANDBOX_ESCAPE_ATTEMPT": {
    code: "E3001",
    severity: ErrorSeverity.CRITICAL,
    category: "security",
    recoverable: false,
    autoRetry: false,
    notifyChannels: ["security", "admin", "audit"]
  },
  // ... more classifications
};
```

### Incident Response

```yaml
incident_response:
  severity_levels:
    critical:
      response_time: 5m
      actions:
        - pause_all_tasks
        - notify_admin
        - create_incident_report
        - snapshot_state
      escalation:
        - email
        - sms
        - webhook
        
    high:
      response_time: 30m
      actions:
        - pause_affected_tasks
        - notify_operators
        - create_incident_report
      escalation:
        - email
        - webhook
        
    medium:
      response_time: 4h
      actions:
        - log_incident
        - notify_operators
      escalation:
        - email
        
    low:
      response_time: 24h
      actions:
        - log_incident
      escalation: []
```

### Recovery Procedures

```typescript
const RECOVERY_PROCEDURES = {
  "sandbox_corruption": {
    detect: () => verifySandboxIntegrity(),
    recover: async () => {
      await sandbox.terminate();
      await sandbox.reinitialize();
      await verifyRecovery();
    }
  },
  
  "audit_chain_break": {
    detect: () => auditChain.verify(),
    recover: async (breakpoint: string) => {
      // Create forensic snapshot
      await createForensicSnapshot(breakpoint);
      
      // Alert administrators
      await alertAdmin("Audit chain integrity compromised", { breakpoint });
      
      // Start new chain with reference
      await auditChain.fork(breakpoint);
    }
  },
  
  "resource_exhaustion": {
    detect: () => checkResourceLimits(),
    recover: async (resource: string) => {
      // Graceful degradation
      await taskQueue.pause();
      
      // Clean up
      await cleanup(resource);
      
      // Resume with reduced limits
      await taskQueue.resume({ reducedCapacity: true });
    }
  }
};
```

---

## Configuration

### Configuration File Structure

```yaml
# ~/.secureclaw/config.yaml

version: "1.0"

# Core settings
core:
  name: "SecureClaw"
  environment: production  # development | staging | production
  log_level: info
  workspace: ~/.secureclaw/workspace

# Security settings
security:
  rbac:
    enabled: true
    default_role: viewer
  encryption:
    enabled: true
    algorithm: aes-256-gcm
  sandbox:
    enabled: true
    technology: auto  # seccomp | landlock | appcontainer | auto
  rate_limiting:
    enabled: true
    
# Logging settings
logging:
  level: info
  format: json
  output:
    - type: file
      path: ~/.secureclaw/logs/
      rotation: daily
      retention: 30d
    - type: stdout
      format: pretty
  audit:
    enabled: true
    chain_verification: hourly
    
# Metrics settings
metrics:
  enabled: true
  export:
    prometheus:
      enabled: true
      port: 9090
    websocket:
      enabled: true
      port: 18790
      
# Dashboard settings
dashboard:
  enabled: true
  port: 3000
  host: 127.0.0.1
  auth:
    method: jwt
    session_timeout: 3600
    
# Gateway settings
gateway:
  port: 18789
  host: 127.0.0.1
  tls:
    enabled: false  # Enable for production
    cert: ~/.secureclaw/certs/server.crt
    key: ~/.secureclaw/certs/server.key
    
# Model settings
model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  api_key_env: ANTHROPIC_API_KEY
  max_tokens: 16384
  temperature: 0.7
  
# Integrations (optional)
integrations:
  telegram:
    enabled: false
    token_env: TELEGRAM_BOT_TOKEN
  discord:
    enabled: false
    token_env: DISCORD_BOT_TOKEN
  # ... more platforms
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional - Security
SECURECLAW_ENCRYPTION_KEY=...
SECURECLAW_SIGNING_KEY=...

# Optional - Integrations
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
SLACK_BOT_TOKEN=...

# Optional - Monitoring
PROMETHEUS_PUSH_GATEWAY=...
OTLP_ENDPOINT=...
```

---

## API Reference

### REST API

```yaml
openapi: 3.0.0
info:
  title: SecureClaw API
  version: 1.0.0

paths:
  # Health
  /health:
    get:
      summary: Health check
      responses:
        200:
          description: Healthy
          
  # Tasks
  /api/v1/tasks:
    get:
      summary: List tasks
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [pending, running, completed, failed]
        - name: limit
          in: query
          schema:
            type: integer
            default: 50
        - name: offset
          in: query
          schema:
            type: integer
            default: 0
      responses:
        200:
          description: Task list
          
    post:
      summary: Create task
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/TaskCreate'
      responses:
        201:
          description: Task created
          
  /api/v1/tasks/{taskId}:
    get:
      summary: Get task details
      responses:
        200:
          description: Task details
          
    delete:
      summary: Cancel task
      responses:
        204:
          description: Task cancelled
          
  # Metrics
  /api/v1/metrics:
    get:
      summary: Get metrics
      parameters:
        - name: category
          in: query
          schema:
            type: string
            enum: [tasks, resources, security, all]
        - name: range
          in: query
          schema:
            type: string
            enum: [1h, 6h, 24h, 7d]
      responses:
        200:
          description: Metrics data
          
  # Audit
  /api/v1/audit:
    get:
      summary: Get audit logs
      parameters:
        - name: level
          in: query
          schema:
            type: string
            enum: [info, warn, error, security]
        - name: from
          in: query
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          schema:
            type: string
            format: date-time
      responses:
        200:
          description: Audit log entries
          
  /api/v1/audit/verify:
    post:
      summary: Verify audit chain integrity
      responses:
        200:
          description: Verification result
          
  # Connections
  /api/v1/connections:
    get:
      summary: List connections
      responses:
        200:
          description: Connection list
          
    post:
      summary: Create connection
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ConnectionCreate'
      responses:
        201:
          description: Connection created
          
  /api/v1/connections/{connectionId}:
    delete:
      summary: Remove connection
      responses:
        204:
          description: Connection removed
          
  /api/v1/connections/{connectionId}/test:
    post:
      summary: Test connection
      responses:
        200:
          description: Connection test result
```

### WebSocket Events

```typescript
// Subscribe to channels
ws.send(JSON.stringify({
  type: "subscribe",
  payload: { channels: ["metrics", "tasks", "security"] }
}));

// Receive events
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  
  switch (msg.channel) {
    case "metrics":
      // { cpu: 45, memory: 512, tokens_today: 10000, ... }
      updateMetricsDisplay(msg.payload);
      break;
      
    case "tasks":
      // { id: "...", status: "completed", duration: 1234, ... }
      updateTaskList(msg.payload);
      break;
      
    case "security":
      // { type: "auth_failure", user: "...", ip: "...", ... }
      handleSecurityEvent(msg.payload);
      break;
  }
};
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-org/friday.git
cd friday

# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Run tests
pnpm test

# Run security audit
pnpm audit
```

### Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

---

## Acknowledgments

- Inspired by [OpenClaw](https://github.com/openclaw/openclaw) and [CrabWalk](https://github.com/luccast/crabwalk)
- Built with security principles from OWASP and NIST
- Dashboard powered by TanStack and ReactFlow

---

*SecureClaw - Because security shouldn't be an afterthought.*
