# SecureYeoman — TypeScript to Rust Migration Roadmap

> **Goal**: Migrate SY's core engine from TypeScript/Bun to Rust, consuming AGNOS shared crates directly. TypeScript remains as UI/plugin/scripting layer. Target: ~12MB binary (down from 124MB), sub-millisecond agent lifecycle, zero GC pauses.
>
> **Principle**: Don't rewrite — replace. Each subsystem maps to an existing AGNOS crate that's already tested, benchmarked, and production-ready. The migration is wiring, not invention.
>
> **Completed**: Phases 0 (foundation), 1 (bhava), 2 (agnosai), 3 (hoosh), 5 (security), 6 (dhvani) — see [Changelog](../../../CHANGELOG.md).

---

## Current State

| Layer | Tech | LOC | Status |
|-------|------|-----|--------|
| **Core engine** | TypeScript/Bun | 20,683 | Migration target |
| **MCP server** | TypeScript | 46,015 | Migration target |
| **Shared types** | TypeScript (Zod) | 11,602 | → Rust types with serde |
| **Dashboard** | React/Vite | 169,516 | Stays (UI layer) |
| **Desktop shell** | Tauri v2 | — | Stays (wraps Rust core) |
| **Mobile shell** | Capacitor v6 | — | Stays or → Tauri mobile |
| **Rust crates** | 8 crates + bhava + agnosai + dhvani | 6,183+ | Foundation for migration |
| **Edge binary** | Rust | 2,895 | Already migrated (was Go) |

---

## Migration Principles

1. **Bottom-up**: Migrate foundational layers first (types, crypto, personality), then orchestration, then API surface. Dashboard migrates last (or stays React behind a Rust API).

2. **Crate-by-crate**: Each SY subsystem maps to an AGNOS crate or existing sy-* crate. Replace the TS module with a Rust dep. Test parity at each step.

3. **Bridge shrinks over time**: sy-napi starts as the primary bridge (Rust ↔ Node). As more subsystems move to Rust, the bridge surface shrinks until the TS layer is optional.

4. **No big bang**: SY keeps working at every stage. The Bun runtime and TS code runs alongside Rust via napi. Subsystems migrate one at a time.

---

## Phase 1 — Remaining Item

| # | Item | Notes |
|---|------|-------|
| 9 | Expose NAPI capabilities to dashboard/frontend | Dashboard needs API endpoints or socket events for: EQ profile, reasoning strategy, mood state, action tendency, compatibility scores |

---

## Phase 4 — Knowledge & Memory (daimon APIs replace brain)

**SY modules**: `packages/core/src/brain/` (memory, knowledge, vector store, RAG)
**Replaces with**: daimon REST API (vector store, RAG, memory endpoints already exist)

| # | Item | Notes |
|---|------|-------|
| 1 | Replace vector store integration with daimon `/v1/vectors/*` API | Insert, search, collections |
| 2 | Replace RAG pipeline with daimon `/v1/rag/*` API | Ingest, query, stats |
| 3 | Replace memory store with daimon `/v1/agents/:id/memory` API | Per-agent memory |
| 4 | Replace knowledge base with daimon `/v1/knowledge/*` API | Search, index, stats |
| 5 | Replace audit trails with sy-audit + daimon audit chain | Already Rust, just extend |

**Result**: SY's brain becomes a thin client over daimon. The intelligence stays, the infrastructure delegates.

---

## Phase 7 — Core Engine (Rust binary replaces Bun)

**Done (7.0-7.5+)**: axum gateway with **328 routes across 49 modules** — full CRUD for all core domains, SSE streaming, WebSocket, 12 integration proxy adapters. JWT+RBAC auth, sqlx DB layer, reverse proxy fallback to Fastify.

**Remaining:**

| # | Item | Notes |
|---|------|-------|
| 2 | Migrate config to TOML (AGNOS convention) | Drop JS config parsing |
| 3 | Build `secureyeoman` Rust binary | Single binary: agent engine + API + MCP |
| 5 | sy-napi becomes optional (only for TS plugin runtime) | Bridge shrinks to plugin boundary |

**Result**: SY is a single Rust binary (~12MB). Bun/Node is optional — only needed if TS plugins are loaded.

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

## Phase 9 — Edge Consolidation

**sy-edge is already Rust (6.9MB).** After Phase 7, the main SY binary and edge binary share the same crate foundation:

| # | Item | Notes |
|---|------|-------|
| 1 | Unify sy-edge with main SY binary | Feature-gated: `--edge` mode strips dashboard/integrations |
| 2 | SY Edge → SY with `edge` profile | One binary, one codebase, two deployment modes |
| 3 | Edge participates in daimon fleet | Full fleet citizen, not a separate product |

**Result**: SY Edge is no longer a separate project — it's a build profile of the main binary.

---

## Phase 10 — Flatten

Collapse workspace into single flat crate. Merge sy-crypto, sy-hwprobe, sy-tee, sy-privacy, sy-audit, sy-sandbox, sy-types, sy-edge into sy-core as modules. Remove sy-napi (no longer needed — server is Rust). Single `Cargo.toml`, single `src/`, single binary. Same pattern as agnosai and ifran.

**Final architecture:**
- **sy-core** — Rust backend engine (flat crate, crates.io). All business logic, API, DB, auth, integrations. Reusable.
- **secureyeoman** — Product layer. Consumes sy-core as a dep, wires in dashboard (React), desktop (Tauri), mobile (Capacitor), config, Docker packaging. The thing users install.

---

## Binary Size Estimates

| Phase | Binary | Size | Runtime |
|-------|--------|------|---------|
| **Current** | Bun + TS bundle | ~124MB | Bun VM + GC |
| **Phase 0-2** | Bun + Rust (napi) | ~90MB | Hybrid (less TS work) |
| **Phase 3-6** | Bun + mostly Rust | ~50MB | Bun for gateway only |
| **Phase 7** | Pure Rust | ~12-15MB | Native, zero overhead |
| **Phase 9** | Rust (edge mode) | ~7-8MB | Minimal, fleet-ready |

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
    ↓
Phase 2 (agnosai)   ✅
    ↓
Phase 3 (hoosh)     ✅
    ↓
Phase 5 (security)  ✅
    ↓
Phase 4 (daimon)    ← brain becomes thin client, removes vector store deps
    ↓
Phase 6 (dhvani)    ✅
    ↓
Phase 7 (core)      ✅ (328 routes, 49 modules — config + CLI remaining)
    ↓
Phase 9 (edge)      ← unify main + edge into one binary
    ↓
Phase 10 (flatten)  ← single flat crate, semver 1.0.0
```

**Phase 8 (dashboard)**: Runs in parallel, stays React, no urgency.

---

## Success Criteria

- [ ] Binary size < 15MB (down from 124MB)
- [ ] Agent creation < 0.1ms (down from ~200ms)
- [ ] Zero GC pauses during operation
- [ ] All 180+ MCP tools functional
- [ ] All 12 integration adapters functional in Rust (✅ proxy routes done, access mode enforcement pending)
- [ ] Dashboard connects to Rust API without changes
- [ ] sy-edge is a build profile, not a separate binary
- [ ] T.Ron speaks with personality-driven voice
- [ ] Benchmark suite proves parity or improvement on every migrated subsystem

---

*Last Updated: 2026-03-30 — Phases 0-3, 5-7 complete (core engine: 210 routes, config + CLI remaining)*
