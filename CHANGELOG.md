# Changelog

All notable changes to F.R.I.D.A.Y. are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.3.0] — 2026-02-12

### Coding IDE View
- **Code editor page** — New `/code` route with Monaco editor (65% width) + embedded chat sidebar (35%); language auto-detect from filename extension; editor theme follows dashboard dark/light mode
- **Personality-scoped chat** — Sidebar personality selector (dropdown populated from existing personalities); selected personality scopes the chat system prompt locally without changing the global active personality
- **Send to Chat / Insert at Cursor** — Toolbar button sends selected editor text (or full buffer) as a code block to the chat sidebar; assistant messages include "Insert at Cursor" to inject code-fenced content back into the editor
- **Shared chat hook** — Extracted `useChat()` hook from `ChatPage.tsx` for reuse across Chat and Code pages; accepts optional `personalityId` for personality-scoped conversations

### Voice Interface
- **Speech-to-text** — Browser-native `SpeechRecognition` API with auto-restart loop for hands-free input; transcript feeds into chat input field
- **Text-to-speech** — Browser-native `speechSynthesis` reads assistant responses aloud when voice is enabled
- **Voice toggle button** — `VoiceToggle.tsx` component with listening (pulsing ring), speaking (pulse), and unsupported (disabled) states; available in both `/chat` and `/code` pages
- **Voice persistence** — `voiceEnabled` stored in `localStorage` key `friday-voice-enabled`; graceful fallback when browser lacks speech APIs

### In Our Image: The Sacred Hierarchy of Life
- **Sacred Archetypes** — Cosmological foundation (No-Thing-Ness → The One → The Plurality) baked into Soul prompt composition; every AI prompt now begins with the archetypal preamble grounding the "In Our Image" hierarchy
- **Heartbeat moved to Body** — `HeartbeatManager` relocated from `brain/` to `body/`, making Body the owner of the agent's vital signs; Brain retains memory/knowledge, Body now owns periodic self-checks (system health, memory status, log anomalies, integration health)

### Added
- **OpenCode Zen provider** — 5th AI provider using OpenCode.ai's OpenAI-compatible gateway (`https://opencode.ai/zen/v1`); supports GPT 5.2, Claude Sonnet 4.5, Claude Haiku 4.5, Gemini 3 Flash, Qwen3 Coder, and Big Pickle (free); pricing, cost calculator entries, dashboard label, and unit tests included
- **Provider-aware model selector** — Dashboard model widget only shows providers with configured API keys; `getAvailableModels(onlyAvailable)` filters by env var presence

### Dashboard
- **Sidebar restructure** — User profile moved into sidebar with theme toggle and sign out; connection/live status indicators at sidebar bottom; refresh button beside title
- **Header cleanup** — Notification bell and search bar centered in header with improved spacing

---

## [1.2.0] — 2026-02-12

### Dashboard Enhancements
- **Collapsible sidebar navigation** — Left-side panel replacing top tabs with collapsible sections (Tasks, Brain, Connections, Settings, Reports, Experiments, Marketplace); toggle button, responsive mobile layout
- **New dashboard pages** — Reports page (audit report generator with JSON/HTML/CSV export), Experiments page (A/B test management with variant comparison charts), Marketplace page (skill discovery with search, categories, install/uninstall)

### MCP Protocol Support
- **McpClientManager** — Connects to external MCP servers, discovers tools/resources, makes them available to F.R.I.D.A.Y.'s AI workflows
- **McpServer** — Exposes F.R.I.D.A.Y.'s skills as MCP tools and knowledge as MCP resources via JSON-RPC 2.0 endpoint
- **MCP REST API** — `/api/v1/mcp/` endpoints for CRUD, start/stop, list-tools, list-resources with RBAC enforcement
- **MCP configuration** — `mcp.enabled`, `mcp.serverPort`, `mcp.exposeSkillsAsTools`, `mcp.exposeKnowledgeAsResources` in config schema
- **SQLite storage** — `mcp_servers` table for server configurations

### Audit & Reports
- **Audit report generator** — Generate comprehensive audit reports with filters (time range, event type, user, severity); export to JSON, HTML, or CSV
- **Cost optimization recommendations** — Analyze usage patterns and suggest model/config changes to reduce costs
- **Reports REST API** — `/api/v1/reports/` endpoints for generating and exporting audit reports

### Team Collaboration
- **Team workspaces** — Workspace isolation with `WorkspaceManager` for multi-team deployments; distinct personalities, skills, knowledge per workspace
- **Workspace membership** — Member management with workspace-level roles (workspace_admin, workspace_member, workspace_viewer)
- **Workspace REST API** — `/api/v1/workspaces/` for CRUD, `/api/v1/workspaces/:id/members` for membership
- **SQLite storage** — `workspaces` and `workspace_members` tables with foreign key constraints
- **Dashboard workspace switcher** — Workspace selector in header, workspace settings page

### A/B Testing Framework
- **Experiment management** — Create experiments with multiple variants (control + treatments), traffic allocation, duration
- **Variant routing** — Automatic traffic routing based on hash(userId), metric collection (latency, cost, success rate)
- **Experiments REST API** — `/api/v1/experiments/` for CRUD, `/api/v1/experiments/:id/results` for aggregated stats with p-values
- **SQLite storage** — `experiments`, `experiment_variants`, `experiment_metrics` tables

### Skill Marketplace
- **Marketplace** — Public registry of published skills with metadata (name, description, author, downloads, ratings)
- **Skill operations** — Search, install (copy to local Brain), uninstall, publish (upload approved skills)
- **Marketplace REST API** — `/api/v1/marketplace/` for search/install/uninstall, `/api/v1/marketplace/publish` for publishing
- **Skill packaging** — JSON export with Ed25519 signature verification to prevent malicious injection
- **SQLite storage** — `marketplace_skills` and `marketplace_installs` tables
- **Moderation workflow** — Admin-only skill approval (pending → approved → published)

### Custom Dashboards
- **Dashboard customization** — Create custom dashboards with drag-and-drop widget placement
- **Widget library** — Metrics graphs, task history, security events, resource monitors, custom charts
- **Dashboard persistence** — Save/load custom layouts per user in SQLite

### Security & API
- **Route permission enforcement** — All new API endpoints (MCP, Reports, Experiments, Marketplace, Workspaces) enforce RBAC permissions
- **Workspace-scoped RBAC** — Extended permission model with workspace-level roles alongside global roles

---

## [1.0.1] — 2026-02-11

### In Our Image: The Sacred Hierarchy of Life

Adds the **Spirit** module — the agent's emotional core (passions, inspirations, pain points) — and establishes the sacred hierarchy: **Soul > Spirit > Brain > Body**.

### Added
- **Spirit module** (`packages/core/src/spirit/`) — Full CRUD for passions, inspirations, and pains with SQLite-backed storage, manager, and REST API endpoints
- **Spirit prompt composition** — `composeSpiritPrompt()` builds a Spirit section that is injected into the Soul prompt between personality and brain context
- **Spirit REST API** — 15 endpoints under `/api/v1/spirit/` for passions, inspirations, pains, config, stats, and prompt preview
- **Spirit schemas** — `SpiritConfigSchema`, `PassionSchema`, `InspirationSchema`, `PainSchema` with Create/Update variants in shared types
- **Body module** (`packages/core/src/body/`) — Owns the agent's vital signs (Heartbeat) with `BodyConfigSchema` for v2/v3 physical interfaces
- **In Our Image** — Soul > Spirit > Brain > Body sacred hierarchy with Spirit integrated into prompt composition pipeline
- **Spirit test suite** — Full coverage for storage, manager, and composition (40+ tests)

### Changed
- **SoulManager** now accepts optional `SpiritManager` and injects Spirit prompt section into `composeSoulPrompt()`
- **SecureYeoman** initializes Spirit between Brain and Soul (init order: Brain → Spirit → Soul)
- **Gateway server** registers Spirit routes alongside Soul and Brain routes
- **Config schema** now includes `spirit` and `body` sections

---

## [1.0.0] — 2026-02-11

### MVP Release

F.R.I.D.A.Y. v1.0.0 marks the first stable release of the **Fully Responsive Integrated Digitally Adaptable Yeoman** — a secure, local-first AI assistant with enterprise-grade protection and comprehensive observability.

**Highlights:**

- **5 development phases complete** — Foundation, Security, Infrastructure, Dashboard, Integrations, and Production Hardening
- **Enterprise security** — RBAC, JWT/API key auth, AES-256-GCM encryption, sandboxed execution, 2FA (TOTP), audit trails with cryptographic integrity
- **Multi-provider AI** — Anthropic Claude, OpenAI GPT, Google Gemini, and Ollama with model fallback chains
- **React dashboard** — Real-time monitoring, task management, personality editor, skills manager, security events, responsive design
- **Platform integrations** — Telegram, Discord, Slack, and GitHub with plugin architecture
- **Production ready** — Docker packaging, CI/CD pipeline, Prometheus/Grafana observability, load/security/chaos testing
- **1000+ tests** across 59+ files with >80% coverage thresholds
- **0 npm vulnerabilities**

All features from the pre-release development phases below are included in this release.

---

## Security Hardening & Production Features

### Added
- **Audit log retention** — `enforceRetention()` on SQLiteAuditStorage with age-based (`maxAgeDays`) and count-based (`maxEntries`) purging; configurable via `security.audit.retentionDays` and `maxEntries` in shared config schema (4 tests)
- **Password reset** — `POST /api/v1/auth/reset-password` endpoint; validates current password, enforces 32-char minimum, rotates token secret to invalidate all sessions, audit logged (4 tests)
- **Remember me toggle** — extended JWT expiry (30-day access / 60-day refresh) when `rememberMe: true`; login checkbox with localStorage persistence on dashboard (2 tests)
- **Encrypted config files** — `.enc.yaml` detection, `encryptConfigFile()` / `decryptConfigFile()` using AES-256-GCM, auto-discovery of encrypted variants in `loadConfig()` (4 tests)
- **Plugin loader** — `PluginLoader` class scanning directories for integration plugins; validates `platform` + `createIntegration` exports; supports `.js`, `.mjs`, and directory plugins (5 tests)
- **Zod plugin config** — `configSchema` on `Integration` interface; `IntegrationManager.registerPlatform()` accepts optional schema; `createIntegration()` validates config with descriptive errors (4 tests)
- **2FA (TOTP)** — RFC 6238 implementation using Node.js crypto; setup/verify flow, ±1 step clock drift tolerance, 8 recovery codes, `otpauth://` URI builder; login returns `requiresTwoFactor` when enabled (16 tests)
- **Reply threading** — thread-scoped conversation context via `threadId` in `ConversationManager`; independent context per thread with stale thread expiry (3 tests)
- **Media handling** — `MediaHandler` class with size limit enforcement, temp file management, content scanner hook, base64 and URL download support (7 tests)
- **Release notes** — `scripts/generate-release-notes.ts` conventional commit parser with type grouping and contributor list; `npm run release-notes` script (7 tests)
- **seccomp-bpf** — syscall allow/block lists, kernel seccomp mode detection via `/proc/PID/status`, `isSyscallAllowed()` classifier (6 tests)
- **Namespace isolation** — `unshare`-based PID/network/mount namespace isolation, capability detection, `runInNamespace()` with graceful fallback on non-Linux (6 tests)

### Improved
- **Core test coverage** — 918 tests passing (up from ~850), 1000+ total with dashboard

---

## Dashboard Polish & Deferred Features

### Added
- **Search bar** — `SearchBar.tsx` with global search across tasks and security events, debounced input (300ms), category-grouped dropdown results, `Ctrl+K`/`Cmd+K` keyboard shortcut, integrated into DashboardLayout header
- **Date range picker** — TaskHistory now supports time-based filtering with presets (Last hour, Last 24h, Last 7 days, All time) plus custom date inputs; filters persisted in URL search params for shareability; `from`/`to` query parameters wired to API
- **Export functionality** — TaskHistory CSV and JSON export buttons; client-side generation respecting all active filters (status, type, date range); browser download via `Blob` + `URL.createObjectURL`
- **User profile dropdown** — Replaced plain logout/theme buttons in `StatusBar` with a dropdown menu showing username/role (parsed from JWT), theme toggle, and sign out; click-outside dismiss handler
- **Notification bell** — `NotificationBell.tsx` subscribing to WebSocket `security` and `tasks` channels; unread count badge; dropdown with recent notifications; mark as read on click; clear all; read state persisted in `localStorage`
- **User preferences** — `usePreferences.tsx` React context + hook with `localStorage` persistence; typed schema for theme, default filters, refresh interval, notification preferences, table page size
- **Security settings page** — `SecuritySettings.tsx` at `/security-settings` route displaying RBAC roles/permissions (from `GET /auth/roles`), rate limiting stats, audit chain status/verification; navigation tab added
- **Notification settings** — `NotificationSettings.tsx` with toggles for enable/disable, sound on/off, and per-event-type checkboxes; integrated into SettingsPage
- **Log retention settings** — `LogRetentionSettings.tsx` showing total audit entries, DB size estimate, oldest entry; display-only retention policy config; integrated into SettingsPage
- **WebSocket message queue** — `useWebSocket.ts` enhanced with offline message buffering (max 100), automatic channel re-subscription on reconnect, `reconnecting` state; "Reconnecting..." banner in DashboardLayout
- **Event acknowledgment** — SecurityEvents now supports per-event Acknowledge button and Acknowledge All; investigation panel with full event metadata on click; acknowledged state persisted in `localStorage`
- **API client extensions** — `fetchTasks` now supports `from`/`to` date params; added `fetchRoles()` and `fetchAuditStats()` endpoints

### Improved
- **Dashboard test coverage** — 82 tests across 9 test files (up from 57 across 5 files); new test files for SearchBar, NotificationBell, NotificationSettings, SecuritySettings
- **Security** — Added HTML prompt injection protection to v1.1 roadmap (DOMPurify sanitization for user/LLM-generated content)

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

*Last updated: February 12, 2026*
