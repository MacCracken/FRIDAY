# Development Roadmap

> Open items only — see [Changelog](../../CHANGELOG.md) for completed work.

---

## Hybrid TypeScript/Rust Architecture

**Status**: **0.5.0 — Rust-native, migration repair complete.** All 16 repair phases done. Node.js eliminated. sy-core is the sole application binary (971+ routes, 85 modules). Full middleware stack (13 layers including fingerprinting), true SSE chat streaming, RBAC enforcement, ownership guards, API key validation, JTI token revocation, persistent vector store (pgvector), dashboard endpoint gap-fill (27 endpoints), response shape alignment. 170 tests passing. See **[Migration Findings](migration-finds.md)** for the full audit and repair log.

See **[Rust Testing Matrix](rust-testing-matrix.md)** for coverage targets, hardware test plan, and per-platform verification checklist.

Phase 10 flatten complete — all domain libraries live inside `sy-core` as modules, and the workspace is a single crate with two binary targets.

- `crate::crypto` — AES-256-GCM, X25519, Ed25519, HMAC-SHA256, HKDF
- `crate::hwprobe` — thin wrapper around `ai-hwaccel` (crates.io), camelCase JSON for the dashboard API
- `crate::tee` — Model weight sealing with TPM2/keyring keys
- `crate::privacy` — DLP PII regex scanning, compiled Rust DFA
- `crate::audit` — HMAC-SHA256 linked tamper-evident audit chain
- `crate::sandbox` — seccomp-bpf, Landlock, cgroup v2 detection
- `crate::types` — Shared wire types (config, health response, common API shapes)
- Binary `sy-core` (26.8 MB) — HTTP gateway, DB, auth, orchestration, integrations
- Binary `sy-edge` (10.6 MB) — fleet runtime, shares the same codebase (Phase 9/10 unification). `--features edge` stripping of dashboard/integrations is the next optimization pass.

### Shared Ecosystem Crates — Future

As the project ecosystem grows (SecureYeoman, AGNOS, Agnostic, Ifran, Shruti, Tazama, Rasa, Mneme), domain-specific logic should be extracted into standalone published crates — same pattern as `ai-hwaccel` for hardware detection and `tarang` for audio/video processing.

**Candidates** (publish when domain logic outgrows SY-only use):

| Candidate | Current Location | Trigger to Extract | Consumers |
|-----------|-----------------|-------------------|-----------|
| `sy-cryptokit` | `crates/sy-crypto` + `sy-tee` + `sy-audit` | TEE wire format, audit chain HMAC scheme, or A2A envelope encryption becomes reusable outside SY | SY, AGNOS, Agnostic, Ifran |
| `sy-privacy-core` | `crates/sy-privacy` | DLP classification engine needed by Agnostic agents or Ifran routing | SY, Agnostic, Ifran |
| `sy-sandbox-core` | `crates/sy-sandbox` | Landlock/seccomp policy engine shared with AGNOS runtime | SY, AGNOS, Agnosticos |

**Not candidates** (too SY-specific): `sy-edge` (SY binary), `sy-hwprobe` (already delegates to `ai-hwaccel`).

---

## 0.5.1 — P(-1) Scaffold Hardening

**Priority**: P(-1) — Blocks any new features after 0.5.0 ships. Run the hardening loop from [CLAUDE.md §P(-1)](../../CLAUDE.md) end to end before opening new work. Items below are the specific findings accumulated during the 0.5.0 release sprint and the 2026-04-27 P(-1) checkpoint; they are the input to the loop, not a substitute for it.

### 2026-06-07 — 0.5.1 hardening release (shipped)

A 16-dimension adversarially-verified multi-agent review drove a P(-1) hardening pass. **Tagged 0.5.1.** Full detail in the [CHANGELOG](../../CHANGELOG.md#051--2026-06-07). Highlights:

- **Security:** JWT admin-token forgery (refuse-to-boot exposed without a strong secret); `X-Forwarded-For` spoofing of the local-network gate / rate-limit / IP-reputation (real-peer `ConnectInfo` + opt-in trusted-proxy); edge runtime fail-closed + constant-time token + enforced exec timeout + trimmed allowlist; audit-chain sequence + signed-head tamper-evidence; DLP engine wired up + secret detection; MCP SSH command-injection + SSRF; HSTS/CSP; CSV-injection; reachable panics; **unverified auth stubs failed-closed** (no more admin-token forgery).
- **Hardening:** orchestration resource clamps, streamed body-limit, DB pool timeouts, forge lock-across-await, dashboard `Bearer null` fix.
- **Deps:** Rust `cargo update` + unused ecosystem crates commented out (cleared wasmtime/aes advisories); npm react-router/vitest/mermaid/excalidraw security bumps. audit/deny green.
- **Marketplace seed (P0):** 46 first-party items restored as a Rust first-boot seed.
- **Build/CI:** GitHub Actions SHA-pinned (release workflow), Docker healthcheck/railway/license fixes.

**Deferred:** 0.5.2 = real WebAuthn + OIDC SSO (stubs are failed-closed meanwhile). 0.6.0 = real seccomp/Landlock enforcement, full multi-tenant isolation, real cert pinning, refresh-token→cookie, SSE/avatar token-in-URL, `packages/core` deletion + Cyrius ecosystem-crate port.

### 2026-04-27 P(-1) checkpoint — done in this cycle

These shipped on `main` ahead of the 0.5.1 tag. Tests still green: 462 Rust + 4140 dashboard + 1235 MCP.

- ✅ **Cargo dep refresh** — `cargo update` across 167 packages. Net advisory delta **16 → 1**: ecosystem bumps (`dhvani 1.0→1.1`, `szal 1.0→1.1`, `ai-hwaccel 1.0→1.2`, `agnosai 1.0.2→1.1`, `ifran 1.2→1.3`, `hisab 1.3→1.4`, `hoosh 1.1→1.3`, `mastishk 1.0→1.1`, `majra 1.0.3→1.0.4`) plus stack bumps (`tokio 1.50→1.52`, `axum 0.8.8→0.8.9`, `tokio-tungstenite 0.28→0.29` indirectly, `wasmtime 43.0→43.0.1`, `uuid 1.22→1.23`, `zip 8.4→8.6`). Surviving advisory: **RUSTSEC-2023-0071** (`rsa 0.9.10` Marvin Attack via `sqlx-mysql` — unreachable; we use Postgres only; no upstream fix).
- ✅ **npm dep refresh** — `jose 6.2.2→6.2.3`, `vitest 4.1.4→4.1.5` in `packages/mcp`. `npm audit` post-install reported "found 0 vulnerabilities", but a follow-up `npm audit` shows the `@excalidraw/mermaid-to-excalidraw` mermaid/uuid chain is still in the tree (4 moderate, all the same upstream-blocked entries tracked in [dependency-watch.md](dependency-watch.md)). No regression vs 0.5.0 — the `npm install` "0 vulnerabilities" line refers only to vulnerabilities introduced by *that install*, not the cumulative tree.
- ✅ **`ai-hwaccel 1.2` API breakage repaired** — `AcceleratorRegistry::available()` and `::by_family()` now return iterators directly; `crates/sy-core/src/hwprobe/mod.rs` adjusted.
- ✅ **38 clippy lints cleaned** — bulk via `cargo clippy --fix` (collapsible `if let` chains, `or_insert_with` defaults, `operation has no effect`, `trim before split_whitespace`, immediately-dereferenced refs); manual fixes for 3× `from_str` → `parse_or_default` rename in `orchestration/{council,swarm}.rs` (avoiding `std::str::FromStr` shadowing) and 1× identical-blocks merge in `routes/health.rs`. `cargo clippy --all-features --all-targets -- -D warnings` is now silent.
- ✅ **5 rustdoc warnings fixed** — `<https://...>` URL wrapping in 3 sites, ``` `<uuid>` ``` HTML escaping in `routes/ws_collab.rs`, intra-doc link `[`load`]` → `[`Self::load`]` in `types/config.rs`. `RUSTDOCFLAGS="-D warnings" cargo doc` clean.
- ✅ **Pre-existing `cargo fmt` drift fixed** in 4 files (`state.rs`, `routes/models.rs`, `types/config.rs`, `tests/local_network.rs`) plus follow-on drift introduced by `clippy --fix`.
- ✅ **Repo hygiene** — `.gitignore` now covers `.claude/` (per-machine Claude Code state) and the stray repo-root `secureyeoman-edge` build artifact. Both untracked from the index. Two leaked auto-memory files (`.claude/.../memory/feedback_no_gh.md`, `project_theme_sync.md`) removed from the index. *History rewrite is a separate decision — see P0 below.*
- ✅ **`crates/deny.toml` added** — `cargo deny check` now passes (`advisories ok, bans ok, licenses ok, sources ok`). License allow list documents AGPL/GPL-3.0-only as compatible with our distribution; permissive families enumerated; `RUSTSEC-2023-0071` ignored with rationale.
- ✅ **`crates/.cargo/audit.toml` added** — `cargo audit` exits clean with the same RUSTSEC-2023-0071 ignore.

### Remaining P0 — must close before 0.5.1 tag

- [ ] **Delete legacy `packages/core/`** — 113 MB of orphan TS source. No package imports `@secureyeoman/core` (verified). *Active references that block a naive `rm -rf`:*
  - `Dockerfile.dev:96` and `scripts/build-binary.sh:112` still copy `packages/core/src/storage/migrations/*.sql` into the runtime image / binary. Rust `sy-core` has its own migrations under `crates/sy-core/src/db/migrations/` — relocate the SQL or fold it in, then update the COPY paths.
  - `scripts/build-binary.sh:138, 161` reference `packages/core/src/cli.ts` and `packages/core/src/agent/cli.ts` for the legacy Bun-compiled paths (lines around them are commented out, but the file still references them). Verify and remove.
  - `.github/workflows/release-binary.yml:133` uses `packages/core/dist/cli.js` for SBOM generation — port to a Rust equivalent or invoke from the live binary.
  - `.github/workflows/ci.yml:74` uploads `packages/core/coverage/lcov.info` — remove the step.
  - `scripts/release.sh:69` and `scripts/set-version.sh:18` enumerate `packages/core/package.json` in the version-set list — drop it.
  - `scripts/check-code.sh:23` falls back to `packages/core/tsconfig.json` for non-dashboard/non-shared TS files — switch fallback or delete the branch.
  - After all references are migrated, `git rm -r packages/core` and confirm `npm ci && npm run build && docker compose --env-file .env.dev up` still succeed.
- [ ] **Decide on git-history rewrite for the leaked files** — `secureyeoman-edge` (7.2 MB binary, commit `e87be08c`), `.claude/projects/.../feedback_no_gh.md` and `project_theme_sync.md` (commit `c414a892`) are out of `HEAD` but still in history. Pre-public-tag is the right time to `git filter-repo` if we're going to. Decision pending; if we do, force-push the rewritten history before any external consumers exist.
- [ ] **Marketplace seeding regression** (P0, ship-blocker carried over from 0.5.0 prep) — see [Marketplace seeding regression](#marketplace-seeding-regression) below.

### Remaining P1 — finish in 0.5.1 cycle, do not block tag if scoped out

- [ ] **`vi.mock` hoisting in `packages/mcp/src/tools/network-tools.test.ts`** — 8 calls inside `beforeEach` blocks emit Vitest deprecation warnings ("will become an error in a future version"). Tests pass today. Refactor: hoist a single `vi.mock('node:child_process', …)` and `vi.mock('ssh2', …)` to module scope with `vi.fn()` placeholders, set per-test behavior with `vi.mocked(execFile).mockImplementation(…)` in each `beforeEach`. Verify all 1235 MCP tests still pass.
- [ ] **React-19 `eslint-plugin-react-hooks@7` warnings (68)** — covered by the existing [Defensive-guard audit (dashboard)](#defensive-guard-audit-dashboard) entry; this is the breakdown by rule:
  - 32× `react-hooks/set-state-in-effect` (cascading-render risk)
  - 28× `react-hooks/refs` (ref access during render — bypasses re-renders)
  - 3× `react-hooks/immutability`, 3× `react-hooks/exhaustive-deps`
  - 2× `react-hooks/purity`, 1× `preserve-manual-memoization`, 1× `incompatible-library`
  - Hot files: `AgentWorldWidget.tsx` (20), `EditorPage.tsx` (12), `ExcalidrawWidget.tsx` (7), `AdvancedEditorPage.tsx` (4), `PersonalTab.tsx` (4). Refactor to refs-via-callback / state-via-ref-update or move side effects to event handlers per the React 19 guidance the rule cites.
- [ ] **Major Rust dep bumps deferred during checkpoint** — these need ecosystem coordination:
  - `bote 0.50 → 0.92` (two duplicate transitive copies of bote already in the lock graph at 0.91/0.92; resolve by bumping our spec)
  - `shabda 1.0 → 2.0`, `shabdakosh 1.0 → 2.0`, `svara 1.1 → 2.0` (dhvani G2P/TTS family — coordinate with dhvani own bump; current `dhvani 1.1` still pulls 1.x of these via lockfile)
  - `jni 0.21 → 0.22` (Android FFI; not on a current code path in `sy-core` but appears via wasmtime tree)
  - `tokio-tungstenite 0.28 → 0.29` blocked while we're on `axum 0.8.x`
- [ ] **`cargo deny` advisories DB lag** — `deny.toml` ignores `RUSTSEC-2023-0071` but cargo-deny's bundled advisory DB hasn't seen the advisory yet, so it warns `advisory-not-detected`. Cosmetic; revisit when deny refreshes.
- [ ] **`packages/dashboard/package.json` and `packages/mobile/package.json` vitest spec drift** — root specifies `vitest@^4.1.5`, dashboard spec is `^4.0.18`, mobile is `^3`. Lockfile resolves correctly today; align the specs to avoid surprise on the next install.

---

### Defensive-guard audit (dashboard)

A runtime crash in `SandboxConfigPanel` during 0.5.0 release prep traced to the `obj?.field.map(…)` pattern: the `?.` short-circuits on `obj` but `.field.map` runs unguarded when `obj` is defined and `field` is `undefined`. Ten sites were patched by hand. Remaining work:

- [ ] **Enforce the guard pattern** — Add an ESLint rule flagging `\?\.[A-Za-z_][A-Za-z_0-9]*\.map\(` or adopt `@typescript-eslint/no-unsafe-optional-chaining` so new crashes of this shape fail CI. Without the rule, regressions will keep landing.
- [ ] **Type-narrowing-via-side-effect audit** — TypeScript narrowed `capabilities?.technologies.map(…)` such that `capabilities` was treated as non-`undefined` *inside* the map body. Scan for other places where a chained guard on one level masks a needed guard at another.

### Marketplace seeding regression

> ✅ **RESOLVED in 0.5.1 (2026-06-07).** The 46 first-party items (skills + themes + personalities) are embedded from the canonical TS `BUILTIN_SKILLS` list and seeded idempotently (`source='builtin'`, stable id, `ON CONFLICT DO NOTHING`) by `db::seed::seed_marketplace_skills`, called from `seed_defaults` on first boot. The history below is retained for context.

Reported during 0.5.0 release prep: marketplace items disappeared from the running instance. Likely a seed drift during the TS→Rust migration.

> **Note on scope:** this is a *marketplace* issue, not a community one. Marketplace is the DB-seeded, curated content source. Community is a repo sync from `secureyeoman-community-repo`, pulled dynamically — it does not need seeding, so "missing community content" would be a sync-health issue tracked separately.

**Confirmed root cause** (verified against a clean `docker compose down -v` + `build --no-cache` + `up` on 2026-04-18): the three SQL migrations in `packages/core/src/storage/migrations/` create the `marketplace.skills` table but contain **no seed `INSERT`s**. The personality + agent seeds fire (FRIDAY, T.Ron, 9 built-in agent profiles), but no first-party marketplace rows are ever written. All `INSERT INTO marketplace.skills` calls in the Rust `sy-core` are in dynamic code paths (`routes/marketplace.rs` user-install flow, `db/marketplace.rs` programmatic helpers) — nothing runs at boot. The TS package had a marketplace seed module that wasn't ported during the Rust migration.

Note on schema: `marketplace.skills` is a unified table for both content sources, distinguished by a `source` column (`'marketplace'` | `'community'` | `'local'`). Community rows are populated by the repo-sync path and are working; only `source='marketplace'` rows are missing.

Items to work through:

- [ ] **Port the marketplace seed** — Extract the canonical list of first-party marketplace items from the TS `packages/core/src/marketplace/` seed module and wire it into a Rust `sy-core` seed function called on first boot (or as `004_marketplace_seed.sql` migration, whichever matches the project's seeding convention).
- [ ] **Parity smoke test** — Assert `SELECT COUNT(*) FROM marketplace.skills WHERE source='marketplace'` is non-zero after a fresh boot with an empty volume. Without this, a future seed regression would again go unnoticed.
- [ ] **Spot-check adjacent subsystems for the same pattern** — Skills, personalities, workflows. Personalities (FRIDAY/T.Ron) and agents (9 built-in profiles) seed correctly; verify workflows and any other marketplace-aware subsystem.

### Test-coverage gap

Every dashboard component test mocks fully-populated happy-path data. No test in the suite calls `mockResolvedValue(undefined)`, `mockResolvedValue({})`, or `mockRejectedValue(…)`. The SandboxConfigPanel crash was invisible because tests never exercise a `useQuery` returning `data: undefined` or a response shape drift.

- [ ] **Negative-path test harness** — Add a shared test helper that renders each `useQuery`-bearing component once with `data: undefined` before the first resolve. Any component that needs a loading/empty fallback will fail the harness if missing.
- [ ] **API contract tests** — 0.5.0 ships a Rust backend with a TypeScript dashboard. No test verifies the two agree on wire shape. A cheap first pass: JSON-schema snapshot of each REST response, validated against both Rust-emitted payloads and TS-consumed mocks.

### Dependency cleanup

- [ ] **zod 4 migration** — Root `overrides` pin `zod: 3.25.76` because zod 4's inference OOMs `tsc` even at 18 GB heap. Revisit once upstream type-perf work lands. Consumers currently forced to v3: `@anthropic-ai/sdk@0.90`, `openai@6.34`, `@modelcontextprotocol/sdk@1.29`, `eslint-plugin-react-hooks@7.1`. See the [dependency watch](./dependency-watch.md) entry.
- [ ] **Mermaid XSS residual** — Three moderate audit findings all trace to `@excalidraw/mermaid-to-excalidraw` hard-pinning `mermaid: 10.9.3` (vulnerable to GHSA-7rqq-prvp-x9jh). Tracked in `dependency-watch.md`. Re-check when excalidraw/mermaid-to-excalidraw releases.
- [ ] **typescript-eslint `projectService: true`** — Current config uses `parserOptions.project: [...]` array (loads full TS programs for type-aware lint). `projectService` reuses the TS language service and uses materially less memory. Would let `lint`/`typecheck` scripts drop back toward default heap.

### Rust platform expansion

- [ ] **`sy-edge` cross-compile** — 0.5.0 ships `secureyeoman-<version>-edge-linux-x64` only. arm64/armv7/riscv64 targets were in the CalVer Go build pipeline and deferred when the Go edge was retired. Options: add `cross` to the release workflow (simplest, Docker-based), or rustup target installs plus per-target linkers (faster, more setup).

### Release pipeline cleanup

- [ ] **`DT=` local vars in `release-binary.yml`** — The sign-blob and release-notes steps still set `DT="${{ steps.version.outputs.version }}"` for inline use. Works, but redundant since the CalVer→compact transform is gone. Cosmetic.
- [ ] **Orphan TS edge runtime** — `packages/core/src/edge/` is a Bun-compiled edge runtime replaced by Rust `sy-edge`. The `compile_edge_binary` function in `build-binary.sh` that called it was already removed. The directory itself is a delete candidate once we confirm no TS package still imports from it.

---

## Phase XX: QA & Manual Testing (Ongoing)

**Priority**: P3 — Ongoing. Continuous verification of features that lack automated integration coverage. Items move to Changelog when confirmed working; new regressions are added here as discovered.

### Manual Tests — Authentication & Multi-Tenancy

- [ ] **SAML SP flow** — Code complete (`sso-routes.ts`, `saml-adapter.ts`, tested). Manual verification: (1) `GET /api/v1/auth/sso/saml/:id/metadata` returns valid `<md:EntityDescriptor>` XML. (2) `GET /api/v1/auth/sso/authorize/:id` redirects to IdP with SAMLRequest. (3) Post-IdP redirect hits ACS, returns JWT. Needs live IdP (SimpleSAMLphp or Keycloak) to confirm end-to-end.
- [ ] **RLS tenant isolation** — Schema supports tenant_id. Manual verification: Create tenant B, insert scoped personality, cross-query confirms isolation. Needs multi-tenant instance to test.
- [ ] **OAuth token refresh end-to-end** — Auto-refresh implemented (`oauth-token-service.ts`, 5 min buffer). Manual verification: (1) Connect Gmail; (2) wait for expiry; (3) confirm `gmail_profile` still works; (4) Revoke in Google → confirm reconnect prompt. Needs live Google OAuth credentials.

### Manual Tests — Agent & Personality Features

- [ ] **Per-Personality Memory Scoping** — Code complete (personalityId throughout brain module, 42+ files). Manual verification: (1) Chat with T.Ron → save memory, confirm NOT in FRIDAY recall; (2) heartbeat stats differ per personality; (3) Omnipresent Mind toggle; (4) `/api/v1/brain/stats?personalityId=<id>` per-personality counts. Needs running instance with 2+ personalities.
- [ ] **AgentWorld sub-agents** — Code complete (AgentWorldWidget, AgentWorldNode in AdvancedEditor). Manual verification: delegation cards in grid/map/large views, disappear on completion.
- [ ] **Adaptive Learning Pipeline** — Code complete (`distillation-manager.ts`, `conversation-quality-scorer.ts`). Manual verification: quality scorer runs on schedule, distillation `priorityMode: 'failure-first'` ordering works.

### Manual Tests — Marketplace & Workflows

- [ ] **Skills marketplace flow** — Continued review of marketplace + community install/uninstall flow, per-personality skill injection, and sub-agent skill inheritance.
- [ ] **Workflow export/import round-trip** — Export a workflow with required integrations. Import on a fresh instance; verify compatibility warnings surface correctly for missing integrations. Install a community workflow from Marketplace → Workflows tab; verify it appears in workflow definitions.
- [ ] **Workflows & Swarms marketplace lifecycle** — Verify that after a clean rebuild: (1) Installed tab → Workflows shows zero items; (2) Installed tab → Swarm Templates shows zero items; (3) Marketplace tab → Workflows shows all YEOMAN built-ins (research-report-pipeline, code-review-webhook, parallel-intelligence-gather, distill-and-eval, finetune-and-deploy, dpo-loop, pr-ci-triage, build-failure-triage, daily-pr-digest, dev-env-provision) under "YEOMAN Workflows"; (4) Marketplace tab → Swarm Templates shows all YEOMAN built-ins (research-and-code, analyze-and-summarize, parallel-research, code-review, prompt-engineering-quartet) under "YEOMAN Swarm Templates"; (5) Click Install on a workflow → it now appears in Installed tab; (6) Community tab → Sync pulls in community workflows and swarm templates from the configured repo path; (7) Community tab → Workflows and Community tab → Swarm Templates show the synced items; (8) Search filters work across all views. Architecture note: builtin workflows are seeded with `createdBy: 'system'` and builtin swarms with `isBuiltin: true` — these flags are how Installed tab excludes them. Community sync wires `workflowManager` and `swarmManager` into `MarketplaceManager` via `setDelegationManagers()` (called from `bootDelegationChain()`).
- [ ] **Catalog section review** — Further review of the Catalog page (Skills, Workflows, Swarm Templates) across all tabs (Personal, Marketplace, Community, Installed). Assess UX, labelling, install/uninstall flows, filtering, search, sync behaviour, and any missing functionality before considering the section production-ready.

### Manual Tests — License Gating (Phase 106)

- [ ] **Enforcement off (default)** — Start without `SECUREYEOMAN_LICENSE_ENFORCEMENT`. Verify all enterprise features (distillation, SSO admin, tenants, CI/CD webhook, alert rules) return normal responses — no 402s. Dashboard shows no lock overlays on TrainingTab, ConnectionsPage CI/CD section, or AlertRulesTab.
- [ ] **Enforcement on, no license** — Set `SECUREYEOMAN_LICENSE_ENFORCEMENT=true`, no `SECUREYEOMAN_LICENSE_KEY`. POST to `/api/v1/training/distillation/jobs` → 402 with `{ error: 'enterprise_license_required', feature: 'adaptive_learning' }`. Same for SSO admin routes (POST/PUT/DELETE `/api/v1/auth/sso/providers`), tenant CRUD, CI/CD webhook, and alert write routes. GET read-only routes still return 200.
- [ ] **Enforcement on, valid enterprise key** — Set `SECUREYEOMAN_LICENSE_ENFORCEMENT=true` with a valid enterprise license key that includes all features. All guarded routes return normal responses. Dashboard `<FeatureLock>` components render children without lock overlay.
- [ ] **Dashboard lock overlay** — With enforcement on and no license: navigate to Training tab → distillation/finetune sub-tabs show dimmed content with lock icon, "Adaptive Learning Pipeline" label, and "Upgrade to Enterprise" link. Connections page CI/CD section shows lock overlay. Alert rules create/edit forms show lock overlay.
- [ ] **Provider cost tracking** — With multi-account providers configured, verify cost dashboard still loads and CSV export works (Phase 112 regression check after Phase 106 wiring changes).

### Manual Tests — Desktop & Editor

- [ ] **Docker MCP Tools** — Code complete (`docker-tools.ts`: docker_ps, docker_logs, docker_exec, registered in manifest). Manual verification: Enable `MCP_EXPOSE_DOCKER=true` (socket mode), verify listing/logs/exec. Test DinD mode via `MCP_DOCKER_MODE=dind` + `MCP_DOCKER_HOST`.
- [ ] **Canvas Workspace** — Code complete (AdvancedEditorPage, CanvasWidget, canvas-layout, canvas-event-bus, canvas-registry). Manual verification: widget CRUD, resize, localStorage persistence, frozen-output pinning, worktree selector.
- [ ] **Unified editor features** — Manual verification: Brain toggle + memory capture, ModelWidget switch, Agent World panel views, MultiTerminal tabs, `allowAdvancedEditor` redirect.

---

## License Up: Tier Audit & Enforcement Activation

**Priority**: P4 — Post-launch. Turn on the switch after the product is public and solid.

**Prerequisites**: Phase 106 (license gating infrastructure — ✅).

### Planned Pricing

| Tier | Price | Target |
|------|-------|--------|
| Community | Free | Hobbyists, evaluators |
| Pro | $20/yr | Developers, power users |
| Solopreneur | $100/yr | Solo operators, consultants — all enterprise features for individuals |
| Enterprise | $1,000/yr | Organizations, regulated industries — multi-tenancy + SLA |
| Support | Additional | Priority support, onboarding, custom integrations — priced by scope |

**Note**: The current codebase has 3 tiers (`community | pro | enterprise`). The Solopreneur tier is a licensing distinction (enterprise features, single-tenant, no SLA), not a code-level tier. Implementation options: (a) map Solopreneur to `enterprise` tier with a `seats: 1` claim, or (b) add `solopreneur` as a 4th `LicenseTier` value. Decision deferred to implementation.

### Tasks

- [ ] **Enable enforcement** — Set `SECUREYEOMAN_LICENSE_ENFORCEMENT=true` as default in `.env.example`. Update all env templates. Currently defaults to `false` for development.
- [ ] **Solopreneur tier definition** — Define Solopreneur as enterprise-feature-equivalent with single-tenant / single-seat constraints. Decide on `LicenseTier` implementation approach (see note above).
- [ ] **Grace period** — Existing community installs get 30-day grace period when enforcement activates, with countdown banner.
- [ ] **Pricing page** — Public-facing pricing comparison page for secureyeoman.ai. Feature breakdown per tier, FAQ, upgrade flow.
- [ ] **Payment provider setup** — Select replacement provider (Polar, Paddle, or Stripe direct), create store, products, and variants. Configure webhook URL pointing to licensing service. Set checkout URL env vars in dashboard build.

### Repository & Public Identity (P4 — do at launch time)

- [ ] **Transfer repositories to `yeoman.maccracken`** — Transfer `secureyeoman` and `secureyeoman-community-repo` to the `yeoman.maccracken` GitHub account. This will be the public-facing org. Update all references: README badges, install scripts (`curl -fsSL https://secureyeoman.ai/install`), Docker image paths (GHCR), Helm chart repo URLs, community sync default URL, and CI/CD workflow `GITHUB_REPOSITORY` refs.
- [ ] **Post-transfer fixups** — Update `package.json` repository fields, CHANGELOG links, ADR cross-references, dashboard "Report Issue" URLs, and any hardcoded GitHub URLs in docs or code. Verify GitHub redirect from old org works for existing clones.

### Website Redesign — secureyeoman.ai (P4 — v1.0.0 launch)

Current site demonstrates depth but overwhelms. Redesign for the 1.0.0 launch.

**Narrative arc** (current is backwards — features first, philosophy last):
- [ ] **Hero: philosophy first** — Lead with sovereignty, local-first, zero CVEs. "Your AI, your rules, your hardware." Move "485 tools" stat below the fold.
- [ ] **Section 2: the problem** — OpenClaw crisis narrative (currently buried at bottom). Why sovereignty matters *now*. This builds trust before feature depth.
- [ ] **Section 3: how we solve it** — 3–4 pillars max (privacy, security, intelligence, voice). Not 11 categories with bullet lists.
- [ ] **Section 4: see it in action** — Screenshot/demo of dashboard. One "Get Started" CTA.
- [ ] **Section 5: feature depth** — Accordion/progressive disclosure for the full capability list. Developers who want depth can expand; casual visitors aren't overwhelmed.

**UX fixes:**
- [ ] **Single primary CTA** — "Get Started" in hero only. "View on GitHub" secondary. Remove scattered duplicate CTAs.
- [ ] **Comparison table → cards** — Replace 5-column table with card-based "vs OpenClaw" layout. Mobile-friendly, progressive disclosure per feature.
- [ ] **Deployment tabs → single recommended** — Show `curl | sh` as default. "Other install methods" as expandable section.
- [ ] **Separate developer/executive paths** — Developer lands on main page. Executive briefing becomes `/enterprise` or linked from a single "For Enterprise" button.

**Technical:**
- [ ] **Lazy-load below-fold sections** — Feature lists, comparison, executive briefing don't need to render on initial load.
- [ ] **Reduce JS weight** — Audit bundle size. Static sections don't need React hydration.
- [ ] **Mobile-first responsive** — Test comparison section, deployment tabs, feature lists at 375px.

### Payment & Monetization (P4 — post-launch)

**Architecture**: Separate `secureyeoman-licensing` repo (`../secureyeoman-licensing/`). Lightweight Fastify + SQLite service that receives payment provider webhooks, mints Ed25519-signed keys, and serves key retrieval API. SY dashboard opens provider checkout in-app, polls licensing service for key after purchase, auto-applies via `POST /api/v1/license/key`.

- [ ] **Payment provider account setup** — Select provider (Polar, Paddle, or Stripe), create store, 3 products (Pro/Solopreneur/Enterprise), configure webhook URL, obtain API key + signing secret. ~~LemonSqueezy rejected (2026-03-18, chargeback risk).~~
- [ ] **End-to-end test** — Test mode purchase → webhook → key mint → dashboard retrieval → auto-apply → enforcement check. Confirm round-trip.
- [ ] **Renewal & lifecycle** — Auto-renewal reminders (30/14/7 days before expiry). Handle `subscription_expired` / `subscription_payment_failed` webhooks. Upgrade path: pro-rate remaining time when moving up tiers.
- [ ] **Refund handling** — `order_refunded` webhook → revoke license key in records DB. Key continues to validate offline (Ed25519 is self-contained) but records DB tracks revocation for audit.
- [ ] **Key re-delivery** — "Lost your license key?" flow in dashboard: enter email → licensing service returns key preview → email verification → full key delivered.

### $YEOMAN Token — Crypto Payment Channel

*Speculative — demand-gated. Introduces a crypto payment option alongside traditional fiat. NOT a prerequisite for launch.*

- [ ] **Token design** — ERC-20 or Solana SPL token ($YEOMAN). Fixed supply or capped inflation. Utility: license purchases, marketplace skill tips, community governance votes. NOT a security — no profit-sharing, no staking rewards, pure utility.
- [ ] **License purchase with $YEOMAN** — Accept $YEOMAN as payment for Pro/Solopreneur/Enterprise licenses at a discount (e.g. 20% off vs fiat). Smart contract escrow: tokens held until license key delivered. On-chain receipt serves as proof of purchase.
- [ ] **Community marketplace tipping** — Skill authors can receive $YEOMAN tips from users. Displayed on skill cards in marketplace. Incentivizes community contribution without SY taking a cut.
- [ ] **Governance voting** — $YEOMAN holders vote on roadmap priorities (feature requests, integration order). Lightweight on-chain governance — advisory, not binding. Builds community ownership.
- [ ] **Token launch logistics** — Fair launch (no VC allocation, no pre-mine beyond treasury). DEX liquidity pool. Community airdrop to early adopters and community skill authors. Legal review for utility token classification per jurisdiction.

---

## E2E Test Expansion

**Priority**: P1 — Quality. Currently 18 files / ~112 tests. Keep expanding alongside feature work.

---

## Ecosystem Crate Migration

*Replace hand-rolled infrastructure with shared ecosystem crates. Reduces maintenance surface and aligns primitives across SY, Ifran, and sibling projects.*

### Ecosystem Crate Status

*All ecosystem crates called directly from sy-core — zero serialization overhead.*

| Crate | Version | Integration |
|-------|---------|-------------|
| majra | 1.0.1 | pub/sub (3 tiers), ratelimit, heartbeat, barrier, queue |
| szal | 1.0.1 | condition eval, template resolution, flow validation, step builder |
| bote | 0.50.0 | tool registry, schema validation, JSON-RPC protocol |
| bhava | 2.0.0 | personality engine, traits, mood, spirit + psychology (bodh), sociology (sangha), physiology (sharira), microbiology (jivanu) |
| agnosai | 1.0.0 | crew orchestration, model routing, agent scoring |
| ai-hwaccel | 1.0.0 | hardware accelerator detection (GPU, TPU, NPU, ASIC) via sy-hwprobe |
| dhvani | 1.0.0 | voice synthesis (svara), G2P (shabda), audio DSP, analysis, PCM→WAV. TTS/STT providers + bhava trait→prosody mapping |

### Remaining

- [ ] **Full workflow DAG delegation to szal** — Currently szal handles condition evaluation and template resolution. Full DAG execution (topological sort + tier-based parallel scheduling) still runs in TS. Moving execution to szal requires the 24 step type handlers to be callable from Rust, which happens when more of the stack migrates. Incremental — not blocked.
- [ ] **A2A relay → majra relay** — SY's single HTTP POST transport → majra `Relay` with dedup, sequencing, connection pooling. Deferred until A2A transport layer migrates to Rust.

## Engineering Backlog

Non-phase items tracked for future improvement. Pick up opportunistically or when touching adjacent code.

---

## Ecosystem Projects — Cross-Project Integration

*SY integrations with sibling projects in the SecureYeoman ecosystem. Each project has its own repo but SY provides MCP tools, dashboard widgets, and service discovery.*

### Rasa Image Editor

- [ ] **Vision pipeline integration** — Connect Rasa's AI engine to SY's multimodal pipeline for image understanding, OCR, and visual QA.

### Tazama Video Editor

- [ ] **Docker image setup** — Dockerfile and docker-compose entries. Port TBD.
- [ ] **Ecosystem service registration** — Service discovery, docker-compose, contributing docs.
- [ ] **MCP tools (native)** — `tazama_*` tool set for programmatic video editing from chat and workflows.
- [ ] **Vision pipeline bridge** — Connect video analysis to SY's multimodal pipeline and DeepLens edge camera feed.

### Ifran LLM Controller — Integration Tests

*Requires full system stack (SY + Ifran + PG + Docker).*

- [ ] **Training delegation lifecycle** — Submit job, poll status through `pending→running→completed`. Requires a model loaded in Ifran + dataset.
- [ ] **gRPC bridge connectivity** — Verify `ReportProgress` stream and `RegisterCompletedModel`. Requires full SY+Ifran stack with gRPC ports.
- [ ] **SSE streaming relay** — Verify job log streaming end-to-end. Requires active training job.
- [ ] **Model pull lifecycle** — SSE progress events for marketplace pull. Requires model registry configured in Ifran.

### SY-AAS-AGNOS Convergence

*Ambitious unification of SecureYeoman, Agnostic Agent System, and AGNOS. Depends on all three projects being stable.*

- [ ] **Unified dev environment** — Shared `docker-compose.unified.yml` with networking across all three projects.
- [ ] **Unified SSO** — OAuth2/OIDC federation: single identity provider, shared sessions.
- [ ] **Cross-project agent delegation** — SY brain → A2A → Agnostic agent worker → AGNOS sandbox → results → brain. Bidirectional.
- [ ] **Unified agent marketplace** — Single marketplace spanning SY skills, Agnostic agent capabilities, and AGNOS native agents.
- [ ] **AgnosAI integration** — Wire-compatible A2A when Agnostic migrates from CrewAI to AgnosAI (Rust-native orchestration).

---

## Future Features — Demand-Gated

Items below are planned but demand-gated or lower priority. Grouped by theme. Implementation order will be determined by adoption signals and user demand.

---

### Trading Dashboard Enhancements

*Improve the financial widgets and live trading experience. Builds on the existing market data proxy, BullShift integration, and chart components.*

- [ ] **BullShift WebSocket streaming** — Replace simulated trade events with real WebSocket feed from BullShift server. Connect to 5 channels (trades, quotes, order updates, positions, account). Requires BullShift WebSocket endpoint implementation.
- [ ] **Multi-symbol watchlist** — Persistent watchlist with configurable symbols. Sparkline mini-charts per symbol. Drag-to-reorder. Saved in localStorage.
- [ ] **Order execution panel** — Place market/limit orders directly from the trading widget. Confirmation dialog, position size calculator, risk/reward preview. Wired to `bullshift_submit_order` MCP tool.
- [ ] **Portfolio P&L chart** — Time-series portfolio value chart using WaterfallChart and RiskReturnScatter components. Unrealized vs realized P&L breakdown.
- [ ] **Intraday charts** — Sub-daily candlestick resolution (1m, 5m, 15m, 1h). Requires intraday market data provider support (Finnhub WebSocket or AlphaVantage intraday endpoints).
- [ ] **Technical indicators** — EMA, RSI, MACD, Bollinger Bands overlay on candlestick chart. Configurable indicator panel below the main chart.
- [ ] **Alert integration** — Visual alert markers on chart (price levels, triggered alerts from `bullshift_create_alert`). Toast notifications when alerts fire.
- [ ] **Entity Eye state from trading** — Wire Entity Eye state to trading activity: active when orders executing, thinking when analyzing, training when backtesting.

---

### Developer Ecosystem & Community Growth

*Only way to close the skill gap at scale.*

- [ ] **Skill SDK** — `npx create-secureyeoman-skill` scaffolding tool. Generates skill directory with schema, test harness, README template, and CI config.
- [ ] **Skill testing framework** — Mock MCP context, simulate tool calls, assert outputs. `SkillTestRunner` class.
- [ ] **Skill submission pipeline** — `secureyeoman skill publish` validates schema, runs tests, opens PR to community repo.
- [ ] **API client libraries** — Python (`secureyeoman-py`) and Go (`secureyeoman-go`) SDKs from OpenAPI spec.
- [ ] **Interactive tutorials** — Guided onboarding flows in dashboard: "Create your first skill," "Set up SSO," "Build a workflow."

---

### Community Marketplace

*Demand-Gated — implement when marketplace adoption justifies the investment.*

- [ ] **Scheduled Auto-Sync** — Optional cron-style background sync from the configured community repo (configurable interval, off by default).
- [ ] **Hosted Discovery API** — A lightweight read-only API for browsing available community skills without cloning.
- [ ] **Cryptographic Skill Signing** — Authors sign skills with a keypair; SecureYeoman verifies signatures before installing. Reject unsigned skills in strict mode.
- [ ] **Skill Ratings & Downloads** — Community feedback mechanism (stars, download counts) surfaced in the marketplace UI.

---

### Native Clients — Desktop

*Phase 91 delivered the Tauri v2 desktop scaffold (complete 2026-03-01).*

- [ ] **Auto-update** — Tauri updater for desktop (delta bundles via `tauri-plugin-updater`).
- [ ] **Desktop system tray enhancements** — Quick-access menu: active personality selector, last conversation shortcut, toggle notifications. Global keyboard shortcut to focus the window.

---

### Phase 17: Native Mobile Experience

*Strategy: Build a sovereign, native-first mobile app — not just a WebView wrapper. Differentiator vs. OpenClaw (messaging-as-interface) and generic SaaS AI apps. SecureYeoman mobile = your private AI agent in your pocket, running on your infrastructure, secured by your rules. Capacitor v8 scaffold exists (2026-03-01); this phase builds it into a production-grade native app.*

#### 17A — Foundation & Secure Connectivity

*Core infrastructure that all subsequent mobile work depends on.*

- [ ] **Tailscale / WireGuard connectivity layer** — Capacitor plugin or embedded Tailscale client for secure tunnel to private SY instances behind home networks or enterprise firewalls. Zero-config for Tailscale users (authenticate once, auto-discover SY instance via MagicDNS). Fallback: manual WireGuard config import. This is the killer feature — no port forwarding, no public exposure, just open the app and you're connected to your sovereign instance.
- [ ] **Biometric authentication** — Face ID / Touch ID / fingerprint via `@capacitor/biometrics`. Gate app access and sensitive operations (API key viewing, personality deletion, license management). Store JWT refresh token in secure enclave (iOS Keychain / Android Keystore), unlock with biometric.
- [ ] **Push notification bridge** — Firebase Cloud Messaging (Android) + APNs (iOS) via `@capacitor/push-notifications`. Core sends notification → new `PushDispatcher` in notification fan-out chain → device token registry (per-user, per-device) → platform-specific push. Notification types: proactive suggestions, security alerts, heartbeat warnings, task completions, agent messages. Tap-to-action deep links.
- [ ] **Device token management** — `POST /api/v1/devices/register` endpoint. Tracks device ID, platform, push token, last seen. Auto-cleanup stale tokens (30 days inactive). Multi-device support — user can have phone + tablet registered simultaneously.
- [ ] **Secure local storage** — `@capacitor/preferences` for non-sensitive settings. `@capacitor-community/secure-storage` for tokens, keys, connection profiles. Encrypted at rest on both platforms.

#### 17B — Core Mobile UX

*Mobile-optimized interface — not just responsive web, but native-feeling interactions.*

- [ ] **Mobile navigation shell** — Bottom tab bar (Chat, Dashboard, Notifications, Settings) replacing sidebar. Gesture navigation (swipe between conversations, pull-to-refresh). Native status bar integration, safe area handling, haptic feedback on key actions.
- [ ] **Mobile chat interface** — Optimized chat view: native keyboard handling, quick-reply suggestions, voice input button, attachment picker (camera, files, photos). Streaming responses with typing indicator. Conversation list with search, swipe-to-archive.
- [ ] **At-a-glance dashboard** — Compact mission control: system health card, active personality, unread notification badge, recent agent activity feed, cost summary. Not a port of the full desktop dashboard — a purpose-built mobile overview.
- [ ] **Notification center** — Native notification grouping (by source: security, proactive, agents, system). In-app notification tray with mark-read, dismiss, action buttons. Proactive suggestion cards with approve/dismiss inline. Badge count on app icon.
- [ ] **Mobile settings** — Connection profile management (add/switch SY instances), notification preferences (per-type toggle, quiet hours), biometric toggle, theme selection (subset of 45 themes optimized for OLED), Tailscale/WireGuard status.

#### 17C — Offline-First & Sync

*Leverage existing IndexedDB/offline infrastructure in dashboard, extend with native capabilities.*

- [ ] **Offline conversation cache** — Cache recent conversations in device storage. Read-only access when disconnected. Pending message queue (compose offline, send on reconnect). Sync status indicator per conversation.
- [ ] **Background sync** — `@capacitor/background-task` for periodic sync when app is backgrounded. Pull new notifications, sync conversation updates, refresh proactive suggestions. Respect battery optimization (adaptive sync frequency).
- [ ] **Cross-device sync** — Conversation history, personality state, and notification preferences synced across devices via the existing REST API. Offline-first with conflict resolution (last-write-wins for preferences, merge for conversations).
- [ ] **Connection resilience** — Graceful handling of Tailscale tunnel drops (auto-reconnect with exponential backoff). Visual connection state indicator (connected / reconnecting / offline). Queue critical actions during brief disconnects.

#### 17D — Native Device Integration

*Capabilities that only a native app can provide — the reason this isn't just a PWA.*

- [ ] **Voice interaction** — Push-to-talk or wake-word activation via `@capacitor-community/speech-recognition`. Stream audio to SY for transcription → agent processing → TTS response via device speaker. Hands-free mode for driving/cooking.
- [ ] **Camera & document capture** — Snap a photo or scan a document → send to agent for analysis. OCR pipeline: capture → `@capacitor/camera` → upload to SY → vision model analysis → response. Useful for: receipt scanning, whiteboard capture, code screenshot analysis.
- [ ] **Share extension** — iOS Share Sheet / Android Share Intent target. Share URLs, text, images, files from any app directly into SY for agent processing. "Send to SecureYeoman" as a system-wide action.
- [ ] **Widgets** — iOS WidgetKit / Android App Widgets. At-a-glance: system health status, unread notification count, quick-chat launcher, active personality display. Home screen presence without opening the app.
- [ ] **Shortcuts & automation** — iOS Shortcuts / Android Quick Settings tile. "Ask SecureYeoman" Siri Shortcut. Tasker/Automate integration on Android. Quick Settings tile for toggle notifications or switch personality.

#### 17E — App Store & Distribution

*Production readiness for public distribution.*

- [ ] **App icons & splash screens** — Production icon set (all required sizes for iOS + Android). Adaptive icons (Android 13+). Splash screen with brand animation.
- [ ] **App Store compliance** — Privacy nutrition labels (iOS), data safety section (Android). Review guideline compliance: no remote code execution claims, proper content ratings, privacy policy URL. TestFlight / Play Console internal testing tracks.
- [ ] **Release pipeline** — CI workflow: `npm run build:dashboard` → `npx cap sync` → Fastlane (iOS) / Gradle (Android) → TestFlight / Play Console upload. Triggered by SemVer tag. Signing key management via CI secrets.
- [ ] **Auto-update** — App Store / Play Store release channels. In-app update prompts for critical updates (`@capacitor/app-update` or platform APIs). Version compatibility check against SY server version.

---

### Shipping & Logistics Intelligence

*Unified shipping operations via MCP integrations and native tools. Manage multi-carrier shipping, track packages, optimize fulfillment, and automate logistics workflows from within SecureYeoman.*

- [ ] **Logistics MCP tools (native)** — Built-in `logistics_*` MCP tool set: `logistics_track_shipment`, `logistics_get_rates`, `logistics_create_label`, `logistics_address_verify`. Unified interface across carriers via EasyPost or direct carrier APIs. Registered in `manifest.ts`, gated by `exposeLogisticsTools` flag.
- [ ] **Shipment tracking dashboard widget** — Real-time package tracking card: carrier, status, ETA, map visualization. Multi-shipment list with filter/search. Status change notifications via proactive engine.
- [ ] **Shipping workflow templates** — Pre-built workflows: order-to-ship automation (new order → rate shop → cheapest label → tracking notification), return processing, batch label generation, carrier performance comparison.
- [ ] **Address validation integration** — Validate and autocorrect shipping addresses before label purchase. Surface suggestions in chat and dashboard. Reduces failed deliveries.
- [ ] **Carrier analytics** — Cost-per-shipment, delivery time, and exception rate dashboards across carriers. Historical trend analysis. Carrier performance scoring to inform rate shopping decisions.

---

### Enterprise Upgrades

*Security hardening and compliance capabilities for enterprise deployments.*

- [ ] **HSM Integration** — Hardware Security Module integration for key management. PKCS#11 interface for signing, encryption, and key rotation. Cloud HSM support (AWS CloudHSM, Azure Dedicated HSM, GCP Cloud HSM).

### Compliance & Certification

*Standards certification for enterprise adoption. SY's architecture already enforces most controls structurally — the work is formalizing documentation and passing audits.*

**Tier 1 — Must-haves for enterprise adoption:**

- [ ] **ISO/IEC 42001 — AI Management System (AIMS)** — First priority. SY already meets most requirements architecturally: bhava separates personality computation from LLM rendering (explainable AI), sy-audit provides tamper-evident decision logging, sy-privacy handles DLP/PII, sy-sandbox enforces execution boundaries, OPA/Rego policies govern intent. Work: formalize AIMS scope statement, document risk assessment process for AI components, write control procedures mapping existing architecture to 42001 clauses, engage certification body.
- [ ] **SOC 2 Type II** — US enterprise procurement gate. Security, availability, confidentiality trust service criteria. Work: define control objectives, map existing security architecture (sy-crypto, sy-tee, sy-sandbox, audit chain) to SOC 2 criteria, establish continuous monitoring evidence, engage auditor for observation period (3–12 months).
- [ ] **ISO/IEC 27001 — Information Security Management System (ISMS)** — International security credibility. Heavy overlap with SOC 2 prep. Work: ISMS scope, risk treatment plan, Statement of Applicability (SoA), internal audit cycle.

**Tier 2 — Builds trust, opens regulated markets:**

- [ ] **ISO 9001 — Quality Management System** — Proves repeatable development and delivery processes. Lighter lift once 27001 is in place — shared management system structure.
- [ ] **ISO 27701 — Privacy Information Management** — Extension of 27001 for GDPR alignment. Maps to sy-privacy DLP capabilities and data lifecycle controls.
- [ ] **EU AI Act compliance** — Becoming mandatory for AI systems in EU market. ISO 42001 maps well to EU AI Act requirements. Document risk classification (SY likely "limited risk" category), transparency obligations, and human oversight mechanisms.

**Tier 3 — Differentiators for specific markets:**

- [ ] **ISO 27017 — Cloud Security Controls** — If SY is offered as hosted/SaaS.
- [ ] **ISO 27018 — PII Protection in Public Cloud** — Extends 27017 for personal data.
- [ ] **FedRAMP** — US federal government market. Heavy lift but massive TAM. Requires sponsoring agency.

---

### Infrastructure & Platform

*Demand-Gated — implement once operational scale or compliance requirements justify the investment.*

- [ ] **ELK Integration** — Eclipse Layout Kernel for advanced constraint-based graph layouts. ~2 MB WASM bundle — justified only when graph complexity outgrows Dagre.
- [ ] **Agent World — Configurable FPS** — fps slider in card settings popover (1–16 fps), persisted in layout config. Only worthwhile if users report animation overhead on low-power devices.
- [ ] **Photisnadi in SY container** — Photisnadi baked into agnosticos base image or run as separate container. User choice via `PHOTISNADI_ENABLED` flag. When embedded, supervisord manages Photisnadi process; when external, SY proxies via SUPABASE_URL.
- [ ] **Task tracker widget — third-party aggregator** — Extend TaskTrackerWidget to aggregate tasks from third-party trackers (Photisnadi, Trello, Jira, Linear, Todoist, Asana) via adapter interface. Unified view of all external task sources.

---

### IDE Extensions

*Lower-priority IDE features. Implement when the core IDE experience is stable and user demand warrants.*

- [ ] **Plugin / extension system** — Third-party editor extensions.

---

### Simulation Engine — Enterprise

*Enterprise-tier licensed feature (`simulation`). A general-purpose live simulation framework built on existing personality, cognitive memory, workflow, voice, and multi-agent subsystems. Subsets below target specific simulation domains.*

#### Game NPCs

- [ ] **Game state adapter interface** — Pluggable adapter that ingests world/entity state from external game engines (Unity, Unreal, Godot, custom) via HTTP or WebSocket. Feeds location, inventory, relationships, and world events into personality context. Adapter registry pattern matching existing provider systems.
- [ ] **Dialogue & behavior templates** — Pre-built workflow templates for common NPC patterns: merchant bartering, quest-giving, gossip propagation, guard patrol logic, companion decision-making. Importable from marketplace. Parameterized via personality traits.
- [ ] **NPC swarm coordination** — Multi-NPC scene orchestration using existing swarm/council primitives. Coordinated group behaviors: crowd reactions, faction politics, marketplace haggling between NPCs. Council consensus for group decisions.
- [ ] **Voice persona per NPC** — Assign distinct TTS voice profiles per NPC character. Real-time voice streaming for in-game dialogue. Emotion-modulated speech (pitch/speed/tone shift based on mood state). Builds on existing 14-provider TTS system.
- [ ] **NPC fine-tuning pipeline** — Curate training data from player-NPC interactions. Fine-tune personality models on game-specific dialogue, lore, and behavior patterns. A/B test NPC variants. Drift detection for NPC quality regression.

#### Digital Twins

- [ ] **Asset state adapter** — Ingest real-time telemetry from physical assets (IoT sensors, SCADA, BMS) via MQTT, OPC-UA, or HTTP webhooks. Map sensor readings to personality context variables. Pairs with edge binary (`secureyeoman-edge`) for on-premise data collection.
- [ ] **Twin lifecycle management** — CRUD for digital twin entities: bind a personality to a physical asset, configure update frequency, set alert thresholds. Twins inherit cognitive memory for historical state tracking and anomaly awareness.
- [ ] **Predictive state projection** — Workflow templates that use historical memory + current telemetry to project future asset state (maintenance windows, failure probability, capacity planning). Leverages existing LLM routing for inference.
- [ ] **Twin-to-twin communication** — Swarm coordination between digital twins representing interconnected systems (e.g., HVAC + electrical + occupancy). Council consensus for system-wide optimization decisions.
- [ ] **Twin dashboard widgets** — Real-time telemetry cards, historical trend charts, anomaly timeline, and predictive maintenance calendar per twin entity.

#### Training Simulations

- [ ] **Scenario authoring** — Define training scenarios as parameterized workflow templates: learning objectives, branching decision points, scoring rubrics, time pressure settings. Marketplace-publishable.
- [ ] **Simulated actors** — Personalities configured as training counterparts (simulated customer, patient, adversary, interviewer). Behavior adjustable by difficulty level. Emotion model drives realistic escalation/de-escalation.
- [ ] **Trainee session tracking** — Record trainee interactions per scenario run. Score against rubric criteria. Track progression across repeated attempts. Export reports for compliance/certification evidence.
- [ ] **Adaptive difficulty** — Auto-adjust simulated actor behavior based on trainee performance. Uses cognitive memory of past sessions to identify weak areas and increase challenge selectively.
- [ ] **Debrief & replay** — Post-scenario debrief: annotated conversation replay, decision-point analysis, alternative path exploration. Builds on existing agent replay infrastructure.

#### Organizational Modeling

- [ ] **Org entity adapter** — Model departments, teams, roles, and processes as simulation entities. Ingest org data from HR systems (BambooHR, Workday) or SCIM directory sync. Each entity gets a personality representing its function and constraints.
- [ ] **Process simulation** — Define business processes as workflow DAGs with simulated handoffs between org entities. Measure throughput, bottlenecks, and failure modes. What-if analysis: add/remove roles, change approval chains, shift workloads.
- [ ] **Change impact modeling** — Simulate organizational changes (reorgs, policy shifts, tool migrations) before deployment. Entities react based on personality traits and relationship graph. Surface predicted friction points and adoption curves.
- [ ] **Stakeholder sentiment tracking** — Emotion model applied to org entities: track morale, resistance, engagement over simulated time. Dashboard heatmap of organizational sentiment across departments.

#### Multi-Agent Research

- [ ] **Hypothesis exploration swarms** — Spawn agent swarms that independently research a hypothesis from different angles (literature review, data analysis, counter-argument, synthesis). Council consensus produces a weighted conclusion with confidence scores.
- [ ] **Simulated peer review** — Personalities configured as domain-expert reviewers with distinct perspectives and biases. Submit research outputs for simulated peer review cycles. Iterative feedback loops via workflow engine.
- [ ] **Longitudinal study simulation** — Time-series simulation of research phenomena: model evolving variables, inject events at scheduled ticks, observe emergent patterns. Cognitive memory tracks accumulated observations across simulated time.

#### Scientific Modeling

- [ ] **Model definition DSL** — Declarative schema for defining scientific models: state variables, equations/rules (symbolic or code), initial conditions, parameter ranges, and output observables. Stored as workflow-compatible JSON. Importable/exportable for reproducibility.
- [ ] **Parameter sweep engine** — Batch exploration of parameter spaces: grid search, Latin hypercube sampling, or Bayesian optimization. Each parameter set runs as a parallel workflow. Results aggregated into comparison dashboards with sensitivity analysis. Foundation already in place via `ExperimentRunner` autoresearch framework and `HyperparamAutoresearch` (iterative narrowing, convergence detection).
- [ ] **Agent-based modeling (ABM)** — Map simulation entities to scientific agents (cells, organisms, particles, economic actors). Each agent is a personality with domain-specific rules and stochastic behavior. Tick driver advances population state. Emergent phenomena observed via relationship graph and spatial awareness.
- [ ] **Experiment journaling** — Automatic provenance logging: every simulation run records parameters, random seeds, model version, and full output trace to audit chain. Reproducible reruns from journal entries. Exportable as supplementary material for publications. Core journaling infrastructure already in `ExperimentRunner` (hypothesis tracking, run status, metric recording, retain/discard decisions).
- [ ] **Data ingestion adapters** — Import observational/experimental datasets (CSV, HDF5, NetCDF, FITS) as simulation initial conditions or validation baselines. Adapter registry for domain-specific formats. Comparison tools for simulated vs. observed data with statistical goodness-of-fit metrics.
- [ ] **Visualization & export** — Time-series plots, phase diagrams, population dynamics charts, spatial heatmaps. Export simulation results as publication-ready figures (SVG/PNG), raw data (CSV/Parquet), or Jupyter-compatible notebooks. Dashboard widgets for interactive exploration.
- [ ] **LLM-assisted analysis** — Post-simulation agent that interprets results: identifies trends, flags anomalies, suggests follow-up experiments, generates natural-language summaries of findings. Personality tunable per scientific domain (bio, physics, econ, climate).
- [ ] **Collaborative model sharing** — Publish validated models to the community marketplace. Versioned model registry with citation metadata (DOI-ready). Peer review workflow using simulated reviewer personalities. Fork and extend community models.

---

## DOOM Agent Interface (cyrius-doom integration)

Spatial threat visualization and agent navigation via the DOOM engine. An agent can "step through a portal" into a spatially-rendered environment generated from infrastructure data.

**Concept:** WAD files are spatial data containers. Network topology IS a map. Generate WADs from infrastructure data — the agent navigates threats spatially instead of reading JSON reports.

**Mapping:**

| DOOM Concept | Security Concept |
|-------------|-----------------|
| Sectors | Network zones / VLANs |
| Linedefs | Firewall rules / ACLs |
| Things (monsters) | Threat actors / CVEs / unpatched services |
| Things (items) | Assets / services / endpoints |
| Doors (locked) | Access-controlled boundaries (need keycard = token) |
| Keys | Access tokens / credentials / certificates |
| Automap | Network topology overview |
| Player | The agent navigating the environment |
| Health | System health score |
| Ammo | Remediation budget / available patches |

**Requirements:**
- [ ] WAD generator from infrastructure topology (zones → sectors, rules → linedefs, assets → things)
- [ ] cyrius-doom headless mode (already exists: `--ppm` screenshots, spatial query functions)
- [ ] Agent integration: daimon agent type that receives WAD, navigates spatially, reports findings
- [ ] Threat level → DOOM difficulty mapping (I'm Too Young to Die → Nightmare = green → critical)
- [ ] Real-time WAD regeneration as infrastructure state changes (live topology updates)

**Dependencies:** cyrius-doom (v0.24.0+), daimon (1.1.0+), hoosh (LLM reasoning about spatial environment)

**Why this works:** The agent doesn't need a framebuffer. It needs the spatial data structure (BSP tree) and the query functions (point-in-subsector, line-of-sight, nearest-threat). cyrius-doom already has all of these. The renderer is optional — the spatial logic is the interface. Screenshots via `--ppm` for human review when needed.

**Status:** Concept. Post-2.0. After Cyrius port of SY core completes.

---

## Dependency Watch

See [dependency-watch.md](dependency-watch.md) for tracked third-party dependencies with known issues requiring upstream resolution.

---

## Related Documentation

- [Go-Live Checklist](go-live-checklist.md)
- [System Architecture](../adr/001-system-architecture.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Configuration Reference](../configuration.md)
- [Getting Started Guide](../guides/getting-started/getting-started.md)
- [Dependency Watch](dependency-watch.md)
- [Marketing Strategy](../marketing-strategy.md)
- [Changelog](../../CHANGELOG.md)

---

*Last updated: 2026-04-18. See [Changelog](../../CHANGELOG.md) for full history of completed work.*
