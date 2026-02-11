# SecureYeoman Development TODO

> Development roadmap, next steps, and considerations for the SecureYeoman secure autonomous agent system.

[![Project Status: Active Development](https://img.shields.io/badge/Status-Active%20Development-brightgreen.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

---

## Table of Contents

1. [Development Phases](#development-phases)
2. [Phase 1: Foundation](#phase-1-foundation)
3. [Phase 2: Security Layer](#phase-2-security-layer)
4. [Phase 2.5: Core Infrastructure Gaps](#phase-25-core-infrastructure-gaps)
5. [Phase 3: Dashboard](#phase-3-dashboard)
6. [Phase 4: Integrations](#phase-4-integrations)
7. [Phase 5: Production Hardening](#phase-5-production-hardening)
8. [Dashboard Component Specifications](#dashboard-component-specifications)
9. [API Endpoint Specifications](#api-endpoint-specifications)
10. [Data Models](#data-models)
11. [Technical Considerations](#technical-considerations)
12. [Security Considerations](#security-considerations)
13. [Performance Considerations](#performance-considerations)
14. [Future Enhancements](#future-enhancements)
15. [Research Required](#research-required)
16. [Dependencies](#dependencies)

---

## Development Phases

```
Phase 1          Phase 2          Phase 2.5        Phase 3          Phase 4          Phase 5
Foundation       Security         Infrastructure   Dashboard        Integrations     Production
   |                |                |                |                |                |
   v                v                v                v                v                v
[Core Agent] -> [RBAC/Crypto] -> [Brain/Comms] -> [React UI] -> [Platforms] -> [Hardening]
   |                |                |                |                |                |
   +- Task Loop     +- Encryption    +- CLI           +- Metrics       +- Telegram ✓    +- Load Testing
   +- Logging       +- Sandbox       +- Brain/Soul    +- History       +- Discord       +- Security Testing
   +- Config        +- Validation    +- E2E Comms     +- Connections   +- Slack         +- Prometheus
   +- Storage       +- Rate Limit    +- Fallbacks     +- Security      +- GitHub        +- Docs
   +- AI Providers  +- mTLS          +- Task Storage  +- Soul UI       +- Webhooks      +- Deployment
```

---

## Phase 1: Foundation

**Goal**: Establish core agent loop with comprehensive logging infrastructure.

**Duration**: 2-3 weeks

### Tasks

#### Core Agent Engine
- [x] **P1-001**: Set up TypeScript project structure
  - Initialize with `pnpm init`
  - Configure `tsconfig.json` with strict mode
  - Set up ESLint + Prettier
  - Configure Vitest for testing

- [x] **P1-002**: Implement configuration management
  - YAML config file parser
  - Environment variable loading
  - Config validation with Zod
  - ~~Hot-reload support for development~~ (deferred)

- [x] **P1-003**: Create base agent loop
  - Task queue implementation (FIFO with max concurrent limit)
  - Event-driven architecture
  - Graceful shutdown handling
  - Health check endpoint

- [x] **P1-004**: Implement multi-provider AI integration
  - Anthropic SDK wrapper with tool calling and streaming
  - OpenAI GPT provider (gpt-4o, o1, o3-mini)
  - Google Gemini provider (gemini-2.0-flash, 1.5-pro)
  - Ollama local provider (fetch-based, no SDK dependency)
  - Unified AIClient orchestrator with provider factory
  - Token counting, cost calculation, and usage tracking
  - Exponential backoff retry with jitter (RetryManager)
  - Structured error hierarchy (RateLimitError, AuthenticationError, etc.)
  - Audit chain integration for request/response logging

#### Logging Infrastructure
- [x] **P1-005**: Design log entry schema
  - UUID v7 generation for time-sortable IDs
  - Structured JSON format
  - Correlation ID propagation
  - Input/output hashing (not storing raw data)

- [x] **P1-006**: Implement log storage backend
  - [x] SQLite for local storage (default) — `SQLiteAuditStorage` with WAL mode, query/filter/pagination
  - [x] SQLite storage tests (27 tests — persistence, WAL, schema, query filtering)
  - [ ] Append-only log file format (deferred)
  - [ ] Log rotation and compression (deferred)
  - [ ] Retention policy enforcement (deferred)

- [x] **P1-007**: Create audit chain
  - HMAC-SHA256 signing
  - Chain integrity verification
  - Genesis block creation
  - Fork handling (snapshot-based recovery)

- [x] **P1-008**: Build log query API
  - [x] Storage-layer query support (`SQLiteAuditStorage.query()` with time-range, level, event, userId, taskId, pagination)
  - [x] `getByTaskId()` and `getByCorrelationId()` convenience methods
  - [x] Wire up REST endpoint (`GET /api/v1/audit`) in gateway with query params (from, to, level, event, userId, taskId, limit, offset)
  - [x] `queryAuditLog()` method on `SecureYeoman` class
  - [x] `query()` method on `InMemoryAuditStorage` for parity with `SQLiteAuditStorage`
  - [ ] Full-text search (optional, deferred)

#### Testing
- [x] **P1-009**: Unit tests for core components
  - [x] Config loading tests (24 tests)
  - [x] Crypto utilities tests (40 tests)
  - [x] RBAC tests (31 tests)
  - [x] AI Client tests (10 tests)
  - [x] AI Provider tests — Anthropic, OpenAI, Gemini, Ollama (23 tests)
  - [x] Cost Calculator tests (8 tests)
  - [x] Usage Tracker tests (6 tests)
  - [x] Retry Manager tests (15 tests)
  - [x] SQLite audit storage tests (27 tests)
  - [x] Task executor tests (12 tests)
  - [x] Audit chain tests (19 tests)
  - [x] Input validator tests (31 tests)
  - [x] Rate limiter tests (13 tests)
  - [x] Logger tests (16 tests)

- [x] **P1-010**: Integration tests
  - [x] End-to-end auth flow (login → validate → refresh → logout → verify revoked)
  - [x] Gateway API tests (public routes, protected routes, RBAC enforcement, API key auth)
  - [x] Audit trail tests (chain integrity, tamper detection, query filtering, SQLite persistence)
  - [x] 32 integration tests across 3 test files

### Deliverables
- [x] Working agent that can execute tasks via Claude API (+ OpenAI, Gemini, Ollama)
- [x] Comprehensive logging with audit trail (audit chain + SQLite storage + query layer)
- [x] Configuration system
- [x] Test coverage > 80% (~746 tests passing across 39 test files — all core modules covered)

---

## Phase 2: Security Layer

**Goal**: Implement enterprise-grade security controls.

**Duration**: 3-4 weeks

**Status**: Sprints 1-3 complete. All Phase 2 items done. Brain/Soul separation, E2E comms, mTLS, Redis rate limiter, macOS sandbox, and Linux Landlock V2 all implemented. ~746 tests passing across 39 test files.

### Completed (built during P1)

- [x] **P2-001**: RBAC system *(completed in P1)*
  - [x] Role definitions (Admin, Operator, Auditor, Viewer) — `security/rbac.ts`
  - [x] Permission matrix with wildcard and condition support
  - [x] Permission caching with LRU eviction
  - [x] `requirePermission()` enforcement (throws `PermissionDeniedError`)
  - [x] Role inheritance support
  - [x] 31 unit tests (RBAC core) + 27 unit tests (RBAC storage)
  - [x] Role assignment persistent storage — `security/rbac-storage.ts` (SQLite-backed)
    - User-role assignments persisted to `rbac.db` and survive process restarts
    - Custom role definitions persisted alongside assignments
    - Soft-delete revocations preserve full audit trail
    - Partial unique index enforces one active role per user
    - 27 unit tests covering CRUD, reassignment, revocation, and RBAC integration
  - [x] Gateway middleware for per-route RBAC enforcement — see P2-001b

- [x] **P2-005**: Encryption at rest *(completed in P1)*
  - [x] AES-256-GCM implementation — `security/secrets.ts`
  - [x] Key derivation with scrypt (N=16384, r=8, p=1)
  - [x] `SecretStore` class with encrypted file persistence
  - [x] Serialize/deserialize with magic bytes and versioning
  - [x] Memory clearing of decrypted buffers
  - [x] `encryptValue()`/`decryptValue()` convenience helpers
  - [ ] Encrypted config file support (config loader doesn't consume SecretStore yet)

- [x] **P2-007**: Secret management *(completed)*
  - [x] Secret access logging via `SecretStore.get()` debug logs
  - [x] Log redaction of sensitive fields (password, token, apiKey, etc.) — `logging/logger.ts`
  - [x] `sanitizeForLogging()` utility — `utils/crypto.ts`
  - [x] Secret rotation scheduling (via `SecretRotationManager`) — see P2-007b
  - [x] Rotation alerting / expiry tracking — see P2-007b

- [x] **P2-011**: Validation pipeline *(completed in P1)*
  - [x] Size limits — `InputValidator`
  - [x] Encoding normalization (NFC, dangerous unicode removal)
  - [x] Injection pattern detection (SQL, XSS, command, path traversal, template)
  - [x] Content policy enforcement (file validation, null byte detection)
  - [x] 31 unit tests

- [x] **P2-012**: Prompt injection defense *(completed in P1)*
  - [x] 6 prompt injection pattern families (system tags, ignore/forget instructions, pretend, jailbreak, roleplay)
  - [x] Blocking mode for high-severity patterns
  - [x] Warning mode for medium-severity patterns
  - [x] Audit logging of detected injection attempts

- [x] **P2-013**: Rate limiter *(completed in P1)*
  - [x] Sliding window counters — `security/rate-limiter.ts`
  - [x] Per-user, per-IP, per-API-key, and global limits
  - [x] Configurable rules with `addRule()`/`removeRule()`
  - [x] `log_only` mode for monitoring without blocking
  - [x] `checkMultiple()` for multi-rule enforcement
  - [x] Auto-cleanup of expired windows
  - [x] 13 unit tests

- [x] **P2-014**: Rate limit storage *(completed)*
  - [x] In-memory storage (single node)
  - [x] Metrics via `getStats()`
  - [x] Redis adapter (distributed) — `RedisRateLimiter` with sorted-set sliding window

### Remaining P2 Tasks

*Proposed priority order — highest impact items first.*

#### Priority A: Gateway Authentication (unprotected endpoints are the biggest gap)

- [x] **P2-002**: JWT authentication *(completed in Sprint 1)*
  - [x] Token generation and validation (jose library)
  - [x] Refresh token rotation
  - [x] Token blacklisting (in-memory)
  - [x] Session management
  - [x] Fastify `onRequest` hook for protected routes
  - [x] 44 unit tests (`auth.test.ts`)

- [x] **P2-003**: API key authentication *(completed in Sprint 1)*
  - [x] Key generation with `generateSecureToken()`
  - [x] Key storage in SQLite (`AuthStorage`)
  - [x] Rate limiting per key
  - [x] Key revocation
  - [x] API key auth via `X-API-Key` header in gateway

- [x] **P2-001b**: RBAC gateway middleware *(completed in Sprint 1)*
  - [x] Per-route permission enforcement in Fastify hooks (`auth-middleware.ts`)
  - [x] Extract role from JWT claims or API key lookup
  - [x] 15 unit tests (`auth-middleware.test.ts`)

#### Priority B: Secret Lifecycle

- [x] **P2-006**: System keyring integration *(completed in Sprint 2)*
  - [x] macOS Keychain (via `security` CLI)
  - [x] Linux Secret Service (via `secret-tool` CLI)
  - [x] Environment variable fallback provider
  - [x] `KeyringManager` with auto-detection and pre-loading into `process.env`
  - [x] Zero native dependencies (CLI-based, `execFileSync` with array args)
  - [x] 21 unit tests (`keyring.test.ts`)

- [x] **P2-007b**: Secret rotation *(completed in Sprint 2)*
  - [x] SQLite metadata storage for secret tracking
  - [x] Auto-rotation for internal secrets (JWT token secret, audit signing key)
  - [x] Expiry tracking and warnings for external secrets
  - [x] Dual-key JWT verification with grace period
  - [x] Multi-key audit chain verification with key schedule
  - [x] `onRotate` callbacks for AuthService and AuditChain
  - [x] 23 unit tests (`rotation.test.ts`)

#### Soul System (Personality + Skills)

- [x] **P2-015**: Soul system — personality and learnable skills for FRIDAY
  - [x] Zod schemas for Personality (name, description, systemPrompt, traits, sex, voice, preferredLanguage) and Skill
  - [x] SoulConfig in config schema (enabled, learningMode, maxSkills, maxPromptTokens)
  - [x] SQLite storage (`SoulStorage`) with WAL mode, CRUD for personalities + skills
  - [x] `SoulManager` — composition, onboarding, skill lifecycle, learning modes (user_authored, ai_proposed, autonomous)
  - [x] Prompt composition: personality + enabled skills → system message, token cap with skill priority by usage
  - [x] Tool collection from enabled skills
  - [x] Skill approval workflow (propose → approve/reject)
  - [x] 18 REST API endpoints for personality/skill CRUD, prompt preview, config, onboarding
  - [x] RBAC: operator can read+write, viewer can read only
  - [x] Wired into `SecureYeoman.initialize()` with auto-onboarding (default FRIDAY personality)
  - [x] 60 unit tests (`soul.test.ts`), 11 integration tests (`soul.integration.test.ts`)

#### Priority C: Sandboxing (largest effort, most platform-specific)

- [x] **P2-010**: Cross-platform sandbox abstraction *(completed — V1 soft sandbox)*
  - [x] `Sandbox` interface definition (`run()`, `getCapabilities()`, `isAvailable()`)
  - [x] `SandboxCapabilities` type (landlock, seccomp, namespaces, rlimits, platform)
  - [x] `SandboxManager` factory with platform detection and caching
  - [x] `NoopSandbox` fallback with warning on first use
  - [x] Config expansion: `allowedReadPaths`, `allowedWritePaths`, `maxMemoryMb`, `maxCpuPercent`, `maxFileSizeMb`, `networkAllowed`
  - [x] Integrated into `TaskExecutor.executeTask()` and `SecureYeoman.initialize()`
  - [x] `GET /api/v1/sandbox/status` endpoint
  - [x] 37 unit tests + 7 integration tests

- [x] **P2-008**: Linux sandbox implementation *(V1 + V2 Landlock)*
  - [x] `LinuxSandbox` with filesystem path validation against allowlists
  - [x] Landlock capability detection (`/proc/sys/kernel/landlock_restrict_self`, kernel >= 5.13)
  - [x] Memory and CPU resource tracking with violation detection
  - [x] Path traversal detection in configuration
  - [x] V2: Landlock enforcement via forked `landlock-worker.ts` child process
  - [x] V2: `enforceLandlock` constructor option, graceful fallback to V1 on non-Landlock kernels
  - [ ] seccomp-bpf filter creation (deferred — requires native bindings)
  - [ ] Namespace isolation (PID, network, mount) (deferred)

- [x] **P2-009**: macOS sandbox implementation
  - [x] `DarwinSandbox` with `sandbox-exec` profile generation (deny-default policy)
  - [x] System path allowlisting for Node.js (/usr, /System, /Library)
  - [x] User-configurable read/write/exec paths
  - [x] Network access control
  - [x] Fallback to resource-tracking-only when sandbox-exec unavailable
  - [x] 10 unit tests

#### Priority D: Optional / Deferred

- [x] **P2-004**: mTLS support
  - [x] TLS wired into Fastify constructor (cert/key/ca file loading)
  - [x] Client certificate authentication (CN extraction, `authMethod: 'certificate'`)
  - [x] Certificate generation utility (`cert-gen.ts` — dev CA + server + client certs via openssl)
  - [x] `--tls` CLI flag with auto-generated dev certs
  - [x] RBAC permissions for brain/comms routes
  - [x] 9 unit tests

- [x] **P2-014b**: Redis rate limit adapter
  - [x] `RedisRateLimiter` with sorted-set sliding window (ZADD/ZREMRANGEBYSCORE/ZCARD pipeline)
  - [x] Fail-open on Redis unavailability
  - [x] `createRateLimiter()` factory auto-selects Redis when `redisUrl` configured
  - [x] 12 unit tests with mocked ioredis

### Proposed Execution Order

```
Sprint 1 (Week 1-2):  P2-002 (JWT) → P2-003 (API keys) → P2-001b (RBAC middleware)
Sprint 2 (Week 2-3):  P2-006 (keyring) → P2-007b (rotation)
Sprint 2.5:           P2-015 (Soul system — personality + skills)
Sprint 3 (Week 3-4):  P2-010 (sandbox interface) → P2-008 (Linux sandbox)
Sprint 4:             P2-004 (mTLS) ✅, P2-009 (macOS sandbox) ✅, P2-014b (Redis) ✅, P2-008 V2 (Landlock) ✅
```

### Deliverables
- [x] Complete RBAC system *(done)*
- [x] Encrypted secret storage *(done)*
- [x] Input validation pipeline *(done)*
- [x] Rate limiting infrastructure *(done)*
- [x] JWT + API key authentication for gateway
- [x] RBAC middleware on all gateway routes
- [x] System keyring integration
- [x] Sandboxed execution environment *(V1 soft sandbox + V2 Landlock + macOS sandbox-exec)*
- [x] mTLS support with client certificate authentication
- [x] Redis-backed distributed rate limiting
- [ ] Security audit documentation
- [x] Code audit and refactoring pass (noop logger extraction, JSON.parse guards, queue race fix, bodyLimit, IP check, error handling)

---

## Phase 2.5: Core Infrastructure Gaps

**Goal**: Fill critical gaps that block dashboard and production readiness.

### Tasks

#### CLI & Startup
- [x] **P2.5-001**: CLI entry point (`packages/core/src/cli.ts`)
  - [x] Parse CLI args: `--port`, `--host`, `--config`, `--log-level`, `--help`, `--version`
  - [x] Boot SecureYeoman + gateway server
  - [x] Graceful shutdown on SIGINT/SIGTERM
  - [x] Print startup banner with version, port, capabilities
  - [x] `bin` entry in `package.json` pointing to `./dist/cli.js`

#### Task Persistence
- [x] **P2.5-002**: SQLite task storage (`packages/core/src/task/task-storage.ts`)
  - [x] `tasks` table with indexes on status, type, created_at, correlation_id
  - [x] `TaskStorage` class following AuthStorage/SoulStorage patterns (WAL, prepared statements)
  - [x] `storeTask()`, `updateTask()`, `getTask()`, `listTasks()` with filtering + pagination
  - [x] `getStats()` for metrics (total, by_status, by_type, success_rate, avg_duration)
  - [x] 15 unit tests (`task-storage.test.ts`)

- [x] **P2.5-003**: Wire task storage into executor and gateway
  - [x] `TaskExecutor` persists tasks on create, updates on start/complete/fail
  - [x] `GET /api/v1/tasks` returns persisted tasks with filters (status, type, limit, offset)
  - [x] `GET /api/v1/tasks/:id` returns single task (404 if not found)
  - [x] `getMetrics()` populates `tasks.total`, `byStatus`, `byType`, `successRate` from storage

#### Security Events
- [x] **P2.5-004**: Security events query API
  - [x] Query audit chain entries filtered to security-relevant event types
  - [x] `GET /api/v1/security/events` returns filtered results with support for:
    - `type` param: filter by event type (auth_failure, rate_limit, injection_attempt, permission_denied, sandbox_violation, etc.)
    - `severity` param: filter by audit level
    - `from`/`to` params: time-range filtering
    - `limit`/`offset` params: pagination
  - [x] Graceful degradation when audit storage doesn't support querying

#### Rate Limit Metrics Integration
- [x] **P2.5-005**: Wire rate limiter statistics into MetricsSnapshot
  - [x] Rate limiter now tracks `totalHits` (blocked requests) and `totalChecks` (all checks)
  - [x] `getMetrics()` populates `security.blockedRequestsTotal` and `security.rateLimitHitsTotal` from live rate limiter counters
  - [x] Counters are monotonically increasing and survive cleanup cycles

#### Agent Brain (Memory/Knowledge/Skills)
- [x] **P2.5-006**: Separate Agent Brain from Soul system
  - [x] Create `packages/core/src/brain/` with `BrainStorage`, `BrainManager`, types, routes
  - [x] Memory system: episodic, semantic, procedural, preference memory types
  - [x] Knowledge base: topic-indexed entries with confidence scores and supersession tracking
  - [x] Move skills from Soul → Brain (skills are cognitive tools, not personality)
  - [x] SQLite `brain.db` with `memories`, `knowledge`, `skills`, `brain_meta` tables
  - [x] `BrainManager.getRelevantContext(input)` — retrieves relevant memories/knowledge for prompt injection
  - [x] Memory decay (importance decreases for unaccessed memories) + pruning (expired memories removed)
  - [x] Backward-compatible: existing `/api/v1/soul/skills/*` endpoints delegate to Brain
  - [x] REST API: `/api/v1/brain/memories`, `/api/v1/brain/knowledge`, `/api/v1/brain/stats`, `/api/v1/brain/maintenance`
  - [x] Config: `brain.enabled`, `brain.maxMemories`, `brain.memoryRetentionDays`, `brain.contextWindowMemories`
  - [x] `SoulManager` updated to compose prompt from Soul personality + Brain context + Brain skills
  - [x] `SoulManager` constructor accepts optional `BrainManager` — backward-compatible (works without Brain)
  - [x] 52 unit tests for BrainStorage and BrainManager (`brain.test.ts`)
#### Model Fallback on Rate Limits
- [x] **P2.5-008**: Configurable model fallback chain
  - [x] `FallbackModelConfig` schema with up to 5 fallback models
  - [x] AIClient automatically tries fallbacks on RateLimitError (429) or ProviderUnavailableError (502/503)
  - [x] Lazy fallback provider instantiation (not created until needed)
  - [x] Works for both streaming and non-streaming chat
  - [x] Audit logging: `ai_fallback_triggered`, `ai_fallback_attempt`, `ai_fallback_success`, `ai_fallback_exhausted`
  - [x] Config loader warns (non-blocking) on missing fallback API keys
  - [x] 11 unit tests (`client.test.ts` fallback describe block)

#### E2E Encrypted Agent Communication
- [x] **P2.5-007**: E2E encrypted inter-agent communication
  - [x] Create `packages/core/src/comms/` with `AgentCrypto`, `AgentComms`, `CommsStorage`, types, routes
  - [x] Agent keypair: X25519 (key exchange) + Ed25519 (signing), stored as JSON file (encrypted at rest planned)
  - [x] Message encryption: ephemeral ECDH → HKDF → AES-256-GCM per message
  - [x] Message signing: Ed25519 signature over ciphertext for sender authentication
  - [x] Secret sanitization: strip API keys, tokens, passwords from all payloads before sending
  - [x] Local message log: each agent stores its own messages in `comms.db`
  - [x] Peer management: register/discover other FRIDAY agents, store public keys (upsert support)
  - [x] Message types: `task_request`, `task_response`, `knowledge_share`, `status_update`, `coordination`
  - [x] REST API: `/api/v1/comms/identity`, `/api/v1/comms/peers`, `/api/v1/comms/message`, `/api/v1/comms/send`, `/api/v1/comms/log`
  - [x] Config: `comms.enabled` (default: false), `comms.maxPeers`, `comms.messageRetentionDays`
  - [x] No secrets exposed in any inter-agent message (enforced by sanitization + tests)
  - [x] 40 unit tests for AgentCrypto, sanitizePayload, CommsStorage, AgentComms (`comms.test.ts`)
---

## Phase 3: Dashboard

**Goal**: Build real-time monitoring dashboard with connection management.

**Duration**: 4-5 weeks

### Tasks

**Status**: ~98% complete. Full refactor done: App.tsx slimmed to routing-only (<30 lines), extracted DashboardLayout, StatusBar, NavigationTabs (memoized). ErrorBoundary wraps route content. ConfirmDialog replaces window.confirm(). Theme toggle (dark/light with localStorage persistence) working. Advanced task filtering (status + type). Responsive mobile layout with hamburger nav and stacked cards. Session timeout warning. All icon buttons have aria-labels. React Query optimized: global refetchInterval removed, per-query intervals set. ResourceMonitor accumulates real memory history. ConnectionManager fully interactive with connect forms, start/stop/delete controls, error retry, and relative time display. All 612 tests passing.

#### Project Setup
- [x] **P3-001**: Initialize React project
  - [x] Vite + React + TypeScript
  - [x] React Router (react-router-dom v7 with URL routing, deep-linking, back/forward)
  - [x] TanStack Query (server-state management with caching)
  - [x] Tailwind CSS
  - [ ] shadcn/ui components (using custom Tailwind components)

- [~] **P3-002**: Set up development environment
  - [x] Hot module replacement (Vite)
  - [x] API proxy for development (vite.config.ts proxy)
  - [ ] Mock data generators (hardcoded mock data in components)
  - [ ] Storybook for components

#### Core Infrastructure
- [x] **P3-003**: WebSocket client
  - [x] Connection management (`useWebSocket` hook)
  - [x] Auto-reconnection with backoff
  - [ ] Message queue for offline
  - [x] Subscription management (channel subscribe/unsubscribe)

- [x] **P3-004**: REST API client
  - [x] TanStack Query integration
  - [x] Base API client (`api/client.ts` with fetch wrapper)
  - [x] Error handling (basic)
  - [x] Auth token injection with Bearer header
  - [x] Automatic token refresh on 401
  - [ ] Caching strategy

- [~] **P3-005**: State management
  - [x] Auth state (AuthProvider with token management)
  - [x] Metrics state (TanStack Query with polling)
  - [ ] User preferences
  - [ ] Connection state

#### Components
- [x] **P3-006**: MetricsGraph component *(V1 — basic visualization)*
  - [x] ReactFlow integration
  - [x] Real-time node updates (via WebSocket)
  - [x] Custom node types (Task, Connection, Resource, Alert)
  - [x] Edge animations for data flow
  - [x] Zoom and pan controls
  - [ ] Node detail expansion

- [x] **P3-007**: TaskHistory component *(wired to live data)*
  - [x] Data table with sorting
  - [x] Advanced filtering (status + type filters with clear button)
  - [ ] Date range picker (deferred)
  - [x] Status badges
  - [x] Duration visualization
  - [ ] Export functionality (deferred)
  - [x] Responsive table (hidden columns on mobile)
  - *Wired to live data via authenticated API calls*

- [x] **P3-008**: SecurityEvents component *(wired to live data)*
  - [x] Event feed
  - [x] Severity-based styling
  - [ ] Event acknowledgment
  - [ ] Investigation workflow
  - [ ] Export and search
  - *Wired to live data via authenticated API calls*

- [x] **P3-009**: ConnectionManager component
  - [x] Platform cards with status
  - [x] Connect form with platform-specific fields (token, app token, webhook URL, secret)
  - [x] Credential input forms (inline form replaces card on click)
  - [x] Start/Stop controls on integration cards
  - [x] Delete integration with confirmation
  - [x] Error state with Retry button
  - [x] Relative time display for last message activity
  - [x] Loading states disable buttons during mutations
  - [x] All mutations invalidate queries for live updates
  - [ ] Test connection button (deferred)

- [x] **P3-010**: ResourceMonitor component *(V1 — real history)*
  - [x] CPU/Memory gauges
  - [x] Token usage display
  - [x] Cost tracking display
  - [x] Historical memory graph (real data accumulated via useRef, 30 data points max)
  - [ ] Alert thresholds (deferred)
  - [ ] Trend indicators (deferred)

- [x] **P3-011**: Header and navigation *(refactored)*
  - [x] Navigation menu (memoized NavigationTabs with URL routing — 7 tabs)
  - [x] Responsive hamburger menu on mobile (auto-closes on route change)
  - [x] Logout button (with aria-label)
  - [x] Theme toggle (dark/light with localStorage persistence)
  - [x] Session timeout warning banner
  - [x] StatusBar extracted with connection/WS indicators
  - [ ] User profile dropdown (deferred)
  - [ ] Notification bell (deferred)
  - [ ] Search bar (deferred)

- [~] **P3-012**: Settings pages
  - [x] Agent identity (name edit)
  - [x] API key management (create, list, revoke with ConfirmDialog and RBAC roles)
  - [x] Soul system config overview (enabled, learning mode, limits)
  - [x] Theme toggle (in header StatusBar, not settings page)
  - [ ] Security settings (RBAC defaults, rate limit config) (deferred)
  - [ ] Notification settings (deferred)
  - [ ] Log retention settings (deferred)

#### Soul/Personality UI *(NEW — not in original plan)*
- [x] **P3-015**: Onboarding wizard
  - [x] Agent name entry
  - [x] Personality creation (name, description, traits, system prompt)
  - [x] First-run detection via `/api/v1/soul/onboarding/status`
- [x] **P3-016**: Personality editor page
  - [x] List/create/edit/delete personalities
  - [x] Activate personality
  - [x] Prompt preview with token count
- [x] **P3-017**: Skills management page
  - [x] List skills with status/source filters
  - [x] Create/edit/delete skills
  - [x] Enable/disable toggle
  - [x] Approve/reject workflow for AI-proposed skills

#### Authentication UI
- [x] **P3-013**: Login page
  - [x] JWT-based login (password-only, admin auth)
  - [x] Persistent sessions via localStorage
  - [ ] Remember me toggle
  - [ ] Password reset flow
  - [ ] 2FA support (optional)

- [x] **P3-014**: Session management
  - [x] Token refresh (automatic on 401)
  - [x] Logout (API call + local state clear)
  - [x] Session timeout warning (useSessionTimeout hook, banner 5 min before expiry)

#### Code Quality *(NEW — from dashboard review)*
- [x] **P3-018**: Dashboard refactor and gap completion
  - [x] App.tsx slimmed to <30 lines (routing only)
  - [x] DashboardLayout, StatusBar, NavigationTabs extracted
  - [x] ErrorBoundary wrapping route content and MetricsGraph
  - [x] ConfirmDialog replacing window.confirm() in PersonalityEditor, SkillsManager, SettingsPage
  - [x] Skeleton components for loading states
  - [x] Global refetchInterval removed; per-query intervals set appropriately
  - [x] ResourceMonitor uses real accumulated history (useRef) instead of mock data
  - [x] All icon-only buttons have aria-labels
  - [x] Role="status" on live indicators
  - [x] Responsive: hamburger nav on mobile, stacked cards, hidden table columns

### Deliverables
- [x] Fully functional dashboard *(routing, auth, live data, theme, filters, responsive)*
- [x] Real-time metrics visualization
- [x] Task history browser *(live data + status/type filtering)*
- [x] Security event monitor *(live data via authenticated API)*
- [x] Connection management UI *(connect forms, start/stop/delete controls, live status)*
- [x] Soul/personality management pages
- [x] Responsive design (mobile hamburger nav, stacked cards, scrollable tables)

---

## Phase 4: Integrations

**Goal**: Connect to messaging platforms and external services.

**Duration**: 3-4 weeks

**Status**: P4-001, P4-002, and P4-003 (Telegram) complete. Remaining adapters (Discord, Slack, GitHub) moved to Phase 5 prompt (`future_prompts/PRODUCTION_PROMPT.md`).

### Tasks

#### Integration Framework
- [x] **P4-001**: Plugin architecture
  - [x] `Integration` interface: `init()`, `start()`, `stop()`, `sendMessage()`, `isHealthy()`
  - [x] `PlatformAdapter` interface: `normalizeInbound()`, `formatOutbound()`
  - [x] `IntegrationManager`: lifecycle management, factory registration, start/stop/restart
  - [x] `IntegrationStorage`: SQLite-backed config + message persistence
  - [x] Integration registry in `SecureYeoman` with health tracking
  - [x] `packages/core/src/integrations/` directory structure
  - [x] REST API routes: CRUD + start/stop + messages (Fastify)
  - [x] RBAC permission map for all integration endpoints
  - [x] 24 integration tests (storage, manager, message router)
  - [ ] Plugin loader with dynamic import (deferred — manual registration for now)
  - [ ] Zod-validated per-plugin config schema (deferred)

- [x] **P4-002**: Message abstraction
  - [x] `UnifiedMessage` type: text, sender, platform, channel, timestamp, attachments, replyTo, metadata
  - [x] `MessageAttachment` type: image, audio, video, file, location
  - [x] `PlatformAdapter` interface for normalizing inbound/outbound messages
  - [x] `MessageRouter`: routes inbound messages → TaskExecutor → response back to platform
  - [x] Message storage with pagination
  - [ ] Media handling (images, files, voice) with size limits (deferred to P4-003+)
  - [ ] Reply threading and context preservation (deferred to P4-003+)

#### Messaging Platforms
- [x] **P4-003**: Telegram integration
  - [x] `TelegramIntegration` class implementing `Integration` interface
  - [x] grammy Bot API with long-polling (webhook support deferred)
  - [x] Markdown message formatting (`parse_mode: 'Markdown'`)
  - [x] `/start`, `/help`, `/status` command handlers
  - [x] Inbound text message normalization to `UnifiedMessage`
  - [x] Factory registered in `SecureYeoman.initialize()`
  - [x] 23 unit tests (`telegram.test.ts`)
  - [ ] Inline keyboards for skill/personality selection (deferred)
  - [ ] Photo/document/voice attachment handling (deferred)

- [ ] **P4-004**: Discord integration
  - Discord.js v14 wrapper
  - Guild management and channel permissions
  - Slash command registration
  - Embed-based rich responses
  - Thread support for multi-turn conversations

- [ ] **P4-005**: Slack integration
  - Slack Bolt framework
  - Event subscriptions (message, app_mention)
  - Interactive messages (blocks, modals)
  - Slash commands (`/friday`, `/ask`)

- [ ] **P4-006**: WhatsApp integration (optional, deferred)
  - WhatsApp Business API or Baileys (web automation)
  - Template messages for notifications
  - Media handling

#### External Services
- [ ] **P4-007**: GitHub integration
  - GitHub App or personal access token
  - Webhook handler (push, PR, issue events)
  - API operations (create issue, comment on PR, merge)
  - PR review automation via AI
  - Code search and file browsing

- [ ] **P4-008**: Calendar integration (deferred)
  - Google Calendar API
  - Event creation/modification
  - Reminder scheduling

### Proposed Execution Order

```
P4-001 (Plugin framework) → P4-002 (Message abstraction) →
P4-003 (Telegram — simplest API) → P4-004 (Discord) → P4-005 (Slack) →
P4-007 (GitHub) → P4-006/P4-008 (optional/deferred)
```

### Deliverables
- [x] Plugin framework with lifecycle management (IntegrationManager, MessageRouter, IntegrationStorage)
- [x] Integration REST API with RBAC (CRUD, start/stop, messages)
- [x] Dashboard ConnectionManager with live platform status
- [ ] At least 2 messaging platform integrations (Telegram + Discord)
- [ ] GitHub integration
- [ ] Integration documentation and setup guides

---

## Phase 5: Production Hardening

**Goal**: Prepare for production deployment.

**Duration**: 2-3 weeks

**Status**: Partial. Docker packaging (P5-004) and CI/CD (P5-005) complete. Documentation partially done. Remaining items detailed in `future_prompts/PRODUCTION_PROMPT.md` and `future_prompts/TESTING_PROMPT.md`.

### Tasks

#### Testing
- [ ] **P5-001**: Load testing
  - k6 scripts for API endpoints (health, metrics, tasks, audit, soul)
  - Sustained load tests (100 req/s for 5 min)
  - Spike tests (0 → 1000 req/s)
  - WebSocket connection scaling (100+ concurrent clients)
  - Resource monitoring during tests

- [ ] **P5-002**: Security testing
  - `pnpm audit` — dependency vulnerability scan
  - SAST scanning (ESLint security plugin or Semgrep)
  - Injection testing (SQL, XSS, command, path traversal — validate InputValidator coverage)
  - JWT token manipulation testing
  - Rate limiter bypass testing
  - Sandbox escape testing (once V2 kernel enforcement lands)

- [ ] **P5-003**: Chaos testing
  - Database corruption recovery (SQLite WAL journal)
  - Process crash and restart (verify graceful shutdown + data integrity)
  - Resource exhaustion (memory limits, disk full)
  - Concurrent access stress test

#### Deployment
- [x] **P5-004**: Docker packaging
  - [x] Multi-stage Dockerfile (build: node:20-alpine + npm, runtime: alpine + production deps)
  - [x] Docker Compose with core + dashboard services
  - [x] Health check endpoint integration (wget to /health)
  - [x] Non-root user (friday:friday)
  - [x] Volume mounts for SQLite databases (`friday-data`)
  - [x] Environment variable configuration with placeholder defaults
  - [x] `.dockerignore` for minimal build context

- [x] **P5-005**: CI/CD pipeline
  - [x] GitHub Actions: lint → typecheck → test → build → security audit → docker build
  - [x] Automated test runs on PR (Node 20 + 22 matrix)
  - [x] Docker image build on push to main/tags (no registry push)
  - [x] Coverage artifact upload
  - [ ] Release notes generation from conventional commits (deferred)

- [~] **P5-006**: Documentation
  - [x] Installation guide (from source, Docker, npm) — `docs/installation.md`
  - [x] Configuration reference (all YAML fields, env vars, CLI flags) — `docs/configuration.md`
  - [x] API documentation (REST + WebSocket reference) — `docs/api.md`
  - [ ] OpenAPI/Swagger spec generation
  - [ ] Troubleshooting guide
  - [ ] Security best practices guide

#### Monitoring
- [ ] **P5-007**: Prometheus metrics
  - `/metrics` endpoint with Prometheus text format
  - Metric definitions: request_count, request_duration, task_count, token_usage, error_rate
  - Grafana dashboard JSON templates
  - Alert rules (error rate > 5%, memory > 80%, task queue depth > 50)

- [ ] **P5-008**: Logging aggregation
  - Pino structured JSON output (already done)
  - Log shipping configuration (stdout for Docker, file rotation for bare metal)
  - Example Loki/Elasticsearch config for log aggregation

### Deliverables
- [x] Production-ready Docker images
- [ ] Complete documentation
- [x] CI/CD pipeline
- [ ] Monitoring and alerting setup
- [ ] Security audit report

---

## Dashboard Component Specifications

### Component Hierarchy

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Footer.tsx
│   │   └── Layout.tsx
│   │
│   ├── metrics/
│   │   ├── MetricsGraph/
│   │   │   ├── index.tsx
│   │   │   ├── TaskNode.tsx
│   │   │   ├── ConnectionNode.tsx
│   │   │   ├── ResourceNode.tsx
│   │   │   ├── AlertNode.tsx
│   │   │   ├── DataFlowEdge.tsx
│   │   │   └── hooks/
│   │   │       ├── useGraphLayout.ts
│   │   │       └── useRealtimeUpdates.ts
│   │   │
│   │   ├── ResourceMonitor/
│   │   │   ├── index.tsx
│   │   │   ├── CPUGauge.tsx
│   │   │   ├── MemoryGauge.tsx
│   │   │   ├── TokenUsage.tsx
│   │   │   ├── CostTracker.tsx
│   │   │   └── HistoricalChart.tsx
│   │   │
│   │   └── MetricCard.tsx
│   │
│   ├── tasks/
│   │   ├── TaskHistory/
│   │   │   ├── index.tsx
│   │   │   ├── TaskTable.tsx
│   │   │   ├── TaskFilters.tsx
│   │   │   ├── TaskDetails.tsx
│   │   │   └── TaskExport.tsx
│   │   │
│   │   └── TaskStatus.tsx
│   │
│   ├── security/
│   │   ├── SecurityEvents/
│   │   │   ├── index.tsx
│   │   │   ├── EventFeed.tsx
│   │   │   ├── EventCard.tsx
│   │   │   ├── EventFilters.tsx
│   │   │   └── SeverityBadge.tsx
│   │   │
│   │   └── AuditLog/
│   │       ├── index.tsx
│   │       ├── AuditTable.tsx
│   │       └── ChainVerifier.tsx
│   │
│   ├── connections/
│   │   ├── ConnectionManager/
│   │   │   ├── index.tsx
│   │   │   ├── PlatformCard.tsx
│   │   │   ├── ConnectionWizard.tsx
│   │   │   ├── ConnectionStatus.tsx
│   │   │   └── TestConnection.tsx
│   │   │
│   │   └── platforms/
│   │       ├── TelegramConfig.tsx
│   │       ├── DiscordConfig.tsx
│   │       ├── SlackConfig.tsx
│   │       └── GenericConfig.tsx
│   │
│   ├── settings/
│   │   ├── GeneralSettings.tsx
│   │   ├── SecuritySettings.tsx
│   │   ├── NotificationSettings.tsx
│   │   └── ApiKeyManager.tsx
│   │
│   └── common/
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── Modal.tsx
│       ├── Table.tsx
│       ├── DatePicker.tsx
│       ├── SearchInput.tsx
│       └── LoadingSpinner.tsx
│
├── hooks/
│   ├── useWebSocket.ts
│   ├── useMetrics.ts
│   ├── useTasks.ts
│   ├── useAuth.ts
│   └── useTheme.ts
│
├── api/
│   ├── client.ts
│   ├── websocket.ts
│   ├── tasks.ts
│   ├── metrics.ts
│   ├── security.ts
│   └── connections.ts
│
├── stores/
│   ├── metricsStore.ts
│   ├── taskStore.ts
│   └── connectionStore.ts
│
├── routes/
│   ├── index.tsx
│   ├── dashboard.tsx
│   ├── tasks.tsx
│   ├── security.tsx
│   ├── connections.tsx
│   └── settings.tsx
│
├── types/
│   ├── task.ts
│   ├── metrics.ts
│   ├── security.ts
│   └── connection.ts
│
└── utils/
    ├── formatters.ts
    ├── validators.ts
    └── constants.ts
```

### Wireframe Descriptions

#### Dashboard Home (Main View)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Logo] F.R.I.D.A.Yeoman Dashboard           [Search] [Bell] [User ▼]    │
├────────┬────────────────────────────────────────────────────────────┤
│        │                                                            │
│ [Home] │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│        │  │ Tasks Today  │ │ Token Usage  │ │ Active Conn  │       │
│ [Tasks]│  │    47        │ │   125,432    │ │      5       │       │
│        │  │  ▲ 12%       │ │  $2.34       │ │   ● healthy  │       │
│ [Sec]  │  └──────────────┘ └──────────────┘ └──────────────┘       │
│        │                                                            │
│ [Conn] │  ┌────────────────────────────────────────────────────┐   │
│        │  │                                                    │   │
│ [Set]  │  │              METRICS GRAPH (ReactFlow)             │   │
│        │  │                                                    │   │
│        │  │    [Task]──>[Task]──>[Task]                       │   │
│        │  │       │                 │                          │   │
│        │  │       ▼                 ▼                          │   │
│        │  │   [Resource]       [Connection]                    │   │
│        │  │                                                    │   │
│        │  └────────────────────────────────────────────────────┘   │
│        │                                                            │
│        │  ┌─────────────────────┐ ┌─────────────────────────────┐  │
│        │  │  Recent Security    │ │  Resource Usage             │  │
│        │  │  ─────────────────  │ │  ─────────────────          │  │
│        │  │  ⚠ Rate limit hit   │ │  CPU: [████░░░░░] 45%       │  │
│        │  │  ✓ Auth success     │ │  Mem: [██████░░░] 62%       │  │
│        │  │  ⚠ Injection det    │ │  Disk: [███░░░░░░] 28%      │  │
│        │  └─────────────────────┘ └─────────────────────────────┘  │
│        │                                                            │
└────────┴────────────────────────────────────────────────────────────┘
```

#### Task History View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Task History                                        [Export ▼]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Filters: [Status ▼] [Type ▼] [Date Range] [Search...        ]    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ID       │ Status    │ Type     │ Duration │ Tokens │ Time   │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ abc123   │ ● Success │ Execute  │ 1.2s     │ 450    │ 2m ago │  │
│  │ def456   │ ● Success │ Query    │ 0.8s     │ 230    │ 5m ago │  │
│  │ ghi789   │ ● Failed  │ Execute  │ 30.0s    │ 1200   │ 8m ago │  │
│  │ jkl012   │ ● Success │ File     │ 0.3s     │ 120    │ 12m ago│  │
│  │ mno345   │ ● Timeout │ Network  │ 60.0s    │ 890    │ 15m ago│  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Showing 1-50 of 1,234 tasks           [< Prev] [1] [2] [3] [Next >]│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### Connection Manager View

```
┌─────────────────────────────────────────────────────────────────────┐
│  Connection Manager                            [+ Add Connection]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │
│  │    Telegram     │ │     Discord     │ │      Slack      │       │
│  │    [Logo]       │ │    [Logo]       │ │    [Logo]       │       │
│  │                 │ │                 │ │                 │       │
│  │  ● Connected    │ │  ○ Disconnected │ │  ● Connected    │       │
│  │                 │ │                 │ │                 │       │
│  │  Messages: 1.2k │ │  Messages: 0    │ │  Messages: 456  │       │
│  │  Last: 2m ago   │ │  Last: Never    │ │  Last: 5m ago   │       │
│  │                 │ │                 │ │                 │       │
│  │ [Test] [Config] │ │    [Connect]    │ │ [Test] [Config] │       │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘       │
│                                                                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐       │
│  │    WhatsApp     │ │     Matrix      │ │     GitHub      │       │
│  │    [Logo]       │ │    [Logo]       │ │    [Logo]       │       │
│  │                 │ │                 │ │                 │       │
│  │  ○ Not Setup    │ │  ○ Not Setup    │ │  ● Connected    │       │
│  │                 │ │                 │ │                 │       │
│  │                 │ │                 │ │  Repos: 12      │       │
│  │                 │ │                 │ │  Webhooks: 3    │       │
│  │                 │ │                 │ │                 │       │
│  │    [Setup]      │ │    [Setup]      │ │ [Test] [Config] │       │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoint Specifications

### REST Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | Health check | No |
| GET | `/api/v1/tasks` | List tasks | Yes |
| POST | `/api/v1/tasks` | Create task | Yes |
| GET | `/api/v1/tasks/:id` | Get task details | Yes |
| DELETE | `/api/v1/tasks/:id` | Cancel task | Yes |
| GET | `/api/v1/metrics` | Get metrics | Yes |
| GET | `/api/v1/metrics/history` | Get historical metrics | Yes |
| GET | `/api/v1/audit` | Get audit logs | Yes (Auditor+) |
| POST | `/api/v1/audit/verify` | Verify audit chain | Yes (Auditor+) |
| GET | `/api/v1/integrations/platforms` | List registered platforms | Yes |
| GET | `/api/v1/integrations` | List integrations | Yes |
| POST | `/api/v1/integrations` | Create integration | Yes (Operator+) |
| GET | `/api/v1/integrations/:id` | Get integration details | Yes |
| PUT | `/api/v1/integrations/:id` | Update integration | Yes (Operator+) |
| DELETE | `/api/v1/integrations/:id` | Delete integration | Yes (Operator+) |
| POST | `/api/v1/integrations/:id/start` | Start integration | Yes (Operator+) |
| POST | `/api/v1/integrations/:id/stop` | Stop integration | Yes (Operator+) |
| GET | `/api/v1/integrations/:id/messages` | List messages | Yes |
| POST | `/api/v1/integrations/:id/messages` | Send message | Yes (Operator+) |
| GET | `/api/v1/security/events` | Get security events | Yes (Auditor+) |
| POST | `/api/v1/auth/login` | Login | No |
| POST | `/api/v1/auth/refresh` | Refresh token | Yes |
| POST | `/api/v1/auth/logout` | Logout | Yes |
| GET | `/api/v1/users/me` | Get current user | Yes |
| GET | `/api/v1/soul/personality` | Get active personality | Yes |
| GET | `/api/v1/soul/personalities` | List all personalities | Yes |
| POST | `/api/v1/soul/personalities` | Create personality | Yes (Operator+) |
| PUT | `/api/v1/soul/personalities/:id` | Update personality | Yes (Operator+) |
| DELETE | `/api/v1/soul/personalities/:id` | Delete personality | Yes (Operator+) |
| POST | `/api/v1/soul/personalities/:id/activate` | Set active personality | Yes (Operator+) |
| GET | `/api/v1/soul/skills` | List skills | Yes |
| POST | `/api/v1/soul/skills` | Create skill | Yes (Operator+) |
| PUT | `/api/v1/soul/skills/:id` | Update skill | Yes (Operator+) |
| DELETE | `/api/v1/soul/skills/:id` | Delete skill | Yes (Operator+) |
| POST | `/api/v1/soul/skills/:id/enable` | Enable skill | Yes (Operator+) |
| POST | `/api/v1/soul/skills/:id/disable` | Disable skill | Yes (Operator+) |
| POST | `/api/v1/soul/skills/:id/approve` | Approve proposed skill | Yes (Operator+) |
| POST | `/api/v1/soul/skills/:id/reject` | Reject proposed skill | Yes (Operator+) |
| GET | `/api/v1/soul/prompt/preview` | Preview composed prompt | Yes |
| GET | `/api/v1/soul/config` | Get soul config | Yes |
| GET | `/api/v1/soul/onboarding/status` | Check onboarding status | Yes |
| POST | `/api/v1/soul/onboarding/complete` | Complete onboarding | Yes (Operator+) |
| GET | `/api/v1/brain/memories` | Query memories | Yes |
| POST | `/api/v1/brain/memories` | Create memory | Yes (Operator+) |
| DELETE | `/api/v1/brain/memories/:id` | Delete memory | Yes (Operator+) |
| GET | `/api/v1/brain/knowledge` | Query knowledge | Yes |
| POST | `/api/v1/brain/knowledge` | Add knowledge entry | Yes (Operator+) |
| GET | `/api/v1/brain/stats` | Brain statistics | Yes |
| POST | `/api/v1/brain/maintenance` | Trigger decay/prune | Yes (Admin) |
| GET | `/api/v1/comms/identity` | This agent's public identity | Yes |
| GET | `/api/v1/comms/peers` | List known peers | Yes |
| POST | `/api/v1/comms/peers` | Add peer | Yes (Admin) |
| DELETE | `/api/v1/comms/peers/:id` | Remove peer | Yes (Admin) |
| POST | `/api/v1/comms/message` | Receive encrypted message | Yes |
| POST | `/api/v1/comms/send` | Send message to peer | Yes (Operator+) |
| GET | `/api/v1/comms/log` | View local message log | Yes |

### WebSocket Channels

| Channel | Description | Events |
|---------|-------------|--------|
| `metrics` | Real-time resource metrics | `update` |
| `tasks` | Task lifecycle events | `created`, `started`, `completed`, `failed` |
| `security` | Security events | `auth`, `rate_limit`, `injection`, `anomaly` |
| `connections` | Connection status | `connected`, `disconnected`, `error` |
| `system` | System health | `health`, `alert` |

---

## Data Models

### TypeScript Interfaces

```typescript
// Task
interface Task {
  id: string;
  type: TaskType;
  status: TaskStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: TaskError;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  duration_ms?: number;
  resources: ResourceUsage;
  security_context: SecurityContext;
}

type TaskType = "execute" | "query" | "file" | "network" | "system";
type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";

// Metrics
interface Metrics {
  tasks: TaskMetrics;
  resources: ResourceMetrics;
  security: SecurityMetrics;
  timestamp: Date;
}

interface TaskMetrics {
  total: number;
  by_status: Record<TaskStatus, number>;
  by_type: Record<TaskType, number>;
  success_rate: number;
  avg_duration_ms: number;
  p95_duration_ms: number;
}

interface ResourceMetrics {
  cpu_percent: number;
  memory_used_mb: number;
  memory_limit_mb: number;
  tokens_used: number;
  tokens_limit: number;
  cost_usd: number;
}

// Integration (see packages/shared/src/types/integration.ts)
interface IntegrationConfig {
  id: string;
  platform: Platform;
  displayName: string;
  enabled: boolean;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  connectedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

type Platform = "telegram" | "discord" | "slack" | "cli" | "webhook";
type IntegrationStatus = "connected" | "disconnected" | "error" | "configuring";

// Security Event
interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: Severity;
  message: string;
  details: Record<string, unknown>;
  user_id?: string;
  ip_address?: string;
  timestamp: Date;
  acknowledged: boolean;
}

type SecurityEventType = "auth_success" | "auth_failure" | "rate_limit" | "injection" | "permission_denied" | "anomaly";
type Severity = "info" | "warn" | "error" | "critical";
```

---

## Technical Considerations

### Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Backend Runtime | Node.js 20 LTS | TypeScript support, async performance |
| Backend Framework | Fastify | Performance, schema validation |
| Frontend Framework | React 18 | Component ecosystem, concurrent features |
| Build Tool | Vite | Fast HMR, modern bundling |
| State Management | TanStack Query | Cache management, real-time updates |
| Routing | react-router-dom v7 | URL routing with NavLink |
| UI Components | shadcn/ui | Customizable, accessible |
| Styling | Tailwind CSS | Utility-first, consistent |
| Graph Visualization | ReactFlow | Interactive node graphs |
| Database | SQLite (local) | Zero-config, portable |
| Database (optional) | PostgreSQL | Scalability for multi-user |
| Testing | Vitest | Fast, Vite-native |
| E2E Testing | Playwright | Cross-browser |

### Architecture Decisions

1. **Monorepo vs Polyrepo**
   - Recommendation: Monorepo with pnpm workspaces
   - Packages: `core`, `dashboard`, `plugins`
   - Shared types between backend and frontend

2. **Database Choice**
   - SQLite for single-user local deployment
   - PostgreSQL adapter for enterprise/multi-user
   - Abstract storage layer for flexibility

3. **Real-time Strategy**
   - WebSocket for real-time updates
   - SSE as fallback
   - Long-polling for firewall-restricted environments

4. **Authentication Strategy**
   - JWT for API authentication
   - Refresh token rotation
   - Session storage in HttpOnly cookies

---

## Security Considerations

### Threat Model

| Threat | Mitigation | Priority |
|--------|------------|----------|
| Prompt injection | Input validation, instruction hierarchy | Critical |
| Sandbox escape | seccomp, Landlock, resource limits | Critical |
| Token theft | Encrypted storage, short expiry | High |
| Audit tampering | Cryptographic chain, append-only | High |
| DDoS | Rate limiting, connection limits | Medium |
| XSS | CSP headers, output encoding | Medium |
| CSRF | SameSite cookies, CSRF tokens | Medium |

### Security Checklist

- [ ] All secrets encrypted at rest
- [ ] TLS 1.3 for all connections
- [ ] Input validation on all endpoints
- [ ] Rate limiting implemented
- [ ] RBAC enforced on all routes
- [ ] Audit logging for security events
- [ ] CSP headers configured
- [ ] Dependency audit passing
- [ ] No secrets in logs
- [ ] Sandbox escape tests passing

### Compliance Considerations

| Standard | Relevance | Notes |
|----------|-----------|-------|
| SOC 2 | High | Audit logging, access controls |
| GDPR | Medium | Data retention, right to delete |
| HIPAA | Low (unless healthcare) | Encryption, audit trails |
| PCI DSS | Low (unless payment) | N/A for most use cases |

---

## Performance Considerations

### Benchmarks to Target

| Metric | Target | Measurement |
|--------|--------|-------------|
| API Response Time (p95) | < 100ms | k6 load test |
| WebSocket Latency | < 50ms | Custom benchmark |
| Dashboard Load Time | < 2s | Lighthouse |
| Task Throughput | > 100/min | Stress test |
| Memory Usage (idle) | < 200MB | Process monitoring |
| Memory Usage (peak) | < 1GB | Stress test |

### Optimization Strategies

1. **API Performance**
   - Connection pooling for database
   - Response caching with ETag
   - Query optimization with EXPLAIN

2. **Frontend Performance**
   - Code splitting by route
   - Lazy loading of components
   - Virtual scrolling for large lists
   - Memoization of expensive calculations

3. **WebSocket Performance**
   - Message batching
   - Compression (permessage-deflate)
   - Connection multiplexing

---

## Future Enhancements

### v1.1 (Post-MVP)

- [x] **Multi-agent orchestration**: E2E encrypted inter-agent communication (P2.5-007)
- [ ] **MCP protocol support**: Model Context Protocol integration
- [ ] **Skill marketplace**: Browse and install community skills
- [ ] **Custom dashboards**: User-configurable dashboard layouts
- [ ] **Webhooks**: Outbound webhooks for events
- [x] **CLI tool**: Command-line interface (P2.5-001)

### v1.2

- [ ] **Team workspaces**: Multi-user collaboration
- [ ] **Audit report generator**: Compliance report export
- [ ] **Cost optimization**: Token usage recommendations
- [ ] **A/B testing**: Model comparison experiments
- [ ] **Custom models**: Local model support (Ollama, LM Studio)

### v2.0 (Future Vision)

- [ ] **Distributed deployment**: Kubernetes-native
- [x] **Federation**: Cross-instance E2E encrypted messaging (P2.5-007)
- [ ] **ML-based anomaly detection**: Advanced threat detection
- [ ] **Voice interface**: Speech-to-text interaction
- [ ] **Mobile app**: Native iOS/Android dashboard

---

## Research Required

### Areas Needing Investigation

1. **Sandbox Technologies**
   - Compare seccomp vs eBPF for syscall filtering
   - Evaluate gVisor for containerized sandboxing
   - Research WASM isolation for plugin execution

2. **Encryption Libraries**
   - Compare libsodium vs WebCrypto vs Node.js crypto
   - Evaluate age vs GPG for file encryption
   - Research hardware security module integration

3. **Graph Visualization**
   - Benchmark ReactFlow vs D3.js vs Cytoscape
   - Evaluate WebGL rendering for large graphs
   - Research layout algorithms (Dagre, ELK)

4. **Real-time Infrastructure**
   - Compare WebSocket libraries (ws, socket.io, uWebSockets)
   - Evaluate Redis pub/sub vs direct WebSocket
   - Research CRDT for collaborative editing

---

## Dependencies

### Core Dependencies (Installed)

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.3",
    "@google/generative-ai": "^0.24.1",
    "openai": "^6.19.0",
    "fastify": "^5.7.4",
    "@fastify/websocket": "^10.0.1",
    "zod": "^3.23.8",
    "better-sqlite3": "^11.1.2",
    "pino": "^9.3.2",
    "pino-pretty": "^11.2.2",
    "uuid": "^10.0.0",
    "yaml": "^2.5.0"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^4.0.18",
    "eslint": "^9.39.2",
    "prettier": "^3.8.1"
  }
}
```

### Dashboard Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-query": "^5.28.0",
    "react-router-dom": "^7.0.0",
    "reactflow": "^11.10.0",
    "tailwindcss": "^3.4.0",
    "lucide-react": "^0.460.0"
  }
}
```

---

## Quick Start Commands

```bash
# Clone and setup
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
pnpm install

# Development
pnpm dev           # Start all services
pnpm dev:core      # Start core agent only
pnpm dev:dash      # Start dashboard only

# Testing
pnpm test          # Run all tests
pnpm test:unit     # Unit tests only
pnpm test:e2e      # E2E tests only
pnpm test:security # Security audit

# Build
pnpm build         # Build all packages
pnpm build:docker  # Build Docker images

# Production
pnpm start         # Start production server
```

---

## Contributors

Want to contribute? Check out our [Contributing Guide](CONTRIBUTING.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

*Last updated: February 2026*
