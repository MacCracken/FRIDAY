# F.R.I.D.A.Y. — Open Items

> Tracking open and deferred work items. For completed work, see [CHANGELOG.md](CHANGELOG.md).

**Project Status**: v1.3.1 released. Phases 1-5 complete. Security hardening complete. 1000+ tests across core and dashboard. All core features implemented. Coding IDE view, voice interface, dashboard improvements, and dynamic model discovery shipped.

---

## Deferred Dashboard Features

- [x] Search bar — global search across tasks and security events with Ctrl+K shortcut
- [x] Date range picker for TaskHistory — presets + custom date inputs
- [x] Export functionality for TaskHistory — CSV and JSON export
- [x] User profile dropdown — avatar dropdown with role, theme, sign out
- [x] Notification bell — WebSocket-driven in-app notifications
- [x] User preferences state management — React context + localStorage
- [x] Security settings page — RBAC roles, rate limits, audit chain
- [x] Notification settings page — event type toggles, sound on/off
- [x] Log retention settings page — audit stats and retention config
- [x] Message queue for offline WebSocket — buffering, reconnect banner
- [x] Event acknowledgment and investigation workflow
- [ ] Storybook for component development
- [ ] Test connection button for integrations (requires backend endpoint)
- [ ] Node detail expansion in MetricsGraph

## Completed Security Hardening

- [x] Audit log retention policy enforcement — `enforceRetention()` with age and count limits
- [x] Encrypted config file support — `.enc.yaml` detection, encrypt/decrypt CLI, round-trip tested
- [x] seccomp-bpf filter creation — syscall allow/block lists, kernel detection, graceful fallback
- [x] Namespace isolation — PID/network/mount via `unshare`, capability detection

## Completed Production Features

- [x] Remember me toggle — extended JWT (30-day), login checkbox, localStorage persistence
- [x] Password reset flow — `POST /auth/reset-password`, session invalidation, audit logging
- [x] 2FA (TOTP) — RFC 6238, setup/verify flow, recovery codes, login integration
- [x] Release notes generation — conventional commit parser, `npm run release-notes`

## Completed Integration Features

- [x] Plugin loader with dynamic import — directory scanning, export validation
- [x] Zod-validated per-plugin config schema — schema registration, descriptive errors
- [x] Media handling — size limits, temp file management, content scanner hook
- [x] Reply threading and context preservation — thread-scoped conversation contexts

## Remaining Integration Features

- [ ] Telegram inline keyboards, photo/document/voice attachments
- [ ] Discord thread support for multi-turn conversations
- [ ] Slack interactive messages (blocks, modals)
- [ ] WhatsApp integration
- [ ] Calendar integration
- [ ] GitHub PR review automation via AI
- [ ] GitHub code search and file browsing

---

## Completed in v1.2.0

- [x] MCP protocol support (Model Context Protocol)
- [x] Skill marketplace — browse and install community skills
- [x] Custom dashboards — user-configurable layouts
- [x] Team workspaces — multi-user collaboration
- [x] Audit report generator — compliance report export
- [x] Cost optimization — token usage recommendations
- [x] A/B testing — model comparison experiments

## Completed in v1.3.0

- [x] Coding IDE view — Monaco editor with personality-scoped chat sidebar
- [x] Voice interface — browser-native SpeechRecognition + speechSynthesis
- [x] Dashboard improvements — enhanced layout, status bar updates

## Future Enhancements

### v1.4

- [ ] HTML prompt injection protection — DOMPurify sanitization for user/LLM content
- [ ] Outbound webhooks for events
- [ ] CLI enhancements — expanded command set, interactive mode, plugin management commands
- [ ] CLI updates — config validation command, health check, integration management from CLI

### v2.0

- [ ] Distributed deployment — Kubernetes-native
- [ ] ML-based anomaly detection — advanced threat detection
- [ ] Mobile app — native iOS/Android dashboard

---

## Research Areas

- Sandbox: seccomp vs eBPF, gVisor, WASM isolation
- Encryption: libsodium vs WebCrypto, HSM integration
- Visualization: WebGL for large graphs, layout algorithms (Dagre, ELK)
- Real-time: Redis pub/sub, CRDT for collaborative editing

---

*See [CHANGELOG.md](CHANGELOG.md) for completed work history.*
*See [docs/development/roadmap.md](docs/development/roadmap.md) for the development roadmap.*

*Last updated: February 2026*
