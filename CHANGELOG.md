# Changelog

All notable changes to F.R.I.D.A.Y. are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.5.1] — 2026-02-14

### Documentation & Maintenance
- **Version alignment** — All packages, source references, Dashboard UI, OpenAPI spec, and security policy updated to 1.5.1
- **OpenAPI platform coverage** — Added `googlechat`, `cli`, and `webhook` platforms to integration endpoint schemas (were missing since v1.4.0)
- **Security policy update** — Supported versions table now reflects current release train (1.5.x supported, 1.4.x security-only)
- **ADR count correction** — README now correctly references 31 ADRs (was 28)
- **Documentation audit** — Removed obsolete planning documents (dashboard-create-task, personality-action-capabilities, voice-listening-capabilities) superseded by implemented features and ADRs; removed redundant proactive-heartbeat guide (covered by ADR 018); cleaned up stale TODO and roadmap references
- **Roadmap update** — Test coverage table updated to reflect current 1700+ tests across 115+ files
- **TODO cleanup** — Project status updated from v1.3.3 to v1.5.1; removed completed v1.4 future items

### Tests
- 1700+ tests across 115+ test files

---

## [1.5.0] — 2026-02-13

### Marketplace
- **Universal Script Assistant** — New builtin marketplace skill: elite script consultant and developmental editor with four operational modes (Brainstorm, Architect, Draft, Roast), standard screenplay formatting, and subtext-driven dialogue guidance
- **Marketplace auth fix** — Dashboard Marketplace page was using wrong localStorage key (`friday_token` instead of `accessToken`) for API auth, causing all marketplace API calls to fail silently with 401; switched to shared `request()` function with correct auth handling and automatic token refresh
- **Marketplace API client** — Added `fetchMarketplaceSkills`, `installMarketplaceSkill`, and `uninstallMarketplaceSkill` functions to the shared dashboard API client
- **Type alignment** — `MarketplaceSkill.tools` now uses `ToolSchema` (matching `SkillCreate.tools`) instead of `Record<string, unknown>[]`; `createSkill` call wrapped with `SkillCreateSchema.parse()` to apply Zod defaults for required fields

### MCP
- **Robust tool restore on toggle** — Added `McpClientManager.restoreTools()` method that loads tools from SQLite without checking `server.enabled`, eliminating a potential race between DB update and read-back; PATCH toggle route now uses `restoreTools()` instead of `discoverTools()` on re-enable
- **Toggle response includes tools** — PATCH `/api/v1/mcp/servers/:id` response now includes the restored tools for the toggled server

### Fixed
- **Anomaly detection test flakiness** — High-frequency anomaly test no longer fails when run outside business hours (9–17); the test now searches all alert callback invocations instead of only the first (which could contain only `after_hours` anomalies)

### Tests
- Full toggle cycle test — new test simulates exact PATCH route behavior (disable in DB + clear memory, then re-enable + restore)
- `restoreTools` bypass test — verifies tools restore from DB regardless of server enabled state
- 1486 tests across 88 test files

---

## [1.4.1] — 2026-02-13

### Marketplace
- **Install → Brain skills** — Marketplace `install()` now creates an actual Skill in BrainStorage (visible in the Skills view) with `source: 'marketplace'`; `uninstall()` removes it from both marketplace and Brain
- **Built-in example skill** — "Summarize Text" utility skill seeded into marketplace on startup (idempotent)
- **New `marketplace` skill source** — `SkillSourceSchema` extended with `'marketplace'`; dashboard SkillsManager shows Marketplace label and filter option
- **Dashboard sync** — Installing/uninstalling marketplace skills now invalidates the Skills query cache so the Skills view stays in sync

### Dashboard
- **Notification toggle fix** — Toggle switch circle no longer overflows the track; fixed dimensions (`w-9 h-5` track, `w-4 h-4` circle) and translation values
- **Log retention settings** — Retention policy fields (max age days, max entries) are now editable with an "Enforce Retention" button that prunes old audit entries via the backend
- **Audit log export** — New "Export Audit Log" button downloads a JSON backup of the full audit log

### Core
- **Audit retention endpoint** — `POST /api/v1/audit/retention` accepts `maxAgeDays` and `maxEntries` to prune old audit entries with validation (1–3650 days, 100–10M entries)
- **Audit export endpoint** — `GET /api/v1/audit/export` returns the full audit log as a downloadable JSON file with `Content-Disposition` header
- **MCP tool persistence** — Toggling an MCP server off then on now correctly restores discovered tools; tools are persisted to SQLite (`mcp_server_tools` table) and restored from DB on re-enable

### Documentation
- **ADR 028** — Marketplace Skill Installation decision record

---

## [1.4.0] — 2026-02-13

### Security Hardening
- **HTTP security headers** — All responses now include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`; HSTS header added when TLS is active
- **CORS wildcard fix** — Wildcard (`*`) CORS origins no longer set `Access-Control-Allow-Credentials: true` (violates Fetch spec and allowed any origin to make credentialed requests); explicit origins now include `Vary: Origin` for correct cache behavior
- **WebSocket channel authorization** — WebSocket token validation is now properly awaited (was fire-and-forget); authenticated user's role is stored on the client and checked against RBAC `CHANNEL_PERMISSIONS` on subscribe — viewers can no longer subscribe to `audit` or `security` channels
- **WebSocket heartbeat** — 30-second ping/pong cycle terminates unresponsive connections after 60 seconds of silence; cleanup on server stop

### MCP Service (`@friday/mcp`)
- **Auto-token** — MCP service now self-mints a service JWT using the shared `SECUREYEOMAN_TOKEN_SECRET` instead of requiring a manually-configured `MCP_CORE_TOKEN`. No user intervention needed for local/internal MCP.
- **New package** — Standalone MCP (Model Context Protocol) service exposing FRIDAY capabilities as 22+ tools, 7 resources, and 4 prompts
- **Tools** — `knowledge_search`, `knowledge_get`, `knowledge_store`, `memory_recall`, `task_create`, `task_list`, `task_get`, `task_cancel`, `system_health`, `system_metrics`, `system_config`, `integration_list`, `integration_send`, `integration_status`, `personality_get`, `personality_switch`, `skill_list`, `skill_execute`, `audit_query`, `audit_verify`, `audit_stats`, `fs_read`, `fs_write`, `fs_list`, `fs_search`
- **Resources** — `friday://knowledge/all`, `friday://knowledge/{id}`, `friday://personality/active`, `friday://personality/{id}`, `friday://config/current`, `friday://audit/recent`, `friday://audit/stats`
- **Prompts** — `friday:compose-prompt`, `friday:plan-task`, `friday:analyze-code`, `friday:review-security`
- **Transports** — Streamable HTTP (primary), SSE, and stdio (for Claude Desktop)
- **Security** — JWT auth delegation via core's `/api/v1/auth/verify`, per-tool rate limiting, input injection detection, secret redaction, audit logging
- **Auto-registration** — Self-registers with core's MCP Servers page on boot (including full tool manifest); deregisters on shutdown
- **Tool manifest** — Tools are sent during auto-registration so core can display them without speaking MCP protocol
- **Dashboard** — JSON API dashboard at `/dashboard` with tool/resource/prompt catalogs and logs
- **Filesystem tools** — Opt-in sandboxed file ops with path validation, symlink protection, and admin-only access
- **212 tests** across 26 test files covering tools, resources, prompts, middleware, auth, registration, transports, dashboard, and e2e

### Core
- **Auth verify endpoint** — `POST /api/v1/auth/verify` validates JWT tokens and returns user info; enables service-to-service auth for the MCP package
- **MCP tool registration** — `McpClientManager.registerTools()` accepts tool manifests during auto-registration; tools show in dashboard immediately
- **MCP server toggle** — `PATCH /api/v1/mcp/servers/:id` enables/disables MCP servers; disabling clears discovered tools
- **MCP storage update** — `McpStorage.updateServer()` method for toggling server enabled state

### Integrations
- **CLI adapter** — Built-in CLI / REST API now registers as a connectable integration on the dashboard; lightweight passthrough adapter with 100 msg/s rate limit (14 tests)
- **Generic Webhook adapter** — Outbound POSTs to configurable URL with optional HMAC-SHA256 signing; inbound `POST /api/v1/webhooks/custom/:id` endpoint with signature verification and UnifiedMessage normalization (23 tests)
- **Google Chat registration** — Google Chat adapter (previously unregistered) now wired into `IntegrationManager`; promoted from Beta to Stable (20 tests)
- **IntegrationManager.getAdapter()** — New method to retrieve the running adapter instance by integration ID; used by the custom webhook inbound route (2 tests)
- **Default rate limits** — Added `googlechat` (5/s), `cli` (100/s), and `webhook` (30/s) to `DEFAULT_RATE_LIMITS`

### Dashboard
- **MCP server enable/disable toggle** — Server cards now show a clickable enabled/disabled badge to toggle state via PATCH API
- **MCP responsive layout** — Server grid and header adapt to small screens with proper wrapping and truncation
- **Alphabetical platform sorting** — Available Platforms and Configured Integrations on the Connections > Messaging page are now sorted alphabetically by display name
- **Removed dead doc links** — Removed broken `helpUrl` links from platform cards (docs are not served by the dashboard); cleaned up unused `ExternalLink` import and `helpUrl` interface field

### Documentation
- **Integration guide updated** — Added CLI and Webhook setup guides with config options, inbound/outbound examples, and rate limits; promoted Google Chat to Stable; table now lists all 8 platforms alphabetically
- **REST API docs** — Added `POST /api/v1/webhooks/custom/{id}` endpoint documentation
- **ADR 025** — Architecture decision record for CLI, Webhook, and Google Chat integration completion

---

## [1.3.3] — 2026-02-13

### Dashboard
- **Task History — heartbeat task visibility** — Heartbeat tasks now always display in the task list, even when no user-created tasks exist; previously they were hidden behind a "No tasks found" message
- **Task History — edit/delete for tasks** — Edit icon opens a dialog to modify task name, type, and description; delete icon uses a proper confirmation dialog instead of browser `confirm()`
- **Task History — responsive layout** — Table columns adapt to screen sizes with responsive visibility classes

### Fixed
- **Backend task update** — PUT `/api/v1/tasks/:id` now correctly uses an UPDATE query instead of attempting a duplicate INSERT which caused UNIQUE constraint failures
- **Date filter parsing** — Task list date filters now correctly parse ISO 8601 strings from the frontend; previously `Number()` coercion produced NaN which silently disabled all date filtering
- **JSON input safety** — Create task dialog and auto-create flow now guard against invalid JSON input instead of throwing uncaught parse errors
- **Type cast cleanup** — Removed `as any` type cast in task edit dialog

### Code Quality
- **ConfirmDialog usage** — Task deletion now uses the existing `ConfirmDialog` component for consistent UX instead of the browser's native `confirm()`
- **Test coverage** — Added tests for heartbeat task rendering (with and without regular tasks), edit dialog, and delete confirmation

---

## [1.3.2] — 2026-02-13

### Dashboard
- **Task History — New Task creation** — Added "New Task" button with dialog for creating tasks (name, type, description, JSON input)
- **Sidebar quick-create** — "New" button in sidebar for fast access to create personalities, tasks, skills, or experiments
- **About dialog** — Replaced dashboard footer with About dialog accessible from user menu

### Fixed
- **Date filters on tasks endpoint** — Added `from`/`to` query parameter support to `GET /api/v1/tasks`
- **Auto-refetch duplicate tasks** — Removed automatic refetch interval that caused duplicate task entries
- **Notification toggle overflow** — Fixed toggle sizing that caused overflow outside container

---

## [1.3.1] — 2026-02-12

### Dynamic Model Discovery
- **All-provider dynamic fetch** — Added `fetchAvailableModels()` static methods to `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider`, and `OpenCodeProvider`, matching Gemini's existing pattern; each uses raw `fetch` against the provider's models/tags API
- **Parallel provider fetching** — `getAvailableModelsAsync()` now queries all configured providers simultaneously via `Promise.allSettled`; models from APIs replace static lists while static entries remain as fallback on failure
- **Anthropic** — Filters to `claude-*` models via `GET /v1/models` with `x-api-key` + `anthropic-version` headers
- **OpenAI** — Filters to models owned by `openai` or `system` (skips fine-tuned/third-party) via `GET /v1/models`
- **Ollama** — Lists locally downloaded models via `GET /api/tags`; returns model name and size
- **OpenCode** — Lists models from OpenAI-compatible `GET /models` endpoint with Bearer auth

### Dashboard
- **Dropdown highlighting** — Active personality and model selection items now show a lighter blue background (`bg-primary/15`) with a left blue border indicator for clearer visual feedback
- **Sidebar collapsed spacing** — Reduced spacing between navigation icons when sidebar is collapsed for a more compact layout

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

*Last updated: February 14, 2026*
