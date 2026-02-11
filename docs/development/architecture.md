# Architecture Overview

> Technical architecture and system design for F.R.I.D.A.Y. and SecureYeoman

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Components](#core-components)
3. [Security Architecture](#security-architecture)
4. [Data Flow](#data-flow)
5. [Technology Stack](#technology-stack)
6. [Design Decisions](#design-decisions)

---

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   FRIDAY Dashboard                      │
│            (React + TanStack + ReactFlow)               │
└─────────────────────────┬───────────────────────────────┘
                          │ WebSocket + REST
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  SecureYeoman Gateway                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │   Security  │ │   Metrics   │ │    Audit    │        │
│  │    Layer    │ │  Collector  │ │    Chain    │        │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘        │
│         └───────────────┼───────────────┘               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Sandboxed Agent Engine              │   │
│  │       (Anthropic, OpenAI, Gemini, Ollama)        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
friday/
├── README.md                   # Project overview
├── CONTRIBUTING.md             # Development guide
├── SECURITY.md                # Security policy
├── LICENSE                    # MIT License
├── packages/
│   ├── shared/                # Shared types and utilities
│   │   └── src/
│   │       └── types/         # TypeScript interfaces
│   ├── core/                  # Agent engine
│   │   └── src/
│   │       ├── ai/            # Multi-provider AI client
│   │       ├── cli.ts         # CLI entry point
│   │       ├── config/        # Configuration management
│   │       ├── gateway/       # Fastify server + auth
│   │       ├── logging/       # Audit chain + storage
│   │       ├── sandbox/       # Cross-platform sandbox
│   │       ├── security/      # RBAC, auth, secrets
│   │       ├── brain/          # Memory, knowledge, skills
│   │       ├── comms/          # E2E encrypted agent comms
│   │       ├── soul/          # Personality + identity
│   │       ├── task/          # Task execution + storage
│   │       ├── integrations/  # Platform adapters (Telegram, etc.)
│   │       └── utils/         # Crypto utilities
│   └── dashboard/             # React dashboard
│       └── src/
│           ├── components/    # UI components
│           ├── hooks/         # React hooks
│           └── api/           # API client
├── docs/                      # Documentation
│   ├── api/                   # API documentation
│   ├── guides/                # User guides
│   ├── security/              # Security docs
│   └── development/           # Development docs
└── site/                      # Project website
```

---

## Core Components

### 1. Agent Engine (Core)

**Location**: `packages/core/src/`

**Responsibilities**:
- Task execution and lifecycle management
- Multi-provider AI integration
- Resource monitoring and metrics collection
- Audit logging and integrity verification

**Key Modules**:
- `ai/` - AI provider abstraction (Anthropic, OpenAI, Gemini, Ollama) with configurable fallback chain on rate limits / provider unavailability
- `task/` - Task queue, execution, and persistence
- `logging/` - Structured logging with cryptographic audit chain
- `config/` - Configuration loading and validation

### 2. Security Layer

**Location**: `packages/core/src/security/`

**Responsibilities**:
- Authentication and authorization (RBAC)
- Encryption and secret management
- Input validation and sanitization
- Rate limiting and threat detection

**Key Modules**:
- `rbac.ts` - Role-based access control
- `auth.ts` - JWT and API key authentication
- `secrets.ts` - Encrypted storage and keyring integration
- `rate-limiter.ts` - Sliding window rate limiting

### 3. Gateway Server

**Location**: `packages/core/src/gateway/`

**Responsibilities**:
- HTTP API endpoints
- WebSocket real-time updates
- Request routing and middleware
- Health checks and metrics export

**Features**:
- Fastify-based REST API
- WebSocket server for real-time updates
- Authentication middleware
- Request validation and rate limiting

### 4. Dashboard UI

**Location**: `packages/dashboard/src/`

**Responsibilities**:
- Real-time monitoring interface
- Task history and management
- Security event monitoring
- System configuration

**Key Components**:
- `MetricsGraph` - ReactFlow visualization
- `TaskHistory` - Historical task browser
- `SecurityEvents` - Audit log viewer
- `ConnectionManager` - Platform integration UI

### 5. Brain System

**Location**: `packages/core/src/brain/`

**Responsibilities**:
- Memory storage and retrieval (episodic, semantic, procedural, preference)
- Knowledge base management with confidence tracking
- Skill registry (moved from Soul for separation of concerns)
- Context injection into AI prompts from relevant memories/knowledge

**Key Modules**:
- `storage.ts` - SQLite persistence for memories, knowledge, and skills
- `manager.ts` - BrainManager with memory decay, pruning, and context retrieval
- `brain-routes.ts` - REST API endpoints

### 6. Agent Communication (Comms)

**Location**: `packages/core/src/comms/`

**Responsibilities**:
- E2E encrypted messaging between FRIDAY instances
- Peer agent discovery and management
- Secret sanitization (strips API keys, tokens from payloads)
- Local message log with retention policies

**Key Modules**:
- `crypto.ts` - X25519 key exchange + Ed25519 signing + AES-256-GCM encryption
- `storage.ts` - Peer registry and message log persistence
- `agent-comms.ts` - AgentComms orchestrator
- `comms-routes.ts` - REST API endpoints

### 7. Sandbox System

**Location**: `packages/core/src/sandbox/`

**Responsibilities**:
- Cross-platform execution isolation
- Resource limits and monitoring
- Filesystem access control
- Network restriction enforcement

**Features**:
- Platform-specific implementations:
  - **Linux**: V1 soft sandbox (path validation, resource tracking) + V2 Landlock kernel enforcement via forked worker process (graceful fallback to V1 if kernel lacks Landlock support)
  - **macOS**: `sandbox-exec` profile generation with deny-default policy; falls back to resource tracking when sandbox-exec is unavailable
  - **Other**: NoopSandbox fallback with warning
- Resource usage tracking (memory peak, CPU time)
- Violation detection and reporting
- SandboxManager auto-detects platform capabilities and selects the appropriate implementation

---

## Security Architecture

### Defense in Depth

```
┌─────────────────────────────────────────────────────────┐
│                    Network Layer                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │   TLS 1.3   │ │ Domain WL   │ │ Rate Limit  │        │
│  └─────────────┘ └─────────────┘ └─────────────┘        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                  Application Layer                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │     RBAC    │ │ Input Val   │ │   JWT Auth  │        │
│  └─────────────┘ └─────────────┘ └─────────────┘        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────┐
│                   Execution Layer                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐        │
│  │   Sandbox   │ │ Encryption  │ │   Audit     │        │
│  └─────────────┘ └─────────────┘ └─────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### Security Features

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| **Network** | TLS 1.3, Domain Whitelisting | Secure communication, prevent unauthorized access |
| **Application** | RBAC, JWT, Input Validation | Access control, prevent injection attacks |
| **Execution** | Sandboxing, Encryption, Audit | Isolate untrusted code, protect data, track access |

---

## Data Flow

### Request Processing Flow

```
1. Client Request
   ↓
2. Gateway Authentication
   ↓ (JWT/API Key)
3. RBAC Authorization
   ↓ (Permission Check)
4. Input Validation
   ↓ (Sanitization)
5. Rate Limit Check
   ↓ (Sliding Window)
6. Task Creation
   ↓ (Queue)
7. Sandboxed Execution
   ↓ (Resource Limits)
8. AI Provider Call
   ↓ (Multi-provider)
9. Response Processing
   ↓ (Validation)
10. Audit Logging
    ↓ (Cryptographic Chain)
11. Client Response
```

### Audit Data Flow

```
Task Execution
   ↓
Event Capture (Structured Logger)
   ↓
Entry Creation (UUID v7 + Hash)
   ↓
Chain Verification (HMAC-SHA256)
   ↓
SQLite Storage (WAL Mode)
   ↓
Query API (REST Endpoint)
   ↓
Dashboard Display (WebSocket)
```

---

## Technology Stack

### Backend

| Component | Technology | Reason |
|-----------|------------|--------|
| Runtime | Node.js 20 LTS | TypeScript support, async performance |
| Framework | Fastify | High performance, built-in validation |
| Database | SQLite | Zero-config, portable, ACID compliant |
| Cryptography | Node.js crypto | Native implementation, FIPS compliant |
| Testing | Vitest | Fast, Vite-native, modern |

### Frontend

| Component | Technology | Reason |
|-----------|------------|--------|
| Framework | React 18 | Component ecosystem, concurrent features |
| Build Tool | Vite | Fast HMR, modern bundling |
| State Management | TanStack Query | Cache management, real-time updates |
| UI Components | Tailwind CSS | Utility-first, consistent |
| Visualization | ReactFlow | Interactive node graphs |
| TypeScript | TypeScript 5 | Type safety, developer experience |

### Development

| Tool | Purpose |
|------|---------|
| ESLint + Prettier | Code quality and formatting |
| Husky | Git hooks for pre-commit checks |
| GitHub Actions | CI/CD pipeline |
| Docker | Containerization and deployment |

---

## Design Decisions

### 1. Monorepo vs Multi-repo

**Decision**: Monorepo with pnpm workspaces

**Rationale**:
- Shared TypeScript types between packages
- Unified tooling and configuration
- Simplified dependency management
- Atomic commits across packages

### 2. Database Choice

**Decision**: SQLite with PostgreSQL abstraction

**Rationale**:
- SQLite: Zero-config, perfect for single-user local deployment
- PostgreSQL: Scalable for multi-user enterprise deployments
- Abstraction layer for flexibility

### 3. Authentication Strategy

**Decision**: JWT + API keys with refresh rotation

**Rationale**:
- JWT: Stateless, works well with distributed systems
- API Keys: Simple for programmatic access
- Refresh rotation: Balance security and usability

### 4. Real-time Communication

**Decision**: WebSocket with SSE fallback

**Rationale**:
- WebSocket: Full-duplex, low latency for real-time updates
- SSE: Simple fallback for firewall-restricted environments
- Both standardized and well-supported

### 5. Security Model

**Decision**: Defense in depth with audit first

**Rationale**:
- Multiple layers prevent single point of failure
- Comprehensive logging for compliance and forensics
- Security as a first-class citizen, not an afterthought

### 6. Plugin Architecture

**Decision**: TypeScript interfaces with dynamic imports

**Rationale**:
- Type-safe plugin development
- Runtime flexibility for integrations
- Sandboxed plugin execution

---

## Performance Considerations

### Scalability

| Component | Scaling Strategy |
|-----------|------------------|
| Gateway | Horizontal scaling with load balancer |
| Database | Read replicas, connection pooling |
| AI Calls | Provider rotation, caching, retry |
| Dashboard | Code splitting, lazy loading |

### Caching

| Layer | Cache Type | Duration |
|-------|------------|----------|
| API Response | In-memory | 5 minutes |
| AI Calls | Token cache | 1 hour |
| RBAC | Permission cache | 30 minutes |
| Audit Queries | SQLite WAL | Real-time |

### Monitoring

- Real-time metrics via WebSocket
- Prometheus export for observability
- Structured logging for debugging
- Performance profiling with built-in timers

---

## Related Documentation

- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Development Roadmap](roadmap.md)

---

*This architecture document reflects the current state of F.R.I.D.A.Y. and evolves as the system develops.*