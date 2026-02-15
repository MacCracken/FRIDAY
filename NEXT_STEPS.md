# NEXT_STEPS

> **F.R.I.D.A.Y.** — Fully Responsive Integrated Digitally Adaptable Yeoman

---

## v1.5.1 — Completed (2026-02-14)

- **Documentation & version audit** — All packages, source, Dashboard UI, OpenAPI spec, and security policy aligned to 1.5.1
- **OpenAPI spec update** — Added missing `googlechat`, `cli`, `webhook` platforms; version corrected from 1.4.1
- **Removed obsolete planning docs** — Superseded by implemented features and ADRs
- **Roadmap & TODO cleanup** — Updated test counts, removed stale references

## v1.5.0 — Completed (2026-02-13)

- **Universal Script Assistant** — Builtin marketplace skill: elite script consultant with Brainstorm, Architect, Draft, and Roast modes
- **Marketplace dashboard auth fix** — Switched from wrong localStorage key to shared `request()` with proper auth and token refresh
- **Marketplace type alignment** — `MarketplaceSkill.tools` uses `ToolSchema`; `createSkill` wrapped with `SkillCreateSchema.parse()`
- **MCP robust tool restore** — `restoreTools()` bypasses `server.enabled` guard on toggle re-enable
- **Anomaly detection test fix** — High-frequency test no longer flaky outside business hours

## v1.4.1 — Completed (2026-02-13)

- **Marketplace install → Brain skills** — Install/uninstall syncs with BrainStorage
- **Dashboard repairs** — Notification toggle, log retention settings, audit export
- **MCP tool persistence** — Toggle off/on restores tools from SQLite

## v1.4.0 — Completed (2026-02-13)

- **Gateway security hardening** — HTTP headers, CORS fix, WebSocket RBAC, heartbeat
- **MCP service** — `@friday/mcp` package with 22+ tools, 7 resources, 4 prompts
- **Integrations** — CLI, Webhook, Google Chat adapters

See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## Next — Planned

- [ ] Storybook for component development
- [ ] Test connection button for integrations (requires backend endpoint)
- [ ] Node detail expansion in MetricsGraph
- [ ] HTML prompt injection protection — DOMPurify sanitization
- [ ] CLI enhancements — expanded command set, interactive mode, plugin management
- [ ] Outbound webhooks for events

---

## Screen Capture Implementation (Security-Critical)

A comprehensive secure screen capture system is being planned. See:
- [Implementation Plan](docs/planning/screen-capture/IMPLEMENTATION_PLAN.md)
- [ADR 014](docs/adr/014-screen-capture-security-architecture.md) - Security Architecture
- [ADR 015](docs/adr/015-rbac-capture-permissions.md) - RBAC Permissions
- [ADR 016](docs/adr/016-user-consent-capture.md) - User Consent Flow
- [ADR 017](docs/adr/017-sandboxed-capture-execution.md) - Sandboxed Execution

---

*See [docs/development/roadmap.md](docs/development/roadmap.md) for the full roadmap.*
