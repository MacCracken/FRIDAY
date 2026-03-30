# SecureYeoman — TypeScript to Rust Migration Roadmap

> **Goal**: Migrate SY's core engine from TypeScript/Bun to Rust, consuming AGNOS shared crates directly. TypeScript remains as UI/plugin/scripting layer. Target: ~12MB binary (down from 124MB), sub-millisecond agent lifecycle, zero GC pauses.
>
> **Principle**: Don't rewrite — replace. Each subsystem maps to an existing AGNOS crate that's already tested, benchmarked, and production-ready. The migration is wiring, not invention.

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
| **Rust crates** | 8 crates + bhava + agnosai | 6,183+ | Foundation for migration (bhava 1.1.0 + agnosai 0.25.3 + hoosh gateway integrated) |
| **Edge binary** | Rust | 2,895 | Already migrated (was Go) |

---

## Migration Principles

1. **Bottom-up**: Migrate foundational layers first (types, crypto, personality), then orchestration, then API surface. Dashboard migrates last (or stays React behind a Rust API).

2. **Crate-by-crate**: Each SY subsystem maps to an AGNOS crate or existing sy-* crate. Replace the TS module with a Rust dep. Test parity at each step.

3. **Bridge shrinks over time**: sy-napi starts as the primary bridge (Rust ↔ Node). As more subsystems move to Rust, the bridge surface shrinks until the TS layer is optional.

4. **No big bang**: SY keeps working at every stage. The Bun runtime and TS code runs alongside Rust via napi. Subsystems migrate one at a time.

---

## Phase 0 — Foundation Already Done

These Rust crates already exist in SY and don't need migration:

| SY Crate | Purpose | Status |
|----------|---------|--------|
| sy-crypto | AES-256-GCM, X25519, Ed25519, HMAC, HKDF | Done |
| sy-hwprobe | GPU/TPU/NPU detection (via ai-hwaccel) | Done |
| sy-privacy | DLP, PII classification | Done |
| sy-audit | HMAC-SHA256 tamper-evident log chain | Done |
| sy-sandbox | seccomp-bpf, Landlock, cgroup v2 | Done |
| sy-tee | Model weight sealing (TPM2) | Done |
| sy-edge | Standalone edge binary (22 endpoints, 6.9MB) | Done (was Go) |
| sy-napi | Node.js napi bridge | Done |

---

## Phase 1 — Personality & Identity (bhava replaces soul/spirit)

**SY modules**: `packages/core/src/soul/`, `packages/core/src/spirit/`
**Replaces with**: `bhava = "1.1.0"` from crates.io (32 modules, 875 tests, sub-microsecond via NAPI)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Replace soul personality types with `bhava::traits::PersonalityProfile` | **Done** | 15 traits with full SY↔bhava descriptive level mapping (casual↔Low, formal↔High, etc.) |
| 2 | Replace mood/emotion tracking with `bhava::mood::EmotionalState` | **Done** | 6D PAD vectors (joy, arousal, dominance, trust, interest, frustration), decay, baseline derivation, mood prompt |
| 3 | Replace identity layers with `bhava::archetype::IdentityContent` | **Done** | "In Our Image" preamble + Soul/Spirit/Brain/Body/Heart compose |
| 4 | Replace spirit rules with `bhava::spirit::Spirit` | **Done** | Build from SY passion/inspiration/pain data, compose prompt |
| 5 | Wire bhava sentiment analysis into agent response pipeline | **Done** | `SoulManager.processSentimentFeedback()` — fire-and-forget in both streaming and non-streaming chat handlers |
| 6 | Replace personality-driven reasoning with `bhava::reasoning::ReasoningStrategy` | **Done** | Trait-scored strategy selection (analytical/intuitive/empathetic/systematic/creative). Injected as fallback when no explicit strategy set |
| 7 | Add EQ for richer agent behavior | **Done** | EQ profile derived from traits (perception, facilitation, understanding, management). Injected into system prompt |
| 8 | Update sy-napi bridge for bhava types | **Done** | 31 NAPI functions covering personality, mood, spirit, archetypes, presets, sentiment, reasoning, EQ. Benchmarked: full prompt compose < 10µs |
| 9 | Expose new NAPI capabilities to dashboard/frontend | Not started | Dashboard needs API endpoints or socket events for: EQ profile, reasoning strategy, mood state, action tendency, compatibility scores |

**Result**: SY agents have 32 modules of emotional intelligence via bhava 1.1.0 (Rust/NAPI). All TS personality code kept as fallback for Bun runtime. Benchmarked at comparable speed with 3x depth (6D vs 2D mood, 5 reasoning strategies, 4-branch EQ).

### Phase 1 — Files Changed

| File | Change |
|------|--------|
| `crates/sy-napi/Cargo.toml` | Added `bhava = "1.1.0"`, `chrono = "0.4"` |
| `crates/sy-napi/src/lib.rs` | Added `mod bhava;` |
| `crates/sy-napi/src/bhava.rs` | **New** — 31 NAPI functions (~550 LOC), SY↔bhava trait level mapping |
| `packages/core/src/native/index.ts` | Extended NativeModule interface with 31 bhava methods |
| `packages/core/src/native/bhava.ts` | **New** — typed TS wrappers with null fallback (~320 LOC) |
| `packages/core/src/soul/manager.ts` | 6 injection points: preamble, traits, reasoning, EQ, mood, spirit + sentiment feedback method |
| `packages/core/src/soul/presets.ts` | Merged bhava's 3 extra presets (oracle, scout, blue-shirt-guy) via `getAllPresets()` |
| `packages/core/src/simulation/mood-engine.ts` | `deriveBaseline()` delegates to bhava 6D derivation with TS fallback |
| `packages/core/src/ai/chat-routes.ts` | Sentiment feedback wired into both streaming and non-streaming response handlers |

---

## Phase 2 — Agent Orchestration (agnosai replaces core agent engine)

**SY modules**: `packages/core/src/agent/`, `packages/core/src/agents/`, `packages/core/src/task/`, `packages/core/src/workflow/`
**Replaces with**: `agnosai` (620 tests, 106 benchmarks, 2000-4500x faster cached)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Replace agent lifecycle with agnosai Agent/Crew/Task types | **Done** | Direct Rust types via NAPI bridge (`agnosai-bridge.ts`) |
| 2 | Replace workflow DAG engine with agnosai task scheduling | **Done** | Dependency resolution, parallel execution wired into `workflow-engine.ts` |
| 3 | Replace crew composition with agnosai crew builder | **Done** | Bhava personality-aware crew assembly via `swarm-manager.ts` |
| 4 | Replace agent-eval with agnosai evaluation pipeline | **Done** | Quality scoring, replay |
| 5 | Migrate A2A delegation to agnosai delegation module | **Done** | Agent-to-agent protocol |
| 6 | Wire agnosai into sy-napi bridge | **Done** | 287 LOC in `agnosai.rs`, 165 LOC TS wrappers in `native/agnosai.ts` |

**Result**: Agent orchestration runs at Rust speed. Crew creation that took 200ms in TS takes <0.1ms. The 2000x cached speedup becomes the baseline.

### Phase 2 — Files Changed

| File | Change |
|------|--------|
| `crates/sy-napi/Cargo.toml` | Added `agnosai = "0.25.3"` with `definitions` + `sandbox` features |
| `crates/sy-napi/src/lib.rs` | Added `mod agnosai;` |
| `crates/sy-napi/src/agnosai.rs` | **New** — NAPI bridge for agnosai types (~287 LOC) |
| `packages/core/src/native/index.ts` | Extended NativeModule interface with agnosai methods |
| `packages/core/src/native/agnosai.ts` | **New** — typed TS wrappers (~165 LOC) |
| `packages/core/src/agents/agnosai-bridge.ts` | **New** — agent lifecycle bridge (~255 LOC) |
| `packages/core/src/agents/swarm-manager.ts` | Integrated agnosai crew builder for swarm coordination |
| `packages/core/src/workflow/workflow-engine.ts` | Wired agnosai task scheduling into DAG executor |

---

## Phase 3 — LLM Routing (hoosh client replaces AI providers)

**SY modules**: `packages/core/src/ai/` (16 providers, embeddings, accelerator)
**Replaces with**: `hoosh` client (15 providers, caching, rate limiting, token budgets)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | HooshProvider + shared OAI mappers | **Done** | `hoosh.ts` via `/v1/chat/completions`, `oai-compat.ts` shared types, `agnos.ts` refactored |
| 2 | HooshEmbeddingProvider | **Done** | `embeddings/hoosh.ts` via `/v1/embeddings` |
| 3 | Token budget integration | **Done** | Token check/reserve/report via AgnosClient in both AGNOS and Hoosh providers |
| 4 | Wire into factory, config, cost-calculator | **Done** | `'hoosh'` in all enums, factory switch, PROVIDER_KEY_ENV |
| 5 | Delegate model routing to hoosh | **Done** | `activeProvider` option in RouterOptions; when 'hoosh', skips API key filtering and returns `provider: 'hoosh'` |
| 6 | Delegate provider health to hoosh | **Done** | HealthTracker records under 'hoosh' key; `/api/v1/ai/health` pings hoosh gateway directly |
| 7 | Drop sy-hwprobe for routing | **Done** | Privacy routing and localFirst pre-attempts skip when hoosh is active. MCP accelerator tools remain |
| 8 | Move LLM SDKs to optionalDependencies | **Done** | @anthropic-ai/sdk, openai, @google/generative-ai moved to optionalDependencies in core package.json |

**Result**: HooshProvider routes all inference through hoosh:8088. Model routing delegates provider selection to hoosh. Privacy routing and local-first pre-attempts are bypassed when hoosh handles it. LLM SDKs are optional — only needed for direct provider access.

### Phase 3 — Files Changed

| File | Change |
|------|--------|
| `packages/core/src/ai/providers/oai-compat.ts` | **New** — Shared OpenAI-compatible types and mappers (~220 LOC) |
| `packages/core/src/ai/providers/hoosh.ts` | **New** — HooshProvider with health check, model listing, token budget (~210 LOC) |
| `packages/core/src/ai/embeddings/hoosh.ts` | **New** — HooshEmbeddingProvider via `/v1/embeddings` (~75 LOC) |
| `packages/core/src/ai/providers/agnos.ts` | Refactored to use shared `oai-compat.ts` mappers (removed ~240 LOC of inline types) |
| `packages/core/src/ai/client.ts` | Added `case 'hoosh'` to factory, `hoosh` to noKeyProviders |
| `packages/core/src/ai/embeddings/index.ts` | Added hoosh branch to embedding factory |
| `packages/core/src/ai/cost-calculator.ts` | Added `hoosh: 'HOOSH_API_KEY'` to PROVIDER_KEY_ENV |
| `packages/shared/src/types/ai.ts` | Added `'hoosh'` to AIProviderNameSchema |
| `packages/shared/src/types/config.ts` | Added `'hoosh'` to ModelConfigSchema and FallbackModelConfigSchema |
| `packages/shared/src/types/soul.ts` | Added `'hoosh'` to VectorConfig api.provider enum |

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

## Phase 5 — Security Stack (AGNOS crates replace TS security)

**SY modules**: `packages/core/src/security/`, `packages/core/src/sandbox/`
**Replaces with**: existing sy-* crates + AGNOS crates

| # | Item | Notes |
|---|------|-------|
| 1 | sy-crypto already handles AES/X25519/Ed25519 | Keep, extend with libro for messaging |
| 2 | sy-sandbox already handles seccomp/Landlock | Keep, integrate with agnosys/kavach |
| 3 | sy-audit already handles HMAC chains | Keep, integrate with sigil for trust |
| 4 | sy-privacy already handles DLP/PII | Keep, extend with t-ron for MCP security |
| 5 | Replace TS RBAC with Rust policy engine | Performance + auditability |
| 6 | Replace TS key rotation with Rust implementation | Deterministic timing, no GC interference |

**Result**: Security stack is fully Rust. No GC pauses during crypto operations. Audit chain runs at hardware speed.

---

## Phase 6 — Communication & Voice (dhvani replaces multimodal) ✅

**SY modules**: `packages/core/src/multimodal/`, `packages/core/src/comms/`
**Replaces with**: `dhvani 1.0.0` (audio engine + voice synthesis via svara + G2P via shabda)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Replace TTS with dhvani voice synthesis | ✅ Done | Two providers: `dhvani` (full svara voice) and `dhvani-g2p` (lightweight shabda path for edge). Cloud TTS remains as fallback |
| 2 | Replace STT with dhvani capture → hoosh Whisper | ✅ Done | `dhvani` STT provider: noise reduce + resample via dhvani DSP, then → faster-whisper for recognition |
| 3 | Replace E2E comms encryption with sy-crypto | ✅ Done | AgentCrypto delegates to sy-crypto NAPI (X25519/Ed25519/HKDF/AES-256-GCM). PQC deferred (requires quantum kernel) |
| 4 | T.Ron speaks with a voice shaped by bhava traits | ✅ Done | `traitsToVoiceProfile()` maps 15 bhava personality dimensions → dhvani VoiceProfile prosody (f0, breathiness, vibrato, jitter/shimmer). VoiceAgentConfig accepts `personalityTraits` |

**Files changed:**

| File | Change |
|------|--------|
| `crates/sy-napi/Cargo.toml` | Added `dhvani = "1.0.0"` with voice, g2p, synthesis, analysis features |
| `crates/sy-napi/src/dhvani.rs` | NAPI bridge: voice profiles, G2P, synthesis, DSP, analysis, PCM→WAV |
| `crates/sy-napi/src/lib.rs` | Registered dhvani module |
| `packages/core/src/native/index.ts` | Extended NativeModule interface with dhvani functions |
| `packages/core/src/native/dhvani.ts` | Typed TS wrappers + `traitsToVoiceProfile()` mapping |
| `packages/core/src/native/dhvani.test.ts` | Unit tests: trait mapping (5 tests) + native module tests (16, skip when addon not rebuilt) |
| `packages/core/src/multimodal/manager.ts` | Added dhvani/dhvani-g2p TTS providers, dhvani STT provider with DSP preprocessing |
| `packages/core/src/multimodal/voice/voice-agent.ts` | Added `personalityTraits` to VoiceAgentConfig |
| `packages/core/src/comms/crypto.ts` | Replaced node:crypto with sy-crypto NAPI for all crypto ops |

**Result**: SY agents have native voice via dhvani. G2P provides a zero-inference alternative for edge devices. Cloud TTS/STT remains available as fallback. Comms encryption runs in Rust via sy-crypto.

---

## Phase 7 — Core Engine (Rust binary replaces Bun)

**After Phases 1-6, the remaining TS in core is**:
- HTTP gateway (Fastify) → replace with axum (like shruti-ai serve.rs)
- Integration adapters (31 platforms) → keep as Rust HTTP clients or TS plugins
- Config management → Rust + TOML
- CLI → Rust (clap)

| # | Item | Notes |
|---|------|-------|
| 1 | Replace Fastify gateway with axum HTTP server | Same endpoints, Rust performance |
| 2 | Migrate config to TOML (AGNOS convention) | Drop JS config parsing |
| 3 | Build `secureyeoman` Rust binary | Single binary: agent engine + API + MCP |
| 4 | Move integrations to plugin system | 31 adapters as loadable modules or HTTP bridges |
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

## Binary Size Estimates

| Phase | Binary | Size | Runtime |
|-------|--------|------|---------|
| **Current** | Bun + TS bundle | ~124MB | Bun VM + GC |
| **Phase 0-2** | Bun + Rust (napi) | ~90MB | Hybrid (less TS work) |
| **Phase 3-5** | Bun + mostly Rust | ~50MB | Bun for gateway only |
| **Phase 7** | Pure Rust | ~12-15MB | Native, zero overhead |
| **Phase 9** | Rust (edge mode) | ~7-8MB | Minimal, fleet-ready |

---

## Crate Dependency Map (Post-Migration)

```
secureyeoman (Rust binary, ~12MB)
├── agnosai        — agent orchestration, crews, tasks
├── bhava          — personality, mood, emotion, reasoning (1.0)
├── dhvani         — audio, voice synthesis (when ready)
├── hoosh-client   — LLM routing (HTTP client to hoosh:8088)
├── sy-crypto      — AES-256-GCM, X25519, Ed25519
├── sy-audit       — HMAC tamper-evident log
├── sy-privacy     — DLP, PII classification
├── sy-sandbox     — seccomp, Landlock
├── sy-tee         — TPM2 model sealing
├── ai-hwaccel     — GPU/NPU detection
├── libro          — encrypted messaging
├── sigil          — trust verification
├── pqc            — post-quantum crypto
├── t-ron          — MCP security monitor
├── axum           — HTTP server
├── tokio          — async runtime
└── serde + toml   — config, serialization
```

---

## Migration Order (Recommended)

```
Phase 1 (bhava)     ← COMPLETE — bhava 1.1.0 integrated via NAPI, 31 functions, benchmarked
    ↓
Phase 2 (agnosai)   ← COMPLETE — agnosai 0.25.3 integrated via NAPI, agent/crew/task/workflow bridged
    ↓
Phase 3 (hoosh)     ← COMPLETE — HooshProvider, embeddings, routing delegation, health delegation, SDK optionalized
    ↓
Phase 5 (security)  ← already mostly Rust, extend existing crates
    ↓
Phase 4 (daimon)    ← brain becomes thin client, removes vector store deps
    ↓
Phase 6 (dhvani)    ✅ complete (dhvani 1.0.0 integrated)
    ↓
Phase 7 (core)      ← the final swap: Bun → axum, TS → Rust CLI
    ↓
Phase 9 (edge)      ← unify main + edge into one binary
```

**Phase 8 (dashboard)**: Runs in parallel, stays React, no urgency.

---

## Success Criteria

- [ ] Binary size < 15MB (down from 124MB)
- [ ] Agent creation < 0.1ms (down from ~200ms)
- [ ] Zero GC pauses during operation
- [ ] All 180+ MCP tools functional
- [ ] All 31 integrations functional (via plugin or native)
- [ ] Dashboard connects to Rust API without changes
- [ ] sy-edge is a build profile, not a separate binary
- [ ] T.Ron speaks with personality-driven voice
- [ ] Benchmark suite proves parity or improvement on every migrated subsystem

---

*Last Updated: 2026-03-26 — Phases 1-3 complete*
