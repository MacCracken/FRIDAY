# Development Roadmap

> Development phases, timeline, and progress for F.R.I.D.A.Y.

---

## Development Phases

```
Phase 1          Phase 2          Phase 2.5        Phase 3          Phase 4          Phase 5
Foundation       Security         Infrastructure   Dashboard        Integrations     Production
   |                |                |                |                |                |
   v                v                v                v                v                v
[Core Agent] -> [RBAC/Crypto] -> [Brain/Comms] -> [React UI] -> [Platforms] -> [Hardening]
   |                |                |                |                |                |
   +- Task Loop     +- Encryption    +- CLI           +- Metrics       +- Telegram      +- Load Testing
   +- Logging       +- Sandbox       +- Brain/Soul    +- History       +- Discord       +- Security Testing
   +- Config        +- Validation    +- E2E Comms     +- Connections   +- Slack         +- Prometheus
   +- Storage       +- Rate Limit    +- Fallbacks     +- Security      +- GitHub        +- Docs
   +- AI Providers  +- mTLS          +- Task Storage  +- Soul UI       +- Webhooks      +- Deployment
```

---

## Phase 1: Foundation

**Status**: Complete
**Duration**: 3 weeks

- TypeScript project structure with strict mode, ESLint, Prettier, Vitest
- Configuration management (YAML + env vars + Zod validation)
- Base agent loop with task queue, event-driven architecture, graceful shutdown
- Multi-provider AI integration (Anthropic, OpenAI, Gemini, Ollama, OpenCode Zen)
- Structured logging with UUID v7, correlation IDs, SQLite WAL storage
- Cryptographic audit chain (HMAC-SHA256, integrity verification)
- Log query API with REST endpoint

---

## Phase 2: Security Layer

**Status**: Complete
**Duration**: 4 weeks

### Authentication & Authorization
- RBAC with role definitions (Admin, Operator, Auditor, Viewer), inheritance, persistent storage
- JWT authentication with refresh token rotation, blacklisting
- API key authentication with rate limiting and revocation
- Gateway middleware for per-route RBAC enforcement

### Encryption & Secrets
- AES-256-GCM encryption at rest with scrypt KDF
- System keyring integration (macOS Keychain, Linux Secret Service)
- Secret rotation with dual-key JWT verification and grace periods

### Input Validation & Protection
- Input validation pipeline (size limits, encoding normalization, injection detection)
- Prompt injection defense (6 pattern families, blocking + warning modes)
- Rate limiting with sliding window counters (per-user, per-IP, per-API-key, global)

### Sandboxing
- Cross-platform sandbox abstraction (`Sandbox` interface, `SandboxManager`)
- Linux: V1 soft sandbox + V2 Landlock kernel enforcement via forked worker
- macOS: `sandbox-exec` profile generation with deny-default policy
- NoopSandbox fallback with warning

### Additional
- Soul system (personality, skills, onboarding, 18 REST endpoints)
- mTLS with client certificate authentication
- Redis-backed distributed rate limiting

---

## Phase 2.5: Core Infrastructure Gaps

**Status**: Complete
**Duration**: 1 week

- CLI entry point (`--port`, `--host`, `--config`, `--log-level`, `--tls`)
- SQLite task storage with filtering, pagination, and metrics
- Security events query API
- Rate limit metrics integration
- Brain system (memory, knowledge, skills with decay and pruning)
- E2E encrypted inter-agent communication (X25519 + Ed25519 + AES-256-GCM)
- Model fallback chain on rate limits (429) / provider unavailability (502/503)

---

## Phase 3: Dashboard

**Status**: Complete
**Duration**: 5 weeks

- React + Vite + TypeScript with URL routing (react-router-dom v7)
- TanStack Query for server-state management
- WebSocket client with auto-reconnection and channel subscriptions
- MetricsGraph (ReactFlow with custom node types and real-time updates)
- TaskHistory with advanced filtering (status + type), live data
- SecurityEvents with severity-based styling, live data
- ConnectionManager with connect forms, start/stop/delete, error retry
- ResourceMonitor with CPU/Memory gauges, token/cost tracking, real history
- Soul/Personality UI (onboarding wizard, personality editor, skills manager)
- Login page with JWT auth, automatic token refresh on 401
- Session timeout warning, ErrorBoundary, ConfirmDialog
- Responsive mobile layout (hamburger nav, stacked cards, adaptive header/footer spacing)
- Theme toggle (dark/light with localStorage persistence)
- Settings page restructured with expandable sidebar (General, Security, API Keys)
- API Keys management moved to dedicated page with create/revoke functionality
- Agent identity moved to Personality section (ADR 024)
- DashboardLayout, StatusBar (inline reconnecting indicator), collapsible sidebar navigation (v1.2)
- 57 component tests across 5 files (Vitest + Testing Library + jsdom)

---

## v1.3.3 (2026-02-13)

- **Code Editor**: Run button executes code directly in terminal with language-specific runtimes (python3, node, npx ts-node, bash, ruby, go run)
- **Personality Editor**: Body section now shows Vision/Auditory capability toggles when available
- **Task History**: New Task button to create and execute tasks directly from the dashboard
- Push-to-talk voice mode with keyboard shortcuts (Ctrl+Shift+V)
- Voice overlay component for visual feedback during recording
- Screen capture sandbox architecture (darwin, linux, windows)
- Permission orchestrator with platform-specific implementations
- Skill executor and scheduler with cron/interval support

---

## Phase 4: Integrations

**Status**: Complete
**Duration**: 4 weeks

- Plugin architecture (`Integration` interface, `IntegrationManager`, `IntegrationStorage`, factory pattern)
- Message abstraction (`UnifiedMessage`, `MessageAttachment`, `PlatformAdapter`, `MessageRouter`)
- REST API routes for CRUD + start/stop + messages with RBAC
- Telegram adapter (grammy, long-polling, `/start`/`help`/`status` commands, 23 tests)
- Discord adapter (discord.js v14, slash commands, embeds, 19 tests)
- Slack adapter (Slack Bolt, socket mode, slash commands, 18 tests)
- GitHub adapter (Octokit, webhook handler, signature verification, 17 tests)
- Conversation management, auto-reconnect, per-platform rate limiting
- 24 integration framework tests

---

## Phase 5: Production Hardening

**Status**: Complete
**Duration**: 3 weeks

- Docker packaging (multi-stage Dockerfile, docker-compose, non-root user, healthcheck)
- CI/CD pipeline (lint, typecheck, test, build, security audit, docker build; Node 20+22 matrix)
- Load testing (k6 scripts: API endpoints, auth flow, WebSocket, task creation)
- Security testing (injection, JWT manipulation, rate limit bypass, RBAC, audit integrity; 63 tests)
- Chaos testing (database corruption, crash recovery, resource exhaustion; 13 tests)
- Prometheus metrics endpoint with Grafana dashboard and alert rules
- Log aggregation (append-only JSONL file writer, log rotation with gzip, Loki + Promtail)
- Documentation (getting started, configuration, API, OpenAPI 3.1, troubleshooting, deployment, integrations, security testing)

---

## Test Coverage

| Category | Tests | Files |
|----------|-------|-------|
| Core (AI, config, task, logging) | ~200 | 12 |
| Security (auth, RBAC, crypto, rate limiter, sandbox) | ~250 | 10 |
| Brain + Soul | ~130 | 4 |
| Comms | ~40 | 1 |
| Integrations (framework + all adapters) | ~101 | 6 |
| Integration tests (E2E flows) | ~32 | 3 |
| Dashboard (component tests) | ~57 | 5 |
| Security + Chaos tests | ~76 | 5+ |
| File writer + Log rotation | ~27 | 2 |
| Prometheus | ~5 | 1 |
| **Total** | **~963** | **59** |

All core modules maintain >80% coverage thresholds.

---

## Timeline Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Foundation | 3 weeks | Complete |
| Phase 2: Security | 4 weeks | Complete |
| Phase 2.5: Infrastructure | 1 week | Complete |
| Phase 3: Dashboard | 5 weeks | Complete |
| Phase 4: Integrations | 4 weeks | Complete |
| Phase 5: Production | 3 weeks | Complete |
| v1.0.0 MVP Release| 2 Weeks | Complete |
| **v1.1.1 Release** | — | **Released 2026-02-12** |
| **v1.2.0 Release** | — | **Complete** |
| **v1.3.0 Release** | — | **Complete (released 2026-02-12)** |
| **v1.3.1 Release** | — | **Complete (released 2026-02-12)** |
| **v1.3.3 Release** | — | **Complete (released 2026-02-13)** |
| **v1.4.0 Release** | — | **Complete (released 2026-02-13)** |
| **v1.4.1 Release** | — | **Complete (released 2026-02-13)** |
| **v1.5.0 Release** | — | **Complete (released 2026-02-13)** |

---

## v1.2: Advanced Features

**Status**: Complete
**Released**: 2026-02-12

- ✅ Sidebar navigation (collapsible left-side panel replacing top tabs)
- ✅ MCP protocol support (client + server with REST API)
- ✅ Custom dashboards (drag-and-drop widget placement)
- ✅ Audit report generator (JSON/HTML/CSV export)
- ✅ Team workspaces (multi-team isolation with member management)
- ✅ Cost optimization recommendations
- ✅ A/B testing framework (experiment management with variant routing)
- ✅ Skill marketplace (discovery, search, install, publish with signature verification)

---

## v1.3: Developer Experience

**Status**: Complete
**Released**: 2026-02-12

- ✅ Coding IDE view — Monaco editor with personality-scoped chat sidebar, `useChat` hook extraction
- ✅ Voice interface — browser-native SpeechRecognition + speechSynthesis, localStorage persistence, graceful degradation
- ✅ Dashboard improvements — enhanced layout, status bar updates

---

## v1.3.1: Dynamic Model Discovery

**Status**: Complete
**Released**: 2026-02-12

- ✅ Dynamic model discovery for all providers — `fetchAvailableModels()` on Anthropic, OpenAI, Ollama, OpenCode (matching Gemini's existing pattern)
- ✅ Parallel provider fetching — `getAvailableModelsAsync()` queries all configured providers simultaneously via `Promise.allSettled`
- ✅ Dashboard dropdown highlighting — lighter blue highlight with left border on active personality and model selections
- ✅ Sidebar collapsed spacing — reduced icon spacing when sidebar is collapsed

---

## v1.4.0: Security & MCP

**Status**: Complete
**Released**: 2026-02-13

- ✅ HTTP security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS)
- ✅ CORS wildcard + credentials fix (Fetch spec compliance)
- ✅ WebSocket channel RBAC authorization (role-based subscribe filtering)
- ✅ WebSocket heartbeat ping/pong (30s cycle, 60s dead connection cleanup)
- ✅ MCP service package (`@friday/mcp`) — 22+ tools, 7 resources, 4 prompts, auto-registration
- ✅ CLI, Webhook, Google Chat integrations
- ✅ Auth verify endpoint for service-to-service JWT delegation

---

## v1.4.1: Dashboard & Marketplace Polish

**Status**: Complete
**Released**: 2026-02-13

- ✅ Marketplace skill installation → Brain skill sync
- ✅ Notification toggle CSS fix (circle overflow)
- ✅ Log retention settings — editable policy with backend enforcement
- ✅ Audit log JSON export/download
- ✅ MCP tool persistence (SQLite-backed; toggle off/on restores tools)

---

## v1.5.0: Marketplace & MCP Reliability

**Status**: Complete
**Released**: 2026-02-13

- ✅ Universal Script Assistant — builtin marketplace skill (screenwriting consultant with 4 modes)
- ✅ Marketplace dashboard auth fix — switched from wrong localStorage key to shared `request()` with proper auth
- ✅ Marketplace type alignment — `MarketplaceSkill.tools` uses `ToolSchema`; `createSkill` uses `SkillCreateSchema.parse()`
- ✅ MCP robust tool restore — `restoreTools()` bypasses `server.enabled` guard on toggle re-enable
- ✅ Anomaly detection test flakiness fix (time-of-day dependent)

---

## Future Enhancements

### v2.0
- Distributed deployment (Kubernetes)
- ML-based anomaly detection
- Mobile app

---

## Related Documentation

- [Architecture Overview](architecture.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Configuration Reference](../configuration.md)
- [Getting Started Guide](../guides/getting-started.md)
- [Changelog](../../CHANGELOG.md)

---

*Last updated: February 2026*
