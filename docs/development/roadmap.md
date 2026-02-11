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
- Multi-provider AI integration (Anthropic, OpenAI, Gemini, Ollama)
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

**Status**: ~98% complete
**Duration**: 5 weeks

### Completed
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
- Responsive mobile layout (hamburger nav, stacked cards, hidden table columns)
- Theme toggle (dark/light with localStorage persistence)
- Settings page (agent identity, API key management, soul config overview)
- DashboardLayout, StatusBar, NavigationTabs (memoized, 7 tabs)

### Deferred
- Storybook, mock data generators
- Date range picker, export functionality
- User profile dropdown, notification bell, search bar
- Test connection button

---

## Phase 4: Integrations

**Status**: Framework + Telegram complete
**Duration**: 3-4 weeks (2 weeks remaining)

### Completed
- Plugin architecture (`Integration` interface, `IntegrationManager`, `IntegrationStorage`, factory pattern)
- Message abstraction (`UnifiedMessage`, `MessageAttachment`, `PlatformAdapter`, `MessageRouter`)
- REST API routes for CRUD + start/stop + messages with RBAC
- Telegram adapter (grammy, long-polling, `/start`/`help`/`status` commands, 23 tests)
- 24 integration framework tests

### Remaining (moved to Phase 5 prompt)
- Discord adapter (discord.js v14, slash commands, embeds, threads)
- Slack adapter (@slack/bolt, socket mode, Block Kit)
- GitHub adapter (@octokit, webhook handler, PR review, issue triage)

---

## Phase 5: Production Hardening

**Status**: Partial (Docker + CI/CD done)
**Duration**: 3 weeks

### Completed
- Docker packaging (multi-stage Dockerfile, docker-compose, non-root user, healthcheck)
- CI/CD pipeline (lint -> typecheck -> test -> build -> security audit -> docker build, Node 20+22 matrix)
- Documentation: installation.md, configuration.md, api/ reference

### Remaining
- Integration framework improvements (ConversationManager, auto-reconnect, per-platform rate limiter)
- Remaining platform adapters (Discord, Slack, GitHub)
- Load testing (k6 scripts for all API endpoints)
- Security testing (injection, JWT manipulation, rate limit bypass, RBAC, audit integrity, sandbox escape)
- Prometheus metrics endpoint with Grafana dashboard and alert rules
- Log aggregation configs (Loki + Promtail)
- OpenAPI specification
- Troubleshooting and deployment guides
- Release script

---

## Test Coverage

| Category | Tests | Files |
|----------|-------|-------|
| Core (AI, config, task, logging) | ~200 | 12 |
| Security (auth, RBAC, crypto, rate limiter, sandbox) | ~250 | 10 |
| Brain + Soul | ~130 | 4 |
| Comms | ~40 | 1 |
| Integrations (framework + Telegram) | ~47 | 2 |
| Integration tests (E2E flows) | ~32 | 3 |
| Dashboard | ~612 | 7+ |
| **Total** | **~746 (core) + 612 (dashboard)** | **39+** |

All core modules maintain >80% coverage thresholds.

---

## Timeline Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Foundation | 3 weeks | Complete |
| Phase 2: Security | 4 weeks | Complete |
| Phase 2.5: Infrastructure | 1 week | Complete |
| Phase 3: Dashboard | 5 weeks | ~98% Complete |
| Phase 4: Integrations | 4 weeks | Framework + Telegram Complete |
| Phase 5: Production | 3 weeks | Partial (Docker + CI/CD) |

---

## Future Enhancements

### v1.1 (Post-MVP)
- MCP protocol support
- Skill marketplace
- Custom dashboards
- Performance optimization

### v1.2
- Team workspaces
- Audit report generator
- Cost optimization recommendations
- A/B testing framework

### v2.0
- Distributed deployment (Kubernetes)
- Federation (cross-instance communication via E2E comms)
- ML-based anomaly detection
- Voice interface
- Mobile app

---

## Related Documentation

- [Architecture Overview](architecture.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Configuration Reference](../configuration.md)
- [Installation Guide](../installation.md)

---

*Last updated: February 2026*
