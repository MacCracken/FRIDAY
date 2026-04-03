# Rust Migration Findings — Priority 0 Audit

> **Date**: 2026-04-03
> **Baseline**: Tag `2026.3.19` (last known working state)
> **Scope**: 77 commits from `2026.3.19` to `257ba268` (HEAD)
> **Verdict**: Migration structurally sound but security-incomplete. Middleware layer gutted. 59 dashboard endpoints missing. Production hardening absent.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Baseline: What Worked at 2026.3.19](#baseline-what-worked-at-20263-19)
3. [What Happened: The 77-Commit Migration](#what-happened-the-77-commit-migration)
4. [Critical Gap: Middleware Layer](#critical-gap-middleware-layer)
5. [Missing Dashboard Endpoints (59)](#missing-dashboard-endpoints-59)
6. [Response Shape Mismatches](#response-shape-mismatches)
7. [Rust Backend Quality Assessment](#rust-backend-quality-assessment)
8. [Effectively Stubbed Code](#effectively-stubbed-code)
9. [Recommended Repair Plan](#recommended-repair-plan)
10. [Repair Phase Definitions](#repair-phase-definitions)

---

## Executive Summary

The TS→Rust migration replaced a Fastify backend with an axum backend in ~9 days across 77 commits. The Rust codebase is surprisingly complete (944 routes, 70 DB modules, 54K lines), compiles clean, and has real business logic for core domains (auth, chat, brain/RAG, orchestration, agents). However:

1. **The middleware security stack was not migrated.** The TS backend had 16 layered middleware hooks. The Rust backend implements 5. Missing: rate limiting, RBAC enforcement, body size limits, IP reputation, request fingerprinting, backpressure, ownership guards, local network checks.

2. **59 dashboard API endpoints have no Rust handler.** Features like community marketplace, document ingestion, brain sync, risk dashboard, intent detection, sandbox management, and onboarding are silently broken.

3. **Response shape mismatches** cause metrics widgets to show zeroes, chat to lose token/brain context display, and security counters to be empty.

4. **CORS is wide open** (`Allow-Origin: *`, `Allow-Methods: *`, `Allow-Headers: *`).

5. **No Rust-side integration or E2E tests exist.** Unit tests cover crypto/audit/privacy crates only.

The TS codebase (`packages/core/src/`) was **not deleted** — all 1,726 files remain. The Dockerfile simply no longer builds or runs Node.js.

---

## Baseline: What Worked at 2026.3.19

### Architecture

- **Framework**: Fastify v5.7.4
- **Entry point**: `SecureYeoman` class (service locator/DI container) in `packages/core/src/secureyeoman.ts` (~92KB)
- **Server**: `GatewayServer` in `packages/core/src/gateway/server.ts` (~160KB)
- **Pattern**: Manager pattern — each domain has Storage (DB), Manager (logic), Routes (HTTP)
- **Graceful degradation**: Routes wrapped in `tryRegister()` — optional managers don't crash startup

### Middleware Chain (16 Fastify `onRequest` hooks, in order)

| # | Hook | Purpose |
|---|------|---------|
| 1 | OpenTelemetry plugin | Distributed tracing + `X-Trace-Id` |
| 2 | IPv6 normalization | Strip `::ffff:` prefix |
| 3 | **Backpressure** | Load shedding before expensive work |
| 4 | **Request fingerprinting** | Bot detection via header ordering |
| 5 | **IP reputation** | Block IPs with bad history |
| 6 | Compression | gzip/brotli |
| 7 | Multipart | Avatar uploads, 2MB limit |
| 8 | WebSocket | 1MB max payload |
| 9 | **Local network check** | Reject non-private IPs unless `allowRemoteAccess` |
| 10 | Correlation ID | UUIDv7 per request via `AsyncLocalStorage` |
| 11 | **Security headers** | CSP with per-request nonce, HSTS, X-Frame-Options |
| 12 | CORS | Configurable origin allowlists |
| 13 | **Body size limits** | 4 tiers: default 1MB, auth 16KB, upload 10MB, chat 512KB |
| 14 | **Rate limiting** | Global per-IP + adaptive tied to system pressure |
| 15 | **Auth** | JWT Bearer / API key / mTLS client cert |
| 16 | **RBAC** | Convention-based permission resolution + deny-by-default |

Post-response hooks: IP reputation recording, request logging, low-rate attack detection.

### Route Scale

- **113 route files** across 55+ domain modules
- Domains: auth, OAuth, SSO, SAML, SCIM, chat, models, agents, swarms, teams, councils, brain, soul, spirit, security (12 sub-domains), integrations (21 platforms), training, marketplace, workflow, MCP, federation, edge, sandbox, compliance, observability, plus more

### Storage

- PostgreSQL via `pg` (primary)
- SQLite via `better-sqlite3` (audit chain)
- Redis via `ioredis` (rate limiter, caching)
- SQL migrations in `storage/migrations/`

### Rust Crates at Baseline (8 crates, v0.1.0)

`sy-crypto`, `sy-hwprobe`, `sy-tee`, `sy-privacy`, `sy-audit`, `sy-sandbox`, `sy-edge`, `sy-napi`

All were **support crates** — the TS backend was the application, Rust provided native acceleration via NAPI bridge.

---

## What Happened: The 77-Commit Migration

### Timeline (9 days, March 26 – April 3)

| Phase | Dates | Commits | What Happened |
|-------|-------|---------|---------------|
| Bootstrap | Mar 26 | 12 | sy-core crate created, bhava integration started. Thrashing ("fixing stuff", "something", "fixing majra" ×3) |
| Crate wiring | Mar 26-27 | 6 | Dependencies updated, NAPI bridge adjusted, ecosystem crates integrated |
| **Route blitz** | **Mar 28-31** | **~40** | 85 Rust route modules + 70 DB modules written. Commit messages: "more routes" ×10+. ~40K lines of Rust in 4 days |
| **Rip-out** | Apr 1 | 2 | `2529a258` deleted sy-napi + native bindings. `068a0011` made Dockerfile Rust-only. Node.js removed from runtime |
| Scramble | Apr 1-3 | 7 | "fixing admin", "fixing dashboard", "fixing tls", "fixing security toggles", "fixing dashboard chat", "working out bugs" |

### The Critical "Ripping Out" (commit `2529a258`)

- Deleted entire `sy-napi` crate (10 files, ~3,600 lines)
- Gutted TS native bindings in `packages/core/src/native/` to stubs
- Deleted `native-parity.test.ts` (the test that verified TS↔Rust parity)
- 39 minutes later, `068a0011` removed Node.js from Docker image entirely

### What the Manager Layer Lost

The TS codebase had rich manager classes with business logic, validation, event emission, and cross-domain coordination. The Rust routes **bypass the manager pattern** — most route handlers query the DB directly via `db::` modules. Business logic that lived in managers was either:
- Inlined into route handlers
- Partially moved to `orchestration/` (agent coordination only)
- Dropped

---

## Critical Gap: Middleware Layer

### Current Rust Middleware (5 of 16)

| Rust Layer | Status |
|-----------|--------|
| TraceLayer (tower-http) | Implemented |
| CompressionLayer (gzip) | Implemented |
| CorrelationIdLayer (custom) | Implemented — UUIDv7, X-Correlation-ID |
| SecurityHeadersLayer (custom) | Implemented — X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy |
| CorsLayer (tower-http) | Implemented — **but wide open: `Any` origin/methods/headers** |
| Auth middleware (from_fn) | Implemented — JWT Bearer + X-API-Key with public route bypass |

### Missing Middleware (11 of 16) — SECURITY-CRITICAL

| Missing Layer | Risk | TS Reference |
|--------------|------|-------------|
| **Rate limiting** | DoS, brute-force | `rate-limiter.ts`, `adaptive-rate-limiter.ts` |
| **RBAC enforcement** | Privilege escalation | `rbac.ts`, `route-permissions.ts` |
| **Body size limits** | Memory exhaustion | `body-limit.ts` (4 tiers) |
| **IP reputation** | Known-bad IP access | `ip-reputation.ts` |
| **Request fingerprinting** | Bot access | `request-fingerprint.ts` |
| **Backpressure** | Cascade failure | `backpressure.ts` |
| **Ownership guards** | Cross-user data access | In route handlers |
| **Local network check** | Remote access control | In gateway hooks |
| **CORS restrictions** | CSRF, data exfiltration | Allowlist-based in TS |
| **IPv6 normalization** | IP bypass tricks | Gateway hook |
| **Multipart handling** | Upload size limits | `@fastify/multipart` config |

The Rust `server.rs` contains a comment: *"Stubs for Phase 7.1: backpressure, fingerprinting, IP reputation, body limits, rate limiting, auth, RBAC."* These were acknowledged but never built.

---

## Missing Dashboard Endpoints (59)

### Critical — Core Dashboard Functionality

| Endpoint | Feature | Impact |
|----------|---------|--------|
| `GET/PUT /api/v1/soul/agent-name` | Agent naming | Cannot rename agent |
| `POST /api/v1/soul/onboarding/complete` | Onboarding | First-run flow broken |
| `POST /api/v1/soul/personalities/clear-default` | Personality mgmt | Cannot reset default |
| `GET /api/v1/soul/personality` | Active personality | Shortcut endpoint missing |
| `GET /api/v1/soul/strategies` | Reasoning strategies | Strategy selection broken |
| `POST /api/v1/brain/documents/ingest-text` | Document ingestion | Cannot ingest text docs |
| `POST /api/v1/brain/documents/ingest-url` | URL ingestion | Cannot ingest from URL |
| `POST /api/v1/brain/reindex` | Brain reindex | Cannot rebuild index |
| `GET/PUT /api/v1/brain/sync/config` | Brain sync | Sync config missing |
| `POST /api/v1/brain/sync` | Brain sync | Cannot trigger sync |
| `GET/PUT /api/v1/model/config` | Model config | Cannot configure models |
| `GET/POST /api/v1/intent` | Intent detection | Intent system broken |
| `GET /api/v1/intent/active` | Active intent | Intent display broken |
| `GET/PUT /api/v1/users/me/notification-prefs` | Notifications | Cannot manage prefs |

### Secondary — Feature Pages

| Endpoint | Feature |
|----------|---------|
| `GET /api/v1/marketplace/community/personalities` | Community marketplace browse |
| `POST /api/v1/marketplace/community/personalities/install` | Community personality install |
| `GET /api/v1/marketplace/community/status` | Community sync status |
| `GET /api/v1/a2a/capabilities` | A2A agent capabilities |
| `GET/PUT /api/v1/a2a/config` | A2A configuration |
| `POST /api/v1/a2a/delegate` | A2A delegation |
| `GET /api/v1/a2a/discover` | A2A discovery |
| `GET /api/v1/risk/departments` | Risk departments |
| `GET /api/v1/risk/feeds` | Risk data feeds |
| `GET /api/v1/risk/findings` | Risk findings |
| `GET /api/v1/risk/heatmap` | Risk heatmap visualization |
| `GET /api/v1/risk/register` | Risk register |
| `GET /api/v1/risk/summary` | Risk summary |
| `GET /api/v1/sandbox/capabilities` | Sandbox capabilities |
| `GET /api/v1/sandbox/health` | Sandbox health |
| `GET/PUT /api/v1/sandbox/policy` | Sandbox policy |
| `GET /api/v1/sandbox/threats` | Sandbox threats |
| `GET /api/v1/training/computer-use/episodes` | Computer-use training |
| `GET /api/v1/training/curated-datasets` | Training datasets |
| `GET /api/v1/webhooks/timeline` | Webhook timeline |
| `POST /api/v1/federation/personalities/import` | Federation personality import |
| `POST /api/v1/conversations/replay-batch` | Conversation replay |

*(Full list: 59 endpoints — additional ones in notification, capture-consent, edge, and diagnostic domains)*

---

## Response Shape Mismatches

### Metrics (`/api/v1/metrics`)

The Rust backend returns a slimmed-down metrics object. Dashboard receives zeroes for:

**Resources**: `tokensCachedToday`, `costUsdToday`, `costUsdMonth`, `apiCallsTotal`, `apiErrorsTotal`, `apiLatencyAvgMs`, `tokensLimitDaily`, `diskLimitMb`

**Security**: `authAttemptsTotal`, `authSuccessTotal`, `authFailuresTotal`, `activeSessions`, `permissionChecksTotal`, `permissionDenialsTotal`, `blockedRequestsTotal`, `rateLimitHitsTotal`, `eventsBySeverity`

The dashboard has a try/catch fallback that returns zero-filled defaults, so no crash — just empty widgets.

### Chat (`/api/v1/chat` and `/api/v1/chat/stream`)

Rust returns: `{ content, model, provider }`
Dashboard expects: `{ content, model, provider, tokensUsed, brainContext, conversationId, creationEvents, thinkingContent, ... }`

Missing fields are optional → no crash, but:
- Token usage display is blank
- Brain context sidebar is empty
- Thinking content (chain-of-thought) is invisible

### SSE Stream Events

Dashboard `useChatStream` parses: `thinking_delta`, `content_delta`, `tool_start`, `tool_result`, `mcp_tool_start`, `mcp_tool_result`, `creation_event`, `done`, `error`

The Rust streaming handler reads **the entire LLM response body before emitting SSE events** — defeating the purpose of streaming. This was not how the TS version worked.

### Security Events

Dashboard client has an explicit adapter at line 474 remapping: `e.event`→`type`, `e.level`→`severity`, `e.metadata.userId`, `e.metadata.ip`. This indicates the Rust backend returns a different shape than the TS backend for audit/security events.

---

## Rust Backend Quality Assessment

### What's Real and Solid

| Component | Assessment |
|-----------|-----------|
| **Auth system** (JWT + middleware) | Genuinely good. HS256, rotation support, public route bypass |
| **sy-crypto** | Proper primitives, 40+ tests |
| **sy-audit** | Tamper-evident HMAC chain, 20 tests |
| **sy-privacy** | Working PII scanner, 25+ tests |
| **Brain module** | Sophisticated — hybrid search, ACT-R activation scoring, embedding providers |
| **Orchestration** | Swarm/council/workflow engines with real logic |
| **Integration clients** | 8 typed HTTP clients (GitHub, Jira, Linear, Notion, Todoist, Gmail, GCal, Twitter) |
| **DB layer** | 70 modules with real SQL, proper schema namespacing |
| **WebSocket** | 3 endpoints: metrics pub-sub, CRDT collab, video |
| **Compilation** | Clean build, 5 minor warnings only |

### What's Concerning

| Issue | Detail |
|-------|--------|
| **No integration tests** | Unit tests only in crypto/audit/privacy crates. Zero route/handler tests |
| **No E2E tests** | TS E2E suite exists but doesn't run against Rust backend |
| **CORS wide open** | `Allow-Origin: *` — production-fatal |
| **API key validation is a no-op** | `validate_api_key()` always returns `None` |
| **JTI revocation not implemented** | Tokens cannot be revoked after issue |
| **Chat streaming is fake** | Reads full response then emits events — not true streaming |
| **Vector store is in-memory** | Lost on restart — no persistent backend |
| **Secrets via unsafe `set_var`** | Loads DB secrets into env vars at startup |
| **Version mismatch** | Cargo.toml says 0.1.0, CLAUDE.md says "starting from 0.5.0" |
| **944 routes, no RBAC** | Massive attack surface with no permission enforcement |

---

## Effectively Stubbed Code

These are implemented but functionally no-ops despite not being marked `todo!()`:

| Code | Issue |
|------|-------|
| `validate_api_key()` | Always returns `None` |
| Terminal routes | Return `{"stub": true}` |
| `run_consolidation` | Returns `NO_CONTENT` immediately |
| Chat streaming | Not actually streaming (buffered) |
| RBAC in auth | Roles defined but never enforced on routes |
| Proxy fallback (`proxy.rs`) | Returns 404 — no Fastify to proxy to |

---

## Recommended Repair Plan

### Guiding Principles

1. **Security middleware first.** No feature work until the middleware stack is restored. This is a security product.
2. **One layer at a time, fully tested.** Each middleware must have integration tests before moving to the next.
3. **Dashboard parity second.** Missing endpoints and shape mismatches after middleware is solid.
4. **No more ad-hoc "fixing" commits.** Each repair phase gets a branch, tests, review, then merge.

### Phase Order

| Phase | Name | Priority | Effort | Blocks |
|-------|------|----------|--------|--------|
| R-1 | ~~**CORS lockdown**~~ | P0-immediate | Small | Everything | **DONE** |
| R-2 | ~~**Rate limiting**~~ | P0 | Medium | R-1 | **DONE** (3 tiers, 11 tests) |
| R-3 | ~~**RBAC enforcement**~~ | P0 | Large | R-1 | **DONE** (15 tests, 5 roles) |
| R-4 | ~~**Body size limits**~~ | P0 | Small | R-1 | **DONE** (4 tiers, 12 tests) |
| R-5 | **Backpressure + IP reputation** | P1 | Medium | R-2 |
| R-6 | **Ownership guards** | P1 | Large | R-3 |
| R-7 | **Local network check** | P1 | Small | R-1 |
| R-8 | **Request fingerprinting** | P2 | Medium | R-5 |
| R-9 | **Fix chat streaming** | P1 | Medium | — |
| R-10 | **Dashboard endpoint gap-fill** | P1 | Large | R-3 |
| R-11 | **Response shape alignment** | P1 | Medium | R-10 |
| R-12 | ~~**Integration test harness**~~ | P0 | Medium | R-1 | **DONE** (lib.rs + 8 tests) |
| R-13 | **API key validation** | P1 | Small | R-3 |
| R-14 | **Token revocation (JTI)** | P2 | Medium | R-3 |
| R-15 | **Persistent vector store** | P2 | Medium | — |
| R-16 | ~~**Version alignment**~~ | P0-immediate | Trivial | — | **DONE** (0.5.0) |

---

## Repair Phase Definitions

### R-1: CORS Lockdown (P0-immediate)

**Problem**: `CorsLayer` allows `Any` origin, `Any` methods, `Any` headers.

**Fix**: Read allowed origins from config (env var or TOML). Default to `http://localhost:5173` (Vite dev) + configured dashboard URL. Restrict methods to `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Restrict headers to `Authorization, Content-Type, X-API-Key, X-Correlation-ID`.

**Test**: Integration test confirming disallowed origins get no `Access-Control-Allow-Origin` header.

### R-2: Rate Limiting (P0)

**Problem**: No rate limiting. Every endpoint is unlimited.

**Fix**: Implement tower middleware with sliding-window per-IP counter. Use in-memory store (dashmap) with optional Redis backend. Tiers: auth endpoints (5/min), chat (30/min), general (120/min). Return `429 Too Many Requests` with `Retry-After` header.

**Reference**: TS `rate-limiter.ts`, `adaptive-rate-limiter.ts`

**Test**: Integration tests for rate limiting thresholds and header responses.

### R-3: RBAC Enforcement (P0)

**Problem**: Roles exist in the auth system (admin, operator, auditor, viewer, service) but are never checked on route access. Every authenticated user can access every endpoint.

**Fix**: Port the TS convention-based permission resolution: URL prefix → resource, HTTP method → action. Implement as a tower middleware layer that runs after auth. Deny-by-default for unmapped routes.

**Reference**: TS `rbac.ts`, `route-permissions.ts`

**Test**: Integration tests for each role accessing allowed/denied endpoints.

### R-4: Body Size Limits (P0)

**Problem**: No request body size limits beyond the reverse proxy's 10MB default.

**Fix**: Tower middleware with per-route-prefix limits. Tiers: auth (16KB), chat (512KB), upload (10MB), default (1MB). Return `413 Payload Too Large`.

**Reference**: TS `body-limit.ts`

**Test**: Integration tests sending oversized bodies to each tier.

### R-5: Backpressure + IP Reputation (P1)

**Problem**: No load shedding under pressure. No IP reputation tracking.

**Fix**:
- Backpressure: Monitor in-flight request count. Shed load with `503 Service Unavailable` when above threshold.
- IP reputation: Track 401/429 signals per IP. Block IPs exceeding thresholds. Configurable decay.

**Reference**: TS `backpressure.ts`, `ip-reputation.ts`

### R-6: Ownership Guards (P1)

**Problem**: Authenticated users can access other users' resources if they know the ID.

**Fix**: Middleware or per-handler check that `resource.user_id == auth.user_id` (or `resource.tenant_id == auth.tenant_id`). Must cover conversations, memories, personalities, settings, agent profiles.

**Test**: Integration test: User A creates resource, User B attempts access → 403.

### R-7: Local Network Check (P1)

**Problem**: No restriction on non-local network access (relevant for local-first deployment).

**Fix**: Check `X-Forwarded-For` / peer address against private IP ranges. Reject unless `allowRemoteAccess` config is set.

**Reference**: TS gateway hook

### R-8: Request Fingerprinting (P2)

**Problem**: No bot detection layer.

**Fix**: Hash request header ordering and UA patterns. Feed into IP reputation scoring.

**Reference**: TS `request-fingerprint.ts`

### R-9: Fix Chat Streaming (P1)

**Problem**: The SSE streaming handler reads the **entire** LLM response body before emitting events. This is not streaming — it's buffered-then-flushed.

**Fix**: Use `reqwest::Response::bytes_stream()` or chunked transfer decoding to emit SSE events as LLM tokens arrive. Each chunk parses into the event types the dashboard expects (`thinking_delta`, `content_delta`, `tool_start`, `tool_result`, `done`).

**Test**: Integration test confirming first SSE event arrives before full response completes.

### R-10: Dashboard Endpoint Gap-Fill (P1)

**Problem**: 59 endpoints the dashboard calls have no Rust handler.

**Fix**: Implement in priority order:
1. **Core UX** (14 endpoints): soul/agent-name, onboarding, personality management, brain document ingestion, brain sync, model config, intent, notification prefs
2. **Feature pages** (25 endpoints): community marketplace, A2A, risk dashboard, sandbox, training datasets, webhook timeline, federation import
3. **Remaining** (20 endpoints): edge cases, replay, diagnostics

Each endpoint must match the TS response shape exactly.

### R-11: Response Shape Alignment (P1)

**Problem**: Existing endpoints return incomplete data vs what the dashboard expects.

**Fix**: Audit each Rust handler's `serde_json::json!({...})` response against the dashboard's TypeScript types. Add missing fields. Priority:
1. `/api/v1/metrics` — fill all resource/security counters
2. `/api/v1/chat` and `/api/v1/chat/stream` — add `tokensUsed`, `brainContext`, `thinkingContent`, `creationEvents`
3. Security events — align shape with dashboard adapter expectations

### R-12: Integration Test Harness (P0)

**Problem**: Zero route/handler tests. Only crate-level unit tests.

**Fix**: Set up `axum::test` or `tower::ServiceExt` based test harness. Spin up test DB with migrations. Write tests for auth flow, RBAC, rate limiting, and core CRUD routes. Run in CI.

### R-13 through R-16

Smaller items — API key validation, JTI revocation, persistent vector store, version alignment. Defined above in the phase table. Each is straightforward once the foundation (R-1 through R-6) is solid.

---

## Appendix: Files of Interest

| File | Purpose |
|------|---------|
| `crates/sy-core/src/server.rs` | Router build + middleware stack — primary repair target |
| `crates/sy-core/src/middleware/` | Current middleware implementations |
| `crates/sy-core/src/routes/` | All 85 route modules |
| `crates/sy-core/src/db/` | All 70 DB modules |
| `crates/sy-core/src/main.rs` | Server startup, DB init, seeding |
| `packages/core/src/gateway/server.ts` | TS middleware reference (the gold standard) |
| `packages/core/src/gateway/auth-middleware.ts` | TS auth reference |
| `packages/core/src/security/rbac.ts` | TS RBAC reference |
| `packages/core/src/security/rate-limiter.ts` | TS rate limiter reference |
| `packages/dashboard/src/api/client.ts` | Dashboard API client — endpoint inventory |
| `packages/dashboard/src/types.ts` | Dashboard type definitions — response shape contracts |
