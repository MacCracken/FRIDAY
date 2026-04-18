# SecureYeoman — TypeScript to Rust Migration Roadmap

> **Goal**: Migrate SY's core engine from TypeScript/Bun to Rust, consuming AGNOS shared crates directly. Dashboard stays React behind the Rust API.
>
> **Principle**: Don't rewrite — replace. Each subsystem maps to an existing AGNOS crate that's already tested, benchmarked, and production-ready. The migration is wiring, not invention.
>
> **Completed**: Phases 0 (foundation), 1 (bhava), 2 (agnosai), 3 (hoosh), 5 (security), 6 (dhvani), and 7 (core engine — 971+ routes, 89 modules, sy-core is the sole application binary, Node.js removed). See [Changelog](../../../CHANGELOG.md) and [Migration Findings](../migration-finds.md).

---

## Current State

| Layer | Tech | Status |
|-------|------|--------|
| **Core engine** | Rust (`sy-core`, axum) | Migrated — 971+ routes, 89 modules, 26.5 MB binary |
| **MCP server** | Rust (second `sy-core` instance on :3001) | Migrated |
| **Shared types** | Rust (`sy-types`, serde) | Migrated |
| **Ecosystem crates** | Rust (bhava 2.0, agnosai, dhvani, szal, bote, majra) | Called directly from `sy-core`, no NAPI bridge |
| **Dashboard** | React/Vite | Stays behind Rust API |
| **Desktop shell** | Tauri v2 | Stays (wraps `sy-core`) |
| **Mobile shell** | Capacitor v8 | Stays |
| **Rust workspace** | 1 crate (`sy-core`, two binary targets) | Flatten complete (Phase 10, 2026-04-18) |
| **Edge binary** | `sy-edge` bin target in `sy-core` (10.6 MB; `--features edge` slimming TBD) | Shares codebase with `sy-core` |
| **Legacy `packages/core/`** | TypeScript stub | Kept for one more release cycle, then deleted |

---

## Migration Principles

1. **Bottom-up**: Migrate foundational layers first (types, crypto, personality), then orchestration, then API surface. Dashboard migrates last (or stays React behind a Rust API).

2. **Crate-by-crate**: Each SY subsystem maps to an AGNOS crate or existing sy-* crate. Replace the TS module with a Rust dep. Test parity at each step.

3. **Bridge was removed in Phase 7**: `sy-napi` (the Rust↔Node NAPI bridge) is deleted. All ecosystem crates are called directly from `sy-core` — zero serialization overhead.

4. **No big bang**: SY kept working at every stage. Subsystems migrated one at a time under the NAPI bridge until Phase 7 removed Node.js from the runtime.

---

## Phase 1 — Complete

Dashboard reads personality state (EQ profile, reasoning strategy, mood, action tendency, compatibility scores) through the bhava-backed soul/spirit REST endpoints exposed by `sy-core`. No NAPI surface — bhava is a direct crate dep.

---

## Phase 4 — Knowledge & Memory (daimon APIs replace brain) — **Obsolete**

**Original intent**: delegate SY's brain (memory, knowledge, vector store, RAG) to daimon's REST API.

**Why it's obsolete** (verified 2026-04-18 against daimon tag 0.6.0 source):

- Daimon 0.6.0 is the **final Rust version**. At v0.7.0 daimon was rewritten end-to-end in Cyrius (9,724 LOC Rust → 4,141 LOC Cyrius), and the current ecosystem is pure Cyrius.
- Daimon 0.6.0's RAG is intentionally lightweight: `simple_embed()` hashes tokens into a fixed vocabulary (not real embeddings), pipeline is in-memory only, and the query path does pure cosine similarity. SY's native brain already has real embedding providers (OpenAI / Ollama / AGNOS gateway), pgvector persistence, hybrid semantic+FTS retrieval with RRF merge, and ACT-R activation scoring.
- Daimon 0.6.0 exposes `/v1/rag/ingest`, `/v1/rag/query`, `/v1/mcp/*`, `/v1/edge/*`, `/v1/scheduler/*`, `/v1/agents`, but **not** the `/v1/vectors/*`, `/v1/agents/:id/memory`, or `/v1/knowledge/*` surfaces this phase assumed.

Net: replacing SY's brain with daimon would be a capability regression, and daimon itself has left the Rust path. The phase is removed from the migration plan. SY's native brain (bhava + pgvector + hybrid retrieval) stays.

---

## Phase 7 — Core Engine (Rust binary replaces Bun)

**Done (7.0-7.7 + repair phases R-1..R-16)**: axum gateway with **971+ routes across 89 modules** — full CRUD for all core domains, true SSE streaming, WebSocket, 8 typed integration clients, auth (JWT/API key/mTLS, OAuth/SSO/SAML/WebAuthn), training, security (13-layer middleware incl. rate limiting, RBAC, body limits, IP reputation, backpressure, ownership guards, local network check, fingerprinting), sqlx DB layer, pgvector, JTI token revocation, persistent vector store. Node.js removed; `sy-core` is the sole application binary (26.5 MB). See [Migration Findings](../migration-finds.md) for the 16-phase repair log.

**Remaining:**

| # | Item | Notes |
|---|------|-------|
| 2 | Migrate config to TOML (AGNOS convention) | Replace env-var-only config with optional `secureyeoman.toml`; keep env vars as overrides |

**Result so far**: SY is a single Rust binary (26.5 MB). Target of <15 MB requires Phase 10 flatten + release optimization (LTO, strip, panic=abort).

---

## Phase 8 — Dashboard & Desktop

**The dashboard (169K LOC React) doesn't need to migrate immediately.** Options:

| Option | Effort | Notes |
|--------|--------|-------|
| Keep React + Vite | None | Dashboard talks to Rust API via HTTP. Already works with Tauri v2 shell |
| Migrate to egui | Very High | Only if desktop-native performance matters (unlikely for a dashboard) |
| Keep Tauri v2 desktop | None | Tauri wraps the React dashboard + calls Rust core directly |

**Recommendation**: Keep React dashboard. It's a UI — 169K LOC of React is fine behind a Rust API. The performance wins are in the engine, not the dashboard.

---

## Phase 9 — Edge Consolidation ✅

Folded into Phase 10. `sy-edge` is now a `[[bin]]` target of the flattened `sy-core` crate — same Cargo package, same codebase. `--features edge` stripping of dashboard/integrations is an open optimization item (see Phase 10 remaining).

Edge participation in the daimon fleet is deferred to post-flatten.

---

## Phase 10 — Flatten ✅

Workspace collapsed from 9 crates into a single `sy-core` crate on 2026-04-18:

- `sy-types`, `sy-audit`, `sy-privacy`, `sy-sandbox`, `sy-tee`, `sy-crypto`, `sy-hwprobe` → sibling modules at `sy-core/src/{types,audit,privacy,sandbox,tee,crypto,hwprobe}/`
- `sy-edge` → second binary target at `sy-core/src/bin/sy-edge/` (shares all crypto/hwprobe code with `sy-core`)
- Workspace `Cargo.toml` now lists a single member; all domain deps consolidated under `sy-core/Cargo.toml`
- 377 tests pass (155 migrated from the deleted crates' inline test modules)

**Remaining optimization** (not required for flatten):

- `--features edge` build of `sy-core` that strips dashboard/integrations to shrink the sy-edge binary back toward 7 MB (current 10.6 MB because it links the full gateway code)
- `[profile.release] lto = "fat"`, `panic = "abort"`, `codegen-units = 1` pass to push `sy-core` under the 15 MB target

**Final architecture:**
- **sy-core** — Rust backend engine (flat crate, crates.io). All business logic, API, DB, auth, integrations. Reusable.
- **secureyeoman** — Product layer. Consumes sy-core as a dep, wires in dashboard (React), desktop (Tauri), mobile (Capacitor), config, Docker packaging. The thing users install.

---

## Binary Size Trajectory

| Phase | Binary | Size | Runtime |
|-------|--------|------|---------|
| Baseline | Bun + TS bundle | ~124 MB | Bun VM + GC |
| Phases 0-6 (NAPI bridge) | Bun + Rust (napi) → Bun + mostly Rust | ~90 → ~50 MB | Hybrid |
| **Phase 7 (current)** | **Pure Rust `sy-core`** | **26.5 MB** | Native, zero overhead |
| Phase 10 goal | Flat `sy-core` with LTO + strip | <15 MB | Native, fleet-ready |
| Phase 10 edge build | `sy-core --features edge` | ~7-8 MB | Minimal, fleet-ready |

---

## Crate Dependency Map (Post-Migration)

```
secureyeoman (Rust binary, ~12MB)
├── agnosai        — agent orchestration, crews, tasks
├── bhava          — personality, mood, emotion, reasoning
├── dhvani         — audio, voice synthesis, G2P, DSP
├── hoosh-client   — LLM routing (HTTP client to hoosh:8088)
├── sy-crypto      — AES-256-GCM, X25519, Ed25519
├── sy-audit       — HMAC tamper-evident log
├── sy-privacy     — DLP, PII classification
├── sy-sandbox     — seccomp, Landlock
├── sy-tee         — TPM2 model sealing
├── ai-hwaccel     — GPU/NPU detection
├── libro          — encrypted messaging
├── sigil          — trust verification
├── t-ron          — MCP security monitor
├── axum           — HTTP server
├── tokio          — async runtime
└── serde + toml   — config, serialization
```

---

## Migration Order

```
Phase 1 (bhava)     ✅
Phase 2 (agnosai)   ✅
Phase 3 (hoosh)     ✅
Phase 5 (security)  ✅
Phase 6 (dhvani)    ✅
Phase 7   (core)    ✅ (971+ routes, 89 modules)
Phase 7.2 (config)  ✅ (TOML + env overrides, secureyeoman.example.toml)
Phase 9   (edge)    ✅ (folded into Phase 10)
Phase 10  (flatten) ✅ (workspace 9 → 1 crate; sy-edge is a bin target of sy-core)
Phase 4   (daimon)  ✕ obsolete (daimon v0.7.0+ rewrote in Cyrius; native brain is richer)

Only open item: binary-size optimization pass (LTO fat + panic=abort + `--features edge`).
```

**Phase 8 (dashboard)**: Stays React behind the Rust API. Complete as-is.

---

## Success Criteria

- [ ] Binary size < 15 MB (currently 26.8 MB — LTO fat + panic=abort + `--features edge` for stripping)
- [x] Zero GC pauses during operation (no runtime GC)
- [x] Dashboard connects to Rust API without changes
- [x] `sy-edge` is a bin target of `sy-core`, not a separate crate
- [ ] Agent creation latency budget met (benchmark pass pending)
- [ ] All integration adapters functional in Rust (8 typed clients done; remaining platforms via proxy)
- [ ] T.Ron speaks with personality-driven voice (dhvani + bhava mood→prosody wired; manual verify pending)
- [ ] Benchmark suite proves parity/improvement on every migrated subsystem

---

*Last updated: 2026-04-18 — Phase 7, 7.2, 9, and 10 all complete. Remaining: Phase 4 (daimon; optional), binary size optimization, benchmark pass.*
