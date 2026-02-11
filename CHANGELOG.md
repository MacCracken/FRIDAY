# Changelog

All notable changes to F.R.I.D.A.Y. are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## Phase Pre-MVP: Performance Optimization

### Improved
- **Frontend code splitting** — Lazy-loaded 8 route components (`MetricsGraph`, `TaskHistory`, `SecurityEvents`, `ResourceMonitor`, `PersonalityEditor`, `SkillsManager`, `ConnectionManager`, `SettingsPage`) via `React.lazy()` + `Suspense`; ReactFlow (~200KB) + Recharts (~100KB) only load when visited
- **Vite build optimization** — Manual chunks for `react-vendor`, `query-vendor`, `chart-vendor`; disabled production sourcemaps
- **Response compression** — Added `@fastify/compress` for gzip/brotli on all JSON and text responses
- **Metrics broadcast throttling** — Reduced interval from 1s to 5s (matches dashboard polling), skip when no subscribers, cache unchanged payloads
- **Batch memory touch (N+1 fix)** — `touchMemories(ids[])` replaces per-item `touchMemory()` loop in `recall()` and `getRelevantContext()`
- **Consolidated task stats** — `getStats()` reduced from 4 SQL queries to 2 using a single aggregation query
- **Database indexes** — Added `idx_user_id` on `audit_entries(user_id)` and `idx_memories_type_importance` on `memories(type, importance DESC)`

---

## Phase 5: Production Hardening

### Added
- **Load testing** — k6 scripts for API endpoints, auth flow, WebSocket, and task creation (sustained 50 VUs, spike to 200, stress 500)
- **Security testing** — injection (SQL, XSS, command, path traversal), JWT manipulation, rate limit bypass, RBAC enforcement, audit integrity (63 tests across security + chaos)
- **Chaos testing** — database corruption recovery, crash/restart, resource exhaustion (13 tests)
- **Docker packaging** — multi-stage Dockerfile, Docker Compose, non-root `friday` user, health checks, volume mounts
- **CI/CD pipeline** — GitHub Actions: lint, typecheck, test, build, security audit, Docker build (Node 20 + 22 matrix)
- **Prometheus metrics** — `/metrics` endpoint, metric definitions (tasks, resources, security), Grafana dashboard, alert rules
- **Logging aggregation** — append-only JSONL file writer, log rotation with gzip, Loki + Promtail + Grafana + Prometheus compose
- **Documentation** — installation guide, configuration reference, API docs, OpenAPI 3.1 spec, troubleshooting guide, deployment guide, integration guide, security testing guide

---

## Phase 4: Integrations

### Added
- **Integration framework** — `Integration` interface, `IntegrationManager`, `IntegrationStorage`, factory pattern, `MessageRouter`
- **Message abstraction** — `UnifiedMessage`, `MessageAttachment`, `PlatformAdapter`, message storage with pagination
- **Telegram adapter** — grammy bot API, long-polling, `/start`/`help`/`status` commands, Markdown formatting (23 tests)
- **Discord adapter** — discord.js v14, slash commands (`/ask`, `/status`, `/help`), embed responses, `messageCreate` handler (19 tests)
- **Slack adapter** — Slack Bolt, socket mode, event subscriptions (`message`, `app_mention`), slash commands (`/friday`, `/friday-status`) (18 tests)
- **GitHub adapter** — Octokit REST + webhooks, push/PR/issue/comment events, HMAC-SHA256 signature verification, comment posting (17 tests)
- **Conversation management** — per-platform conversation context, auto-reconnect, per-platform rate limiting
- **Integration REST API** — CRUD, start/stop, messages with RBAC (24 integration tests)
- **Dashboard ConnectionManager** — connect forms, start/stop/delete controls, error retry, live platform status

---

## Phase 3: Dashboard

### Added
- **React dashboard** — Vite + React + TypeScript, react-router-dom v7 with URL routing
- **TanStack Query** — server-state management with caching and per-query polling
- **WebSocket client** — `useWebSocket` hook with auto-reconnection and channel subscriptions
- **MetricsGraph** — ReactFlow with custom node types (Task, Connection, Resource, Alert), real-time updates
- **TaskHistory** — data table with sorting, status + type filters, live data via authenticated API
- **SecurityEvents** — event feed with severity-based styling, live data
- **ConnectionManager** — platform cards, connect forms, start/stop/delete, error retry, relative time display
- **ResourceMonitor** — CPU/Memory gauges, token/cost tracking, real accumulated history (30 data points)
- **Soul/Personality UI** — onboarding wizard, personality editor (CRUD + activate + prompt preview), skills manager (CRUD + enable/disable + approve/reject)
- **Login page** — JWT auth, persistent sessions, automatic token refresh on 401
- **Session management** — `useSessionTimeout` hook, warning banner 5 min before expiry
- **Dashboard refactor** — App.tsx slimmed, DashboardLayout/StatusBar/NavigationTabs extracted, ErrorBoundary, ConfirmDialog, skeleton loading states
- **Responsive design** — hamburger nav on mobile, stacked cards, hidden table columns
- **Theme toggle** — dark/light with localStorage persistence
- **Settings page** — agent identity, API key management, soul config overview
- **Dashboard tests** — 57 component tests across 5 files (Vitest + Testing Library + jsdom)

---

## Phase 2.5: Core Infrastructure Gaps

### Added
- **CLI entry point** — `--port`, `--host`, `--config`, `--log-level`, `--tls` flags, graceful shutdown, startup banner
- **Task persistence** — SQLite `tasks` table with indexes, `TaskStorage` class (store, update, get, list, stats), 15 tests
- **Task gateway wiring** — `GET /api/v1/tasks` with filters, `GET /api/v1/tasks/:id`, `getMetrics()` from storage
- **Security events API** — `GET /api/v1/security/events` with type, severity, time-range, pagination filters
- **Rate limit metrics** — `totalHits` and `totalChecks` counters, wired into `MetricsSnapshot`
- **Brain system** — `BrainStorage`, `BrainManager`, episodic/semantic/procedural/preference memory types, knowledge base with confidence tracking, memory decay and pruning, skills moved from Soul to Brain, REST API endpoints, 52 tests
- **E2E encrypted comms** — X25519 key exchange + Ed25519 signing + AES-256-GCM, peer management, message types (task_request, task_response, knowledge_share, status_update, coordination), secret sanitization, REST API, 40 tests
- **Model fallback chain** — configurable fallback on 429/502/503, lazy provider instantiation, streaming + non-streaming support, audit logging, 11 tests

---

## Phase 2: Security Layer

### Added
- **RBAC** — role definitions (Admin, Operator, Auditor, Viewer), permission matrix with wildcards, LRU caching, role inheritance, persistent SQLite storage, 58 tests
- **JWT authentication** — token generation/validation (jose), refresh token rotation, blacklisting, session management, Fastify `onRequest` hook, 44 tests
- **API key authentication** — key generation, SQLite storage, rate limiting per key, revocation
- **RBAC gateway middleware** — per-route permission enforcement, role extraction from JWT/API key, 15 tests
- **Encryption at rest** — AES-256-GCM, scrypt KDF, `SecretStore` with encrypted file persistence, memory clearing
- **System keyring** — macOS Keychain, Linux Secret Service, environment variable fallback, auto-detection, 21 tests
- **Secret rotation** — SQLite metadata, auto-rotation for internal secrets, dual-key JWT verification, multi-key audit chain, `onRotate` callbacks, 23 tests
- **Input validation** — size limits, encoding normalization, injection detection (SQL, XSS, command, path traversal, template), 31 tests
- **Prompt injection defense** — 6 pattern families, blocking + warning modes, audit logging
- **Rate limiting** — sliding window counters, per-user/IP/API-key/global, configurable rules, `log_only` mode, 13 tests
- **Redis rate limiter** — sorted-set sliding window, fail-open, factory auto-selection, 12 tests
- **Soul system** — personality + skills, Zod schemas, SQLite storage, `SoulManager`, prompt composition, tool collection, skill approval workflow, 18 REST endpoints, 71 tests
- **Linux sandbox** — V1 soft sandbox + V2 Landlock kernel enforcement via forked worker, 37 + 7 tests
- **macOS sandbox** — `sandbox-exec` profile generation, deny-default policy, 10 tests
- **Cross-platform sandbox** — `Sandbox` interface, `SandboxManager`, `NoopSandbox` fallback
- **mTLS** — TLS in Fastify, client certificate auth (CN extraction), cert generation utility, `--tls` CLI flag, 9 tests
- **Security audit** — code audit and refactoring pass (noop logger, JSON.parse guards, queue race fix, bodyLimit, IP check, error handling)

---

## Phase 1: Foundation

### Added
- **Project structure** — TypeScript monorepo with npm workspaces (`core`, `dashboard`, `shared`), strict mode, ESLint, Prettier, Vitest
- **Configuration management** — YAML config parser, environment variable loading, Zod validation
- **Agent loop** — task queue (FIFO with max concurrent limit), event-driven architecture, graceful shutdown, health check endpoint
- **Multi-provider AI** — Anthropic SDK (tool calling + streaming), OpenAI GPT (gpt-4o, o1, o3-mini), Google Gemini (2.0-flash, 1.5-pro), Ollama (fetch-based), unified `AIClient` orchestrator, token counting, cost calculation, usage tracking, exponential backoff retry with jitter
- **Structured logging** — UUID v7 generation, JSON format, correlation ID propagation, input/output hashing
- **SQLite audit storage** — WAL mode, query/filter/pagination, full-text search (FTS5), 27 tests
- **Append-only log writer** — JSONL format with `O_APPEND`
- **Log rotation** — size/age-based rotation with gzip compression
- **Audit chain** — HMAC-SHA256 signing, integrity verification, genesis block, fork handling (snapshot recovery)
- **Log query API** — `GET /api/v1/audit` with time-range, level, event, userId, taskId, limit, offset filters
- **Unit tests** — config (24), crypto (40), RBAC (31), AI client (10), AI providers (23), cost calculator (8), usage tracker (6), retry manager (15), SQLite storage (27), task executor (12), audit chain (19), input validator (31), rate limiter (13), logger (16)
- **Integration tests** — E2E auth flow, gateway API, audit trail (32 tests across 3 files)

---

*Last updated: February 2026*
