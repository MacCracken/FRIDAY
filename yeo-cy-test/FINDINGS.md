# Cyrius Viability Findings — yeo-cy-test

Running log of rough edges, gaps, and DX notes hit while building a thin
full-stack slice (Cyrius backend + patra persistence + TS/TSX frontend).
Purpose: de-risk the eventual SecureYeoman → Cyrius port. The original probe
was on **Cyrius 6.0.3**; see the dated re-run sections below for newer toolchains.

Severity: 🔴 blocker · 🟡 friction · 🔵 note/nice-to-have

## Update — `crypto` → sigil: server-side Ed25519 works and interops with OpenSSL (2026-07-13)

Third `sy-core` module ported (`src/crypto.cyr`), and the **first server-side use of
sigil beyond TLS**. The server generates an Ed25519 identity keypair
(`ed25519_generate_keypair`), publishes it at `GET /api/pubkey`, and signs the audit
chain's head hash (`head_sig` on `GET /api/audit`) — server authenticity layered on
libro's tamper-evidence.

- ✅ **Positive viability verdict: sigil is a viable pure-Cyrius server-side crypto
  stack.** Ed25519 keygen / sign / verify and SHA-256 all work off the handshake path,
  and the server signature **interoperates with a standard implementation**: Python's
  `cryptography` (OpenSSL Ed25519) verifies `head_sig` against `/api/pubkey`
  (verify.py scenario 14), and `sha256_hex("abc")` matches the RFC 6234 known-answer
  (unit invariant). Not just self-consistent — cross-checked against OpenSSL.
- 🔵 **DX papercut (fixed in-probe, no upstream bug): sigil's `hex_encode` /
  `sha256_hex` return a NUL-terminated CSTR, not a Cyrius `str`.** Passing the result
  straight to `json_v_str_new` (which expects a `str` struct) misreads the pointer and
  crashes the response handler — reproduced (empty response on `/api/pubkey`,
  worker-only, so it first looked like a threading bug; isolated single-threaded to
  the type). Fix: wrap in `str_from(hex_encode(...))`. Worth a note for consumers who
  expect the `*_hex` helpers to return a `str` like most string-producing APIs; a
  doc-comment on the return type (or `*_hex_str` variants) would remove the trap.
- **Concurrency:** keys are generated once at init and read-only after, so signing is
  thread-safe (per-call signature buffer); the audit-head signing rides the existing
  `g_audit_lock`. **Limitation:** the identity key is ephemeral (regenerated per
  process) — a persistent sealed key (à la sy-core's `tee`) is a future bite.

## Update — the single-quote corruption: filed, FIXED at both layers, adopted → audit chain now durable (2026-07-13)

The headline of this session, and the probe working exactly as intended: a real
data-integrity bug, hit for the **third time**, root-caused, fixed **upstream** in two
libs, and adopted back into the probe — turning the audit module from in-memory into a
durable, tamper-evident log that can store arbitrary content.

**The bug (🔴 data integrity).** libro's audit store (`patrastore_append`) built each
row by **raw SQL string interpolation** — `INSERT INTO audit_entries VALUES ('…')`.
patra's SQL tokenizer had **no `''` (doubled-quote) escaping**: a single `'` in a
value made the generated SQL malformed → `PATRA_ERR_SYNTAX` → `patrastore_append`
logged "insert failed" and **the record was silently dropped**. For an audit log
(argonaut's PID-1 tamper-evidence, and this probe's), a value that can't round-trip is
a correctness hole, not a nit. **Reproduced empirically** from the probe: an audit
entry whose `details` held `O'Brien` returned an exit code proving the entry count
stayed behind (dropped). patra's own roadmap already carried this as **P1**
(argonaut/libro), so this was the third consumer-hit.

**Root-caused to BOTH layers.** A 4-agent recon of patra found two things: (1) patra's
lexer (`src/sql.cyr`) ends a `'…'` literal at the first inner quote with zero
lookahead — so `'a''b'` lexes to two tokens, not one escaped `a'b`; and (2) patra
**already had** a quote-safe path — prepared statements + `patra_bind_text` (values
pass as bytes, never reparsed as SQL) — that libro simply wasn't using. So "fix patra"
was really "fix both": patra's genuine lexer defect **and** libro's raw-SQL usage.

**Fixed upstream (both released) and adopted here:**
- **patra 1.12.10** — the SQL tokenizer now implements standard `''` escaping,
  collapsing `''`→`'` **in place** (no-`''` literals stay zero-copy) with
  `patra_exec`/`patra_query` copying the caller's buffer only when a `''` is present;
  plus a new **`patra_quote_str`** helper. Regression `test_exec_quote_escaping`;
  gates 893 tests + 7 fuzz (incl. the SQL parser) + libro 15/15 + vidya 19/19.
- **libro 2.8.1** — `patrastore_append` rewritten to a **bound INSERT**
  (`patra_prepare` + `patra_bind_text` ×10 + `patra_exec_prepared`), the durable,
  escaping-free path (works on patra 1.12.9+). Regression `test_ps_quote`.
- **Probe:** bumped `[deps.patra]` → 1.12.10, `[deps.libro]` → 2.8.1. The audit chain
  now stores arbitrary note content verbatim.

**Payoff — `audit` is now DURABLE.** With the corruption closed, `src/audit.cyr`
migrated from an in-memory chain to libro's **patra-backed `patrastore`**
(`yeo-audit.patra`): every note mutation persists a hash-linked entry, `GET /api/audit`
re-verifies the **on-disk** chain, and the log **survives a restart** — `audit_init`
reconstructs the head hash from the on-disk entries so post-restart appends link onto
the existing chain and the whole thing still verifies. Uses **connection-per-thread**
handles (patra requires a handle be used on the opening thread — isolated + confirmed:
single-threaded works, a main-opened handle used by a worker crashes; TLS slot 14,
like the notes `db()`), with `g_audit_lock` serializing the (inherently serial) chain
+ the shared head. New backend **scenario 12c** proves durability (chain survives a
full server restart, entries + head intact, still verified). Suite: **4 unit + 39
backend + 10 UI**, green.

**Lesson.** The `fix patra` ask uncovered (again) that the assumed-broken lib already
had the safe path — the durable fix spanned two repos, and filing is what let each be
root-caused where a black-box consumer couldn't. Both libs were fixed *from* this
probe and released, then adopted here — the probe's whole reason to exist.

## Update — re-run on cyrius 6.4.62: last lock removed (lock-free reads), thin sandhi profile bundle dogfooded (2026-07-13)

Bumped to **cyrius 6.4.62 / patra 1.12.9 / sandhi 1.8.2 (thin `server` profile
bundle) / sigil 3.9.9 (via cyrius) / sakshi 2.4.6** (was 6.3.0-pinned / 1.12.6 /
folded sandhi / 2.4.0). Baseline re-verified green **before** any change: build OK,
2 unit invariants, **35 backend + 10 UI** scenarios pass at `max_conns=4`. Two
previously-filed findings shipped upstream and were adopted this cycle.

- ✅ **The probe is now FULLY LOCK-FREE — `g_db_lock` removed (patra 1.12.9).** Last
  cycle the probe filed *and fixed* the patra readback race (`patra_query` released
  its shared flock before `patra_result_read_text` lazily read the payload pages, so
  a concurrent writer could tear a TEXT/BLOB body returned as `PATRA_OK`); the fix
  (`_rs_materialize`, which snapshots every TEXT/BYTES payload into an owned heap
  buffer **while the shared flock is held**) shipped in patra **1.12.8** and is now
  folded into **1.12.9**. Adopted here: every handler calls `db()` — this worker's
  own connection-per-thread patra handle — with **no mutex**. patra's "lock-free
  parallel reads" promise now holds for **TEXT** columns too (was fixed-width only).
  **New scenario 11** (`tests/verify.py`) is the regression guard: 310 reads issued
  while a writer mutates the same rows → **0 torn/garbled** (was the whole reason the
  lock existed). This closes the last workaround the probe carried — it went from
  "two workarounds + a lock" (6.3.42) to **zero**.
- ✅ **Adopted sandhi's thin `server` PROFILE BUNDLE — the probe's own filed finding,
  dogfooded (sandhi 1.8.0 → 1.8.2).** Long ago the probe filed the **"bundled-libs →
  individual-packages split"** (the server-only slice was dragging in sandhi's full
  client/h2/rpc/discovery surface as ~400 KB+ of static). sandhi 1.8.0 shipped
  **profile bundles**; the probe now consumes the **`server`** profile as a single
  `dist/sandhi-server.cyr` module via `[deps.sandhi]` — **141 KB vs the 590 KB full
  folded bundle (~76 % smaller)** — as **sandhi's first profile-bundle consumer**.
  The thin bundle carries only session_cache + conn + server/mod, so its former
  transitive deps are now **declared explicitly** in `[deps].stdlib`: `bayan`
  (the probe's `json_v_*`; `json` stays dropped — it collides with bayan on
  `json_v_*`/`_jv_*`/`_jp_*`) and `hashmap` (`map_*`, sandhi's TLS session cache).
  `tls` still pulls sigil transitively. sandhi **1.8.1** made `run_pooled_tls` safe
  at `max_conns>1`; the probe's TLS pool stays at 4 — scenarios 9/10/11 green.

Net: the slice is a **thin, lock-free sandhi(server-profile) + patra composition**,
green + stable at `max_conns=4` on the current toolchain, with every previously-filed
ecosystem finding now shipped and adopted. No new findings this cycle.

**Port kickoff — positive viability data point (2026-07-13):** the probe began
growing into the real SecureYeoman → Cyrius port by lifting the first `sy-core`
module. `sy-core`'s **audit** module (append-only, hash-linked crypto log) ported
onto **libro** (v2.7.10) with **zero upstream friction** — the "one sy-core module ↦
one purpose-built Cyrius lib" pattern held: libro's `chain_new`/`chain_append`/
`chain_verify` API dropped straight into the note handlers, and the chain verified
after 641 entries incl. the probe's 250 + 60 concurrent mutations (a hash chain is
inherently serial, so a single `g_audit_lock` around appends is correct, not a
workaround). No Cyrius/libro bug or gap surfaced. Env notes only: libro's 2.8.0 is
untagged at the time (since tagged — bumped to 2.8.0); its `dist/libro.deps` sidecar
required six more stdlib modules (`fs`/`process`/`ct`/`keccak`/`thread_local`/`slice`)
declared in `[deps].stdlib`.

**Second module — `hwprobe` ↦ ai-hwaccel (v2.3.14), also zero friction.** sy-core's
hwprobe is a thin wrapper over `ai_hwaccel`, which is *already* a Cyrius lib, so the
port is one call: `registry_detect_no_exec()` (no subprocess spawn) →
`registry_to_summary_json(r)` → cache → serve at `GET /api/hwinfo`. Detected real
hardware on the dev box (2 devices / 1 GPU / ~64 GB). Env note only: ai-hwaccel's CLI
helpers reference `argc`/`argv`, so `args` was added to `[deps].stdlib` (unused on the
no-exec path). No ai-hwaccel/cyrius bug or gap.

**Deferred, with a real usage-contract note (not yet a filed finding — needs
verification): libro `patrastore` persistence.** Making the audit chain durable via
libro's patra-backed store is the natural next bite, but its usage contract is
heavier than the in-memory chain: `patrastore_open` requires `ed25519_init()` first
(entries are signed) and a `str`-typed path (not a raw cstr); the caller manages
`prev_hash` linking (`entry_new(…, prev_hash)` + track the head). More importantly,
`patrastore_append` builds its INSERT by **string-concatenating the entry fields into
SQL** (`str_builder_add(sb, details)` into `VALUES ('…')`) with no visible escaping —
a potential SQL-break / injection risk for audit `details` containing a quote. This
is **flagged, NOT filed** — it must be reproduced first (append an entry with a quote
in `details`, observe the insert). The probe's current usage would be safe (numeric
ids only), but a faithful audit log stores arbitrary text, so this gates adopting
patrastore. Next real bite either verifies+files this, or moves to `crypto` ↦ sigil /
`sandbox` ↦ kavach. See CHANGELOG / state.md for the full mapping.

## Update — re-run on cyrius 6.3.42: BOTH residuals shipped (and both were consumer MISDIAGNOSES); new patra readback finding (2026-07-03)

Bumped to **cyrius 6.3.42** (asked for 6.3.41; cycc auto-drifted 6.3.41→6.3.42
same day, so the pin was matched to the installed cycc — 6.3.42 is a
probe-irrelevant, cycc-byte-identical release that only finishes `lib/protobuf.cyr`,
which the probe doesn't use; validated on 6.3.41 then re-confirmed green on 6.3.42) /
**patra 1.12.7 / sandhi 1.7.0 / sigil 3.9.9 (folded, up from 3.9.7) / sakshi 2.4.3**.
The two cyrius fixes that cleared the residuals landed in **6.3.24** (enum-shadow)
and **6.3.25 / sigil 3.9.9** (slot collision). The headline: the **two residuals**
the probe was sitting on both shipped — and the upstream root causes **overturned
the probe's own diagnoses of both**. Both workarounds are now removed.

- ✅ **Residual #1 "string-literal global garbage at scale" was a MISDIAGNOSIS —
  it's a symbol collision (fixed cyrius 6.3.24).** The crash was never a
  string-global codegen bug. `var DB_PATH = "yeo.patra"` collides by **name** with
  patra's exported `enum DbOff { DB_PATH = 16 }` (`lib/patra.cyr:3703`). cyrius
  resolved the symbol to the **last** registration, so `patra_open`'s
  `store64(db + DB_PATH, wpath)` used the string pointer as an ABI **offset** →
  wild store → SIGSEGV (the string *value* was fine). cyrius 6.3.24 made a
  non-int-literal `var` that shadows an enum constant a **hard compile error**
  (`variable 'X' shadows an enum constant`) instead of a silent miscompile.
  **Adopted:** replaced the `db_path()` fn with a plain global renamed to avoid the
  collision — `var g_dbpath = "yeo.patra"`. Building `var DB_PATH = …` now errors
  cleanly (verified); `g_dbpath` builds + the full suite is green.
- ✅ **Residual #2 "RECORD_LAYER_FAILURE under a mixed pattern" was also mostly
  mis-framed — it's a thread-local slot collision (fixed cyrius 6.3.25 / sigil
  3.9.9).** sigil's per-thread crypto-bank lane (`_SIGIL_CBANK_SLOT`) and patra's
  parse scratch **both hardcoded thread-local slot 0** (cyrius's 16-slot space has
  no allocator). A patra query clobbered sigil's pinned bank index; the next
  `cbank()` then indexed the **wrong lane** of sigil's process-global banked crypto
  buffers → a corrupted in-flight handshake key schedule → the client's
  `RECORD_LAYER_FAILURE`. It's **deterministic (every 4th handshake)**, not the
  "accumulated mixed pattern" the probe filed. Fixed by moving sigil to slot 8
  (**3.9.9**) + a thread-local **slot-namespace registry** (0-4 patra, 8 sigil, 15
  consumer). **Adopted:** bumped the TLS pool `max_conns` **1 → 4**. Verified on
  6.3.41/sigil 3.9.9: verify.py **5/5 clean at max_conns=4**, plus an amplified
  stress (rejected-untrusted handshakes interleaved with valid load) — **0 errors**
  across ~1,440 reqs at max_conns=4 and ~1,600 at max_conns=8 (no bank exhaustion;
  well under 64 banks).

**Lesson:** two consecutive residuals the probe root-caused *by observation*
(string-global-at-scale; per-connection-TLS-state) were both actually **symbol /
slot name collisions** in cyrius's flat namespace — the value of filing was that
upstream root-caused what the black-box consumer could not.

New / corrected findings this cycle:

- ✅ **NEW (patra) — FILED AND FIXED THIS CYCLE (patra 1.12.8): TEXT/BLOB result
  readback escapes the query's flock window.** `patra_query` snapshotted only a
  byte-**reference** (page + len) and **released its shared flock before
  returning**; `patra_result_read_text` read the payload pages **lazily and
  unlocked** (`_bytes_read_chain`). A concurrent writer on another handle could
  free/overwrite those pages between query and readback → a torn/stale body
  returned as `PATRA_OK`. So the connection-per-thread "lock-free parallel reads"
  promise held only for **fixed-width** columns. **This also corrects the 6.3.12
  note below that claimed the probe removed `g_db_lock`:** the lock was **still
  required** — not for the (now-per-handle) table-lookup cache, but for this
  readback atomicity. **Fix (patra 1.12.8, this cycle):** a new `_rs_materialize`
  snapshots every TEXT/BYTES payload into an owned heap buffer *under the query's
  flock*, so `read_text`/`read_bytes` are pure memcpys and result sets are true
  snapshots (no API change; regression `test_text_readback_snapshot` proven to fail
  pre-fix; patra suite 885/885). The probe **keeps `g_db_lock` for now** — it still
  pins patra 1.12.7 — and can drop it once cyrius folds patra 1.12.8 in and the
  probe bumps. Filed + resolved:
  `patra/docs/development/issues/archive/2026-07-03-text-blob-readback-escapes-query-flock-window.md`.
- 🔵 **`mutex_*` duplicate-definition — now FILED upstream.** The 🔵 note from the
  6.3.12 run (below) is a fresh instance of cyrius's known duplicate-fn-across-
  stdlib-modules class (`thread.cyr` ⇄ `sync.cyr` both export `mutex_new/lock/
  unlock` for LINUX; byte-identical, last-def-wins → benign but 3 warnings every
  build). Filed to cyrius (`2026-07-03-duplicate-mutex-fns-thread-vs-sync-stdlib.md`)
  referencing the archived `arena_*` precedent + its proposed dedup hardening.

Net: the probe went from **two workarounds + a lock it thought it had removed** to
**zero residual workarounds** (string global inlined, TLS pool at 4) plus **one
correctly-attributed lock** (`g_db_lock`, for the patra readback race). Suite
**green + stable**: 2 unit + 34 backend + 10 UI, with max_conns=4 verified 5/5.

## Update — re-run on cyrius 6.3.23: str_builder gate SHIPPED → multi-worker TLS fundamentally works (2026-07-01)

Bumped to **cyrius 6.3.23** (the user asked for 6.3.22; cycc auto-drifted 6.3.22→6.3.23
same day — pin matched to the installed cycc) / **patra 1.12.7 / sandhi 1.7.0 / sigil
3.9.7 (folded) / sakshi 2.4.3**. Both cyrius gate slots the probe was waiting on shipped:

- ✅ **`str_builder` concurrency FIXED (cyrius 6.3.15).** Root cause was **array-local
  codegen**, not str_builder itself — `var X[N]` inside a fn was a function-scope
  static shared across threads; 6.3.15 made array locals **per-thread by default**.
  Verified: the minimal repro is **0** (was ~87%), `tests/concurrency_repro.sh` is
  **0/300** (was ~3%), and the probe's concurrency scenarios (verify.py 4/8/10) are
  now **stable** (were flaky). This also cleared the multi-worker-TLS `BAD_SIGNATURE`.
- ✅ **THE PAYOFF — multi-worker TLS fundamentally works.** With str_builder fixed
  + sigil 3.9.7 auto-banking, `max_conns=4` HTTPS serves **100/100 concurrent POSTs
  cleanly** (all unique ids, no crash, no BAD_SIGNATURE). The whole "when str_builder
  lands, multi-worker TLS unblocks" chain is confirmed.

Two findings remain (the probe keeps its workarounds for them):

- 🟡 **cyrius string-literal global fix (6.3.16) is INCOMPLETE at scale.** The gate
  slot shipped and works in SMALL programs (`var S = "…"; patra_open(S)` → ok), but
  in the FULL probe (sandhi + sigil's ~14 MB banked `.bss` + many globals) a
  `var DB_PATH = "yeo.patra"` global still holds **garbage** → `patra_open` SIGSEGVs
  at startup. So the **`db_path()` fn workaround stays.** (This masqueraded as a
  toolchain crash during the bump until bisected to the string-global. Filed
  cyrius-side as a follow-up to the closed 6.3.16 issue.)
- 🟡 **Residual multi-worker-TLS `SSL: RECORD_LAYER_FAILURE`.** Pure concurrent HTTPS
  is clean (100/100), and an untrusted-cert-reject → trusted-handshake sequence is
  clean in isolation (5/5) — but under **verify.py's mixed/accumulated pattern** (34
  HTTP + 9 sequential HTTPS incl. the untrusted-cert reject), `max_conns=4`
  **deterministically** fails a later handshake with RECORD_LAYER_FAILURE (3/3 runs).
  A per-connection TLS-state buildup at >1 worker, not reproducible under pure load.
  So **TLS pool stays at `max_conns=1`** (suite green + stable) until it's root-caused;
  bump to 4 once it is. Filed. **Net: str_builder was the big blocker and it's gone;
  multi-worker TLS is one narrow residual issue away from shippable.**

## Update — re-run on cyrius 6.3.12: most findings RESOLVED upstream; two cyrius-core gate slots remain (2026-06-30)

Bumped to **cyrius 6.3.12 / patra 1.12.7 / sandhi 1.7.0 / sigil 3.9.7 (folded) /
sakshi 2.4.2** (pin matched to the installed cycc to avoid lib/compiler skew).
Verified resolution of each filed finding:

- ✅ **patra table-cache race FIXED (1.12.7)** — `_tbl_lp_idx`/`_page` moved from
  process-global into the db handle. The probe **removed its `g_db_lock`
  workaround**: connection-per-thread parallel reads are now correctness-safe
  (concurrent-read stress: **0/300 corrupt**, was ~90%+ on 6.3.0 even *with*
  serialization). last_insert_id / rows_affected stay per-handle; writers serialize
  via flock. This is the clean win of the bump.
- ✅ **sandhi h2 IPv6 arity FIXED (1.7.0)** — no build warning. ✅ **sandhi
  misleading pooled-TLS comment FIXED (1.7.0)** — both credited in sandhi's
  changelog.
- ✅ **sigil concurrent-TLS crash FIXED (3.9.7) — the crash is gone; no sandhi/sigil
  change needed.** sigil 3.9.7's `cbank()` **AUTO-assigns** a private lane per thread
  (`_crypto_next_bank` atomic counter, 64 banks) — fully transparent, zero per-worker
  opt-in. Verified: max_conns=4 **no longer SIGSEGVs** (server stays alive), and
  sigil's own `concurrent_tls_handshake` / `banking_concurrent` / `ecdsa_concurrent`
  tests pass **18/18**. cyrius 6.3.12 already bundles sigil 3.9.7.
  - 🟡 **DX gotcha that masked this (now the real lesson):** `cyrius lib sync`
    (bare) only refreshes the *declared* `[deps].stdlib` subset, so the probe's
    transitively-pulled `lib/sigil.cyr` stayed **stale at 3.9.4** (the pre-fix
    opt-in banking) while the toolchain bundled 3.9.7 — so the probe built against
    the OLD crypto race and the TLS pool *appeared* to still crash. **`cyrius lib
    sync --full`** pulls the whole snapshot (current sigil 3.9.7). My earlier
    "sandhi must assign per-worker banks" finding was wrong (off the stale lib) and
    is **withdrawn** (`sandhi/issues/2026-06-30-pooled-tls-workers-need-per-worker-crypto-bank.md`).
  - ⚠️ **Remaining max_conns>1 HTTPS blocker = the cyrius `str_builder` gate slot,
    not sigil.** With sigil 3.9.7 (no crash), concurrent HTTPS at max_conns≥2 fails
    with `SSL: BAD_SIGNATURE`: the str_builder race overlaps two workers' response
    buffers, so one mutates *while* `tls_native` encrypts + MACs it → the MAC
    doesn't match the sent bytes. (`tls_native`'s handshake is per-ctx — 0 module
    globals — so this is str_builder, not a tls_native bug.) So the TLS pool stays
    at **1 worker** until `str_builder` lands; then bump to 4.
- 🔴 **cyrius `str_builder` STILL OPEN** — confirmed still reproduces on 6.3.12
  (minimal repro ~87% at 8 threads; HTTP ~1-3%). It's a held "gate slot" in
  cyrius's roadmap (root-caused, needs codegen work). The concurrency scenarios
  stay flaky on it.
- 🟡 **cyrius string-literal global initializer STILL OPEN** (gate slot) — the
  probe keeps the `db_path()` fn workaround.
- 🔵 **NEW: `mutex_*` duplicate-definition warning.** Building on 6.3.12 now warns
  `lib/sync.cyr:44/52/65: duplicate fn 'mutex_new'/'mutex_lock'/'mutex_unlock'
  (last definition wins)` — `sync.cyr` and `thread.cyr` both export the lock API
  with no include guard, and both are now in the probe's closure. Benign on Linux
  (both are real futex impls), but a real stdlib-hygiene smell (the earlier
  "refuted as dormant" collision now actually fires in a consumer build).

Net: **3 of the filed findings shipped + adopted (patra, both sandhi); sigil is
half-done (banks shipped, per-worker wiring missing in sandhi); the two cyrius
compiler findings remain gate slots.** Probe workarounds removed: `g_db_lock`
(patra). Kept: `db_path()` (string-global), TLS max_conns=1 (sigil-via-sandhi).

## Update — deep-dive: a cyrius-CORE concurrency blocker (`str_builder`) + the connection-per-thread bite (2026-06-28)

Investigating "which repos actually need repair," a fix for the probe's patra
read race kept uncovering deeper bugs — ending at a **foundational cyrius-core
blocker**. All filed upstream (see each repo's `docs/development/issues/`).

### 🔴 cyrius `str_builder` is not thread-safe — the headline

Concurrent HTTP responses corrupt **~3% under load**. Reproduced with `curl`
hammering the **static** `/api/health` handler (no DB, no route params, no app
lock — just `json_v` → `resp_json` → `str_builder` → sandhi send): ~3% come back
byte-interleaved across fields, e.g.
`{"status":"ok","service":"yeo-cy-test","version":"0.1.0"}` →
`{"ctatye":"-t","servire":"yeo.c1.0est",...}` ("yeo-cy-test" spliced with "0.1.0").

A minimal N-thread bisect (8 threads × 40 000 iters) pinned it precisely:
**bare `alloc()`, `alloc_via(default_alloc())`, `memcpy`, and a byte-identical
hand-rolled str_builder replica are ALL 100% clean** (millions of ops, 0
failures); the **`str_builder` library functions** (`str_builder_new_a` /
`add_cstr_a` / `build_a`, `lib/str.cyr`) corrupt **~87% at 8 threads, ~50% at 2,
0% single-threaded**, growth not required. The byte-identical-replica-is-clean
result implicates a **compiler miscompilation of those specific functions under
the concurrent call pattern** (or a hidden shared state the source doesn't show)
— not the allocator, not memcpy, not general codegen. This is THE root of the
response corruption and sits **upstream of** the sigil/patra/sandhi findings:
`str_builder` underlies every concurrent string build (sandhi response framing,
`json_v_build`, logging), so **no cyrius concurrent server is correct under load
until it's fixed.** Filed: cyrius `issues/2026-06-28-str-builder-not-thread-safe.md`
(self-contained repro). Probe impact: the concurrency scenarios (verify.py 4/8/10)
are now **flaky** — they intermittently fail on this bug, not a probe defect.
`tests/concurrency_repro.sh` documents it (curl `/api/health` hammer; exits 0 —
diagnostic, not a gate).

### 🔴 patra 1.12.0 connection-per-thread reads are not correctness-safe

P2 (1.12.0) moved patra's parse scratch + page slab to thread-local storage for
parallel reads, but the **table-lookup cache `_tbl_lp_idx` / `_tbl_lp_page`
(`src/table.cyr:4-5`) is still process-global**, written on every query's table
resolution. So two readers — even on **separate per-thread handles** — race it
and one reads the other's cached page → garbled rows. Caught by a concurrent-read
stress that stayed corrupt even with every patra call serialized — which pointed
*outside* the per-handle scope. (NB the 1.11.4→1.12.6 bump also dropped the read
mutex, so a SHARED handle's concurrent reads now race the fd offset too — a shared
handle is only safe *without* read parallelism.) Filed: patra
`issues/2026-06-28-concurrent-read-table-lookup-cache-race.md`.

### 🟡 cyrius string-literal global initializer → SIGSEGV

`var DB_PATH = "yeo.patra";` at top level compiles clean but holds **garbage** at
runtime (cyrius global initializers are integer-only) → `patra_open(DB_PATH)`
crashed at startup. Silent miscompile — no error or warning. Workaround:
`fn db_path(): i64 { return "yeo.patra"; }`. Filed: cyrius
`issues/2026-06-28-string-literal-global-initializer-garbage.md`.

### The connection-per-thread bite (what the probe now does)

Adopted patra's intended **connection-per-thread** model: each sandhi worker
opens its own patra handle, lazily cached in a thread-local slot (`db()`, TLS slot
15 — patra owns 0–4). This makes `last_insert_id` / `rows_affected` per-handle (no
cross-worker readback race) and removes the old `g_wr_lock`. But because patra's
table cache is still global (above), every patra op is serialized under a single
**`g_db_lock`** as the workaround — drop it once patra makes that cache per-handle,
and the per-thread handles already in place give correct parallel reads. The
sigil/sandhi/cyrius findings above also got filed/sharpened in this pass:
**sigil** (the concurrent-handshake crash — broadened: HKDF-primary, per-thread
banks exist but TLS never calls `crypto_bank_set`, `ed25519_sign` unbanked, both
ciphers crash; the AES-GCM-bulk claim was **refuted**); **sandhi** (a shipped
pooled-TLS doc-comment falsely claiming concurrent-handshake safety + the h2 IPv6
arity bug). Net: **repos needing a code repair = cyrius (str_builder 🔴 +
string-global 🟡), sigil (🔴), patra (🔴 for parallel reads), sandhi (🟡), and the
probe itself** (the read-race + string-global, fixed locally).

## Update — re-run on cyrius 6.3.0; adopted sandhi server-TLS; found a 🔴 TLS-concurrency crash (2026-06-28)

Bumped the pins to **cyrius 6.3.0 / patra 1.12.6 / sandhi 1.6.13 (folded into the
toolchain) / sakshi 2.4.0** (was 6.2.21 / 1.11.4 / 1.6.7 / 2.3.1). Baseline
re-verified green on the new pins *before* any code change, then adopted what
shipped. **The two headline TLS findings from the 2026-06-18 bite both shipped
upstream and are now adopted**, and adopting the multi-worker TLS serve loop
immediately surfaced a **new 🔴 server crash**.

### ✅ Resolved upstream + adopted — the hand-rolled HTTPS stack is retired

- **sandhi now has server-side TLS** (`sandhi_server_run_pooled_tls` + the Conn-
  aware router family `sandhi_server_router_handler_c` / `_cp` /
  `sandhi_server_send_response_c` / `sandhi_server_options_tls`, sandhi **1.6.10**) —
  the headline 🔴 "sandhi has NO server-side TLS" from 2026-06-18. sandhi adopted
  the probe's exact `Conn {kind, handle}` seam shape.
- **`tls_native` server-side ALPN** (cyrius **6.2.22**) — the 🟡 "No ALPN
  negotiated" finding. **Now confirmed**: `openssl s_client -alpn http/1.1` →
  `ALPN protocol: http/1.1` (TLS 1.3, `TLS_AES_256_GCM_SHA384`), and a new
  `verify.py` scenario 9i asserts it. sandhi rides the same backend-agnostic ALPN
  hook on both client and server sides now.

So the probe **retired its entire hand-rolled HTTPS stack**: the `Conn` transport
seam, `tls_serve` / `tls_recv_request` accept loop, `_alpn_h1` wire, process-wide
`httpd_ignore_sigpipe`, and probe-owned route table — `src/httpd.cyr` collapsed
~225 → ~95 lines (now just JSON/file response helpers over
`sandhi_server_send_response_c`). One handler set serves both transports:
plaintext :8080 on `sandhi_server_run_pooled` + `_router_handler_cp`, HTTPS :8443
on `sandhi_server_run_pooled_tls` + `_router_handler_c`. Verified: 2 unit + **34**
backend (24 HTTP + 8 HTTPS + ALPN + concurrent-HTTPS) + 10 UI = 46 checks green,
deterministic across repeated runs.

### 🔴 NEW — sigil's crypto scratch is process-global → concurrent TLS handshakes crash the server

The old probe served HTTPS on a **single-threaded** hand-rolled `tls_serve`, so
it serialized handshakes and never exposed this. `sandhi_server_run_pooled_tls`
runs **N worker threads, each doing a full TLS handshake** (that is the whole
point of the pool — TLS handshakes are CPU-heavy and should parallelize). The
moment 2 handshakes run concurrently, the server breaks:

```
concurrency=1 : ok=1
concurrency=2 : 0 ok — server SIGSEGV (exit 139); subsequent connects refused
concurrency≥2 : ECONNRESET / "EOF in violation of protocol" or SIGSEGV
```

**Root cause: `sigil` (the crypto lib) uses ~60 module-GLOBAL scratch buffers** —
e.g. `_sha_ni_st_ctx[144]`, `_aes_ni_st_key/_rk/_pt/_ct`, `_bn_modrem` /
`_bn_modn1` / `_bn_exp_*` / `_bn_mont_*` / `_bn_inv_*` (bignum modexp + Montgomery
accumulators). Every TLS handshake drives SHA (transcript), AEAD, bignum, and the
Ed25519 CertificateVerify signature through these shared globals. With per-worker
arenas the *allocations* are isolated, but the **crypto scratch is not** — two
concurrent handshakes interleave on the same global buffers → corrupted handshake
output (ECONNRESET) or out-of-bounds/overwrite (SIGSEGV). Confirmed it is *not*
the obvious suspects: `alloc()` is CAS-locked (thread-safe), and `tls_native`'s
transport/entropy hooks (`_tn_tx_read/_write/_now/_rand`) are documented "set once
at init" (default entropy = `sys_getrandom` syscall).

**Why sandhi's own gate (`programs/_server_tls_probe.cyr`) missed it**: its
"burst of 8" runs through a single-threaded parent `while` loop — each
`_https_get` completes before the next starts, so handshakes are **serialized**.
Its "[3] isolation" pins a worker by holding a **plaintext** silent TCP socket
(`sandhi_conn_open(...,0,"")`) in the accept-read, then does 8 *more sequential*
GETs — proving the pool isn't single-flight, but **never running 2 concurrent TLS
handshakes**. So the multi-worker TLS pool's core promise (parallel handshakes
across cores) was never actually exercised.

**Probe workaround**: pin the TLS pool to **1 worker** (`max_conns=1`) —
handshakes serialize, the server is crash-safe (exactly as the old
single-threaded `tls_serve` was), and 60 concurrent HTTPS clients all succeed
(scenario 10, a tripwire that fails loudly if the pool is bumped back to >1 before
sigil is fixed). Plaintext HTTP stays at 4 workers (no crypto → no sigil scratch).
**This is the real find of the bite**: the security product's TLS termination
can't yet use more than one core. *Filed upstream (sigil / cyrius crypto):
make the crypto primitives thread-safe (per-call or thread-local scratch) so
`run_pooled_tls` can serve handshakes in parallel.*

### 🟡 NEW — sandhi h2-promote IPv6 path passes 8 args to a 9-arg fn

Building against folded sandhi 1.6.13 emits
`warning: '_sandhi_conn_open_v6_fully_timed_a' expects 9 arguments, got 8`. In
`src/http/h2/dispatch.cyr:145` the IPv6 h2-promote branch calls
`_sandhi_conn_open_v6_fully_timed_a(a, addr6, port, 1, host, connect_ms, read_ms,
write_ms)` — missing the trailing `ctx` the function gained in the **1.6.9**
per-call reqctx change (the sibling IPv4 branch and `client.cyr`'s calls were
updated; this one was missed). So an IPv6 h2 promotion reads a garbage 9th arg as
the per-request ctx. Client-side + IPv6 + h2 only — the probe (server-side) never
hits it, but it's a latent wrong-arg. *Filed cyrius/sandhi-side.*

### Still open (not the probe's to fix)

- sigil crypto thread-safety (the 🔴 above) — blocks a multi-core TLS pool.
- patra **P2 concurrent readers** — a single process-global mutex still serializes
  all DB ops (the probe's own earlier request).
- macOS SIGPIPE on `net.cyr` `sock_send` (no `MSG_NOSIGNAL`); sandhi
  middleware/auth; ~400 KB static `.bss` (cyrius DCE keeps unreachable-fn `.bss`).

## Update — full stack demonstrated together (2026-06-18)

Fleshed the frontend from a list+add shell into a **real CRUD dashboard** that
exercises the *entire* `/api/notes` resource from the browser: a `#/notes/:id`
detail/edit route (GET by id → PUT), per-row delete (DELETE), and live Home
status. Added `tests/ui_check.mjs` — a **headless full-stack proof** that loads
the actual cyrius-emitted `web/app.js` into a minimal DOM+fetch shim against a
running server and drives the rendered UI end to end (list → add → open detail →
edit → delete), cross-checking the rendered DOM against the patra backend at each
step. **42 automated checks now green**: unit (2) + backend e2e (32) + full-stack
UI e2e (10), via `tests/run.sh`.

- ✅ **The TS/TSX→JS emitter handles a real multi-view CRUD SPA cleanly** (a
  positive result). The enhanced `app.tsx` — multiple components, a parameterized
  hash route, nested `async` arrow handlers (`onsubmit`/`onclick`), an arrow
  returning an object literal (`jsonInit`), template-literal URLs, `as` casts, and
  passthrough of browser builtins (`parseInt` / `Number.isNaN` / `slice`) —
  emitted to valid browser JS (`node --check` clean) that **runs and drives the
  real backend correctly**. No emit rough edges surfaced in this pass (the
  `async`+nested-arrow bug fixed in 6.1.15 stays fixed across the bigger surface).
- ✅ **The whole stack composes**: `web/app.tsx` → `cyrius build --target=js` →
  browser JS → `fetch` → sandhi router → patra → JSON → JSX render, with the UI
  and patra cross-checked. This is the end-to-end "it comes together" milestone the
  probe set out to prove — backend (HTTP+HTTPS), storage, and a cyrius-built
  frontend, all integrated and verified.
- 🔵 **Frontend XSS-safety is by construction**: the emitter's `h()` runtime
  appends user content via `element.append(String(x))` (a text node), never
  `innerHTML`, so a note body of `<img onerror=…>` renders as text (asserted in
  the UI check). Pairs with patra's bound-parameter storage safety — the data path
  is injection-safe end to end.

## Update — HTTPS / TLS serving (2026-06-18)

Added an **HTTPS listener on :8443 over `tls_native` + `sigil`** (the pure-Cyrius
TLS stack), serving the same routes as the plaintext HTTP :8080 listener — both
run together, sharing one handler set. SecureYeoman is a "secure, local-first"
product whose entire auth stack (OIDC/PKCE, WebAuthn, bearer tokens, secrets) is
meaningless over plaintext, so TLS termination on the server is the load-bearing
layer for the port. **Verified end to end: 32 scenarios (24 HTTP + 8 HTTPS) pass**
— TLS 1.3 handshake (`TLS_AES_256_GCM_SHA384`, `Verify return code: 0`), full
CRUD over TLS, injection/unicode-safe bodies over TLS, **real cert verification**
(a default-CA client is rejected, not silently trusted), HTTP↔HTTPS sharing one
patra backend, and HTTP coexisting with HTTPS.

**Verdict: `tls_native` is a viable pure-Cyrius server TLS stack** (TLS 1.3,
Ed25519 cert/key, interops with an OpenSSL client, chain+hostname verify). The
gaps are all in *integration*, not crypto:

- 🔴 **sandhi has NO server-side TLS — the headline.** `sandhi_server_run` /
  `_run_async` / `_run_pooled` take only `{idle_ms, max_conns}` and every send
  path (`send_response`/`send_status`/`router_handler`) writes plaintext via
  `sock_send`; there is no cert/key/TLS hook and no frame-to-buffer helper. So
  serving HTTPS meant **bypassing sandhi's serve loops entirely** and hand-rolling
  the accept→`tls_native_accept`→read→dispatch→write→close loop (`tls_serve` in
  `src/httpd.cyr`). sandhi already composes `tls_native` for its *client* side —
  the ask is the symmetric server side: a TLS option on the server (cert/key/ALPN)
  or a transport seam so the existing serve loops + router work over TLS. *(Filed
  to sandhi's roadmap.)*
- **The `Conn` transport seam (architecture consequence).** Because sandhi's send
  path is plaintext-welded, the probe introduced a `Conn {kind, handle}` so one
  handler set serves both transports: handlers write via `resp_*(conn,…)` and
  `conn_write` dispatches `sock_send` (plaintext) vs chunked `tls_native_write`
  (TLS). sandhi's request **matcher** (`sandhi_server_route_match`) and accessors
  are transport-agnostic and reused; its **dispatch/handler** are not, so the
  probe re-grew a tiny route table + a conn-aware `srv_dispatch`. Net evolution of
  the earlier sandhi-router adoption: **sandhi's matcher is the durable win; its
  router_handler / run_pooled send path are plaintext-only.** Plaintext still runs
  on `run_pooled` via a `_plain_handler` adapter (wraps the raw fd in a Conn).
- 🟡 **`tls_native` server-side ALPN is not implemented.** `tls_native_set_alpn`
  wires only the *client* offer (ClientHello ALPN, `tls_native_hs13.cyr:38-91`);
  there is no server path that reads the client's ALPN and emits a selection in
  EncryptedExtensions. Confirmed: `openssl s_client -alpn http/1.1` →
  **"No ALPN negotiated."** HTTP/1.1 works (the default), but **h2-over-TLS is
  unreachable with a `tls_native` server.** *(Filed cyrius-side — `tls_native`.)*
- 🔵 **RSA server keys unsupported** (`tls_native` accepts Ed25519 / ECDSA P-256 /
  P-384 only; `_tn_load_privkey` returns `TLS_ERR_KEY_UNSUPPORTED` for RSA). Used
  Ed25519 (`gen-certs.sh`). Worth flagging: most ACME/Let's-Encrypt + existing SY
  certs default to RSA/ECDSA, so the port needs ECDSA/Ed25519 issuance.
- 🔵 **No cert/keygen / PKI tooling.** Had to shell out to `openssl` to mint the
  cert; there's no first-party self-signed-cert generator, keygen helper, or ACME
  client, and no tie-in to SecureYeoman's secret manager for the private key.
- **`tls_native` usage contract** (for the port, no server example existed in
  sandhi — mirrored `cyrius/tests/tcyr/tls_native_ed25519.tcyr`): the ctx is
  **per-connection** (`new_server` each accept; not reusable; bump-alloc'd, no
  free → reset an arena per conn in production); `tls_native_write` **caps at
  16 KiB** (must chunk — `tls_write_all`); `tls_native_read` returns **one record**
  (must loop to assemble a request — `tls_recv_request`, since
  `sandhi_server_recv_request` is plaintext-only); `tls_native_close` sends
  close_notify but does **not** free the ctx or close the fd (caller `sock_close`s).
- **SIGPIPE shim reintroduced.** `run_pooled` installs the SIGPIPE guard only for
  its own loop; the hand-rolled TLS accept loop writes records via `sys_write`, so
  the probe reinstalls `httpd_ignore_sigpipe()` process-wide at startup.

### ⚠️ Confirmed (and fixed): the patra shared-handle readback race

While refactoring onto the Conn seam, the **scenario-8 concurrency probe caught
the shared-handle `rows_affected` race for real** — a concurrent existing-id PUT
returned a **spurious 404** (the `UPDATE` set `DB_ROWS_AFFECTED=1`, a concurrent
missing-id `UPDATE` overwrote it to `0` before the readback). Reproduced ~1 run in
5 (tight window). This **upgrades the earlier "latent, did not reproduce" finding
to confirmed**. Fix: a **narrow `g_wr_lock`** pairs each `[exec_prepared;
readback]` (create's `last_insert_id`, PUT/DELETE's `rows_affected`) atomically
across writers; reads (SELECT) don't touch those fields, so list/get stay
lock-free. Now deterministic (8/8 runs, scenario 8 always 0 misclassifications).
This **strengthens the filed patra request** (`requests/2026-06-18-…-insert-returning-id`):
the app lock negates P1's lock-free benefit for exactly the insert-then-echo /
write-then-check REST patterns — which is why an **atomic insert-returning-id /
per-statement result** is the real fix.

(Aside: the earlier note that `src/httpd.cyr` fails `cyrius fmt --check` is now
moot — the TLS rewrite removed the multi-line `send_response` call that triggered
it; all three sources are fmt-clean. The cyrius `fmt --check` continuation bug
itself is unchanged.)

## Update — re-run on Cyrius 6.2.21 + adopting what shipped (2026-06-18)

Bumped the pins to **cyrius 6.2.21 / patra 1.11.4 / sandhi 1.6.7 / sakshi 2.3.1**
(was 6.2.18 / 1.11.2 / 1.6.5 / 2.3.1). sandhi is folded into the cyrius
toolchain, so the cyrius bump pulls sandhi 1.6.7 via `cyrius lib sync`; patra is
the only separately-tagged dep bumped (1.11.2 → 1.11.4). Regenerated `lib/` +
deps, rebuilt (TS/TSX→JS emit clean, backend OK), and re-ran the whole suite:
**2 Cyrius unit invariants + 24 end-to-end scenarios all pass, nothing
regressed** across the 6.2.18→6.2.21 / 1.11.2→1.11.4 / 1.6.5→1.6.7 forward.

### The headline: the findings this probe filed shipped upstream

Every blocker/request this probe filed against the ecosystem is now resolved
(evidence cross-checked against upstream source, file:line):

- ✅ **sandhi server-side route table — SHIPPED (sandhi 1.6.7).**
  `sandhi_router_new` / `sandhi_router_add` / `sandhi_server_route_match` /
  `sandhi_route_param_int` / `sandhi_server_router_handler` — `:name` capture +
  method dispatch + 404/405, the exact shape this probe filed (the probe's old
  `route_match` was the reference). Adopted (bite 3 below).
- ✅ **sandhi thread-pool serve mode `sandhi_server_run_pooled` — SHIPPED
  (sandhi 1.6.7).** A fixed worker-thread pool with a bounded handoff channel —
  the request this probe filed, naming yeo-cy-test as first asker. Adopted
  (bite 4 below).
- ✅ **sandhi SIGPIPE DoS guard — SHIPPED (sandhi 1.6.6),** crediting this
  probe. sandhi installs `SIG_IGN` for SIGPIPE in its serve loops
  (`_sandhi_server_ignore_sigpipe`). NB the fix is server-loop-side; `net.cyr`
  `sock_send` is *still* a bare `sys_write` with no `MSG_NOSIGNAL` (cyrius has no
  stdlib `signal_ignore` yet — OPEN), so a consumer running its *own* loop over
  sandhi's per-request fns still needs its own guard. Adopting `run_pooled`
  (bite 4) gets the guard for free → the probe's shim was removed.
- ✅ **sandhi docs (companion modules + "bayan not json") + stale `run_async`
  leak comment — DONE (sandhi 1.6.6).**
- ✅ **patra `last_insert_id` / `rows_affected` readback — SHIPPED (patra
  1.11.3),** crediting this probe. Adopted (bites 1–2 below).
- ✅ **patra undocumented sakshi transitive dep — DOCUMENTED;** patra's earlier
  arcs (column-list INSERT, AUTOINCREMENT, TEXT, bind params, thread-safety P1)
  are all shipped per patra's archive.
- ✅ **cyrius async ~32 B/conn task-struct leak — RESOLVED (cyrius 6.1.22,**
  before the pin; `async_new_in(arena)` + `reset_via`). The probe doesn't use
  async (it used a thread pool, now sandhi's), so this is informational.

Still open (not the probe's to fix — tracked upstream): macOS SIGPIPE guard +
portable stdlib `signal_ignore`/`MSG_NOSIGNAL` (cyrius); patra **P2 concurrent
readers** (single process-global mutex serializes all DB ops — the probe's own
open request); sandhi middleware/auth layer; server-only ~400 KB static h2/tls
`.bss` (closed won't-fix on sandhi, re-filed against cyrius).

### What got adopted, and what each kicked back (4 verified bites)

Each was done as a separate bite and re-verified against the full suite.
**Net effect: the probe is now a thin sandhi + patra composition** —
`src/httpd.cyr` collapsed from a 353-line hand-rolled HTTP server to 83 lines
of response/body glue; everything above the socket is sandhi.

**Bite 1 — patra `rows_affected` (✅ adopted).** `PUT /api/notes/:id` drops its
pre-`SELECT` existence round-trip: it now `UPDATE`s and returns 404 when
`patra_rows_affected(g_db) <= 0` (one statement, not two). `DELETE` now returns a
real **404 on a missing id** (the old idempotent-200 was a *workaround* for the
missing count, not a REST preference; idempotent-200 is also valid — switched to
exercise the API). A dedicated concurrency probe (scenario 8: concurrent PUTs to
existing **and** missing ids) found **0 misclassifications** under 120 concurrent
mixed PUTs. 🔵 Caveat: `rows_affected` reads a *shared-handle* field
(`DB_ROWS_AFFECTED`), so the `UPDATE` + readback are only atomic if no other
write interleaves on `g_db`; the window is a couple of instructions and did not
manifest, but it is a latent hazard (see the `last_insert_id` finding).

**Bite 2 — patra `last_insert_id` + `AUTOINCREMENT` (✅ adopted, with caveats
filed).** Schema is now `id INT AUTOINCREMENT`; create uses a column-list
`INSERT INTO notes (body, created)` (omitting the id) and echoes
`patra_last_insert_id(g_db)`. The app-side `g_next_id` + `MAX(id)` seeding +
`atomic_fetch_add` are gone. **It works — 250 concurrent POSTs returned 250
unique ids that form a bijection (subset) with the stored rows.** Two caveats:
- 🔵 **Shared-handle `last_insert_id` echo race.** `DB_LAST_ID` is one field on
  the shared handle; the `INSERT` and the readback are two separate ops with no
  app lock between them, so a concurrent `INSERT` can overwrite it before the
  read → the echoed id could be another worker's. **Stress-tested to provoke it:
  24 workers × 2400 inserts across 6 rounds — the echoed↔stored bijection held
  every round; the race never reproduced** (the window is too tight). It remains
  a real correctness hazard by inspection. The race-free production choice is
  either app-assigned atomic ids (what the probe had — also strictly monotonic)
  or a patra **atomic insert-returning-id** API. *(New 🔵 filed to patra: an
  `INSERT … RETURNING id` / id-from-`exec_prepared` so the assigned id is read
  back atomically under the statement mutex, removing the shared-handle race for
  concurrent inserts.)*
- 🔵 **`AUTOINCREMENT` is derive-from-MAX → ids are reused.** Observed
  concretely in the suite: after a create+delete left the table empty, the next
  create **reused id=1** (the prior app-assigned atomic ids were never reused).
  Fine for many apps; if globally-never-reused ids are required, keep
  app-assigned ids. (Matches patra's own documented behavior; not strict-SQLite
  AUTOINCREMENT.)
- Side note (DX, unrelated): a `ConnectionResetError` data point surfaced while
  stress-testing — see bite 4.

**Bite 3 — sandhi server route table (✅ adopted).** Replaced the probe's
hand-rolled router (`router_new`/`route_add`/`route_match`/`router_dispatch` +
the `Req` struct + `req_*` accessors) with `sandhi_router_new` / `_add` and
`sandhi_server_router_handler`. Handlers moved to sandhi's signature
`fn(app_ctx, cfd, req_buf, req_len, params)`, reading the body via
`sandhi_server_body_offset` and path params via `sandhi_route_param_int`. The
`src/test.cyr` `route_match` unit test now validates **sandhi's** matcher (a
consumer-side regression guard on the behavior the resource needs). One
behavior delta: 404/405 are now sandhi's plain status responses, not the probe's
JSON `{"error":…}` bodies (status codes unchanged; the suite checks codes). Drop-in
clean — sandhi's matcher is algorithmically identical to the probe's filed shape.

**Bite 4 — sandhi `sandhi_server_run_pooled` (✅ adopted).** Deleted the probe's
accept loop + worker pool + `httpd_ignore_sigpipe` shim; `main` now calls
`sandhi_server_run_pooled(INADDR_ANY(), 8080, &sandhi_server_router_handler,
router, opts)` with `max_conns = 4` (the fixed worker count, matching the old
pool). Gains: the SIGPIPE `SIG_IGN` guard installed by run_pooled itself
(verified — scenario 7 survives 10 mid-exchange disconnects **with the probe's
shim gone**) and a per-connection `SO_RCVTIMEO` slowloris guard the hand-rolled
pool lacked. Slow-client isolation still holds (~1 ms health while 2/4 workers
held). 🔵 Load-shedding data point: run_pooled's handoff channel is sized to the
**worker count** (4), so under a thundering herd it relies on the listen backlog
(128); it served 250 and **600** simultaneous POSTs with **0 errors** but shed
~18% at a **1000**-conn burst via clean `ConnectionResetError` (no data loss —
every accepted request stored, ids unique). Expected bounded-accept-loop
backpressure, amplified by patra's single write mutex (P2). For production, size
`max_conns` to expected concurrency; *(possible sandhi 🔵: a handoff-channel /
backlog depth decoupled from the worker count would absorb bursts better.)*

### Cyrius DX, re-confirmed on 6.2.21

- 🟡 **`cyrius fmt <file> --check` still flags a multi-line call it won't fix.**
  `src/httpd.cyr` fails `--check` (exit 1) on the two-line
  `sandhi_server_send_response(…)` continuation in `resp_raw`/`resp_file`, yet
  apply-mode `cyrius fmt` produces a **byte-identical** file. This is the same
  continuation false-positive filed earlier — **still present on 6.2.21**, and
  `--check` still prints no location. (Left the readable multi-line form rather
  than write 155-char lines to appease it.)
- 🔵 The `cyrius pin --latest` one-shot convenience is still not shipped (only
  `cyriusly use <ver>` + detect-only `cyriusly update`); the pin-drift warning
  UX is shipped. Bumping the pin is still a manual edit.

## Update — re-run on Cyrius 6.2.18 (2026-06-17)

Re-ran the whole slice on **cyrius 6.2.18 / patra 1.11.2 / sakshi 2.3.1** (was
6.1.15 / 1.10.3 / 2.2.6 — a full cyrius minor forward). Bumped the three pins
(`cyrius.cyml`), regenerated `lib/` + deps (`cyrius lib sync && cyrius deps`),
and rebuilt. **Everything still works, nothing regressed**, and the headline
finding from the last concurrency milestone is now **closed upstream**.

- ✅ **patra thread-safety P1 — SHIPPED (patra 1.11.0), workaround removed.**
  The 2026-06-09 milestone filed that patra was not thread-safe (one shared
  handle + global parse/bind scratch), forcing the probe to serialize *all* DB
  access under an app-level `g_db_lock`. patra 1.11.0 fixed it: a process-global
  futex mutex now serializes every self-contained statement op (`patra_exec` /
  `patra_query` / prepared ops), and result-set accessors operate on
  caller-owned result sets. patra's own roadmap says *"consumers drop their
  external `g_db_lock`"* — so this probe did. `src/main.cyr` no longer takes any
  app-level DB lock; the one thing patra doesn't cover (the app's `g_next_id`
  allocation) is now lock-free via `atomic_fetch_add(&g_next_id, 1)`. The
  `list`/`create` handlers call patra directly.
  - **Re-verified end to end**: clean build (frontend emit + `node --check`,
    backend compile); the patra bound-text invariant test passes; an
    injection+unicode body (`O'Brien'); DROP TABLE notes--  ☃ 日本語`)
    round-trips verbatim and survives a restart; **250 concurrent POSTs → 250
    unique contiguous ids, 0 errors, no lock**; a slow client holding 2 of 4
    workers leaves `/api/health` at ~10 ms.
- 🔵 **patra has no `last_insert_id` / rowid-return.** With P1 done, the natural
  cleanup was to drop the app `g_next_id` entirely and use patra's
  `AUTOINCREMENT` (shipped 1.10.1). But there's no API to read back the
  auto-assigned id after an INSERT, so echoing the created row in the `201`
  response would require a racy `SELECT MAX(id)`. Kept explicit app-assigned ids
  (now lock-free via atomics) instead. A `patra_last_insert_id(db)` would make
  `AUTOINCREMENT` usable for insert-then-echo APIs (the common REST shape).
- 🔵 Both original 🔴 blockers (TS/TSX→JS emit, patra string safety) and the
  6.1.15 `async`+nested-arrow emit fix all **hold on 6.2.18** — no re-breakage
  across the 6.1→6.2 minor.

### Widened the surface: a full single-note REST resource (2026-06-17)

To flush out more SY-shaped surface, extended `/api/notes` from
list+create to a full resource: **`GET` / `PUT` / `DELETE /api/notes/:id`**.
Every SecureYeoman endpoint is a parameterized resource, so this stresses two
areas the earlier probe never touched — path-param routing and patra's
UPDATE/DELETE/WHERE SQL — and is verified end to end (13-case lifecycle:
get-by-id, 404 on missing, 400 on non-numeric id, update w/ injection payload,
idempotent delete, 405 on unmapped method, trailing-slash rejection, restart
persistence) plus a `route_match` unit test in `src/test.cyr`.

- ✅ **patra UPDATE / DELETE / SELECT…WHERE with bound params all work**
  (v1.10.2 bind support, exercised here for the first time). `SELECT … WHERE
  id = ?`, `UPDATE … SET body = ? WHERE id = ?`, and `DELETE … WHERE id = ?`
  via `patra_prepare` + `patra_bind_int`/`patra_bind_text` + `patra_exec_prepared`
  / `patra_query_prepared`. `?` placeholders bind in occurrence order (SET
  before WHERE). The documented *"WHERE on a TEXT column never matches"*
  constraint doesn't bite here — the key (`id`) is INT.
- 🔵 **patra has no rows-affected / `changes()` API.** A bare `UPDATE`/`DELETE`
  on a non-existent id returns `PATRA_OK` with no way to learn that zero rows
  matched, so an endpoint can't tell "updated" from "nothing there." The probe
  works around it for `PUT` with a pre-`SELECT` existence check (an extra
  round-trip); `DELETE` stays idempotent-200 (valid REST). Wanted:
  `patra_rows_affected(db)` after a write. Pairs with the `last_insert_id` gap
  below — both are the "what did that write do?" readback that REST handlers
  need. (Filed to patra's roadmap; another agent owns patra.)
- 🔵 **No `last_insert_id` / rowid-return after INSERT.** (carried from above)
  With P1 done, the natural cleanup was to drop the app `g_next_id` and use
  patra's `AUTOINCREMENT` (1.10.1), but there's no API to read back the
  auto-assigned id for the `201` echo. Kept app-assigned ids (lock-free atomics).
- 🔵 **Cyrius allows forward function references within a file** (DX positive):
  `handle_list_notes` calls `note_row_json` defined later in `main.cyr` and it
  compiles fine — no forward declarations needed, unlike C. Worth knowing for
  the port (don't topologically sort helpers).

### ⚠️ Correction: the HTTP server abstraction exists — it's `sandhi`

**The original Verdict #4 ("No HTTP server abstraction") and the
"stdlib has no `http_serve`/router" notes below are WRONG — they looked at the
wrong layer.** Cyrius's model is: **top-level stdlib = primitives; the fuller
ecosystem libs hold the real functionality.** The services lib is **`sandhi`**
(it's where patra-for-storage's equivalent lives for HTTP). `sandhi/server` —
itself a lift of stdlib `lib/http_server.cyr` — already provides essentially
everything `src/httpd.cyr` hand-rolled, plus security this probe lacks:

- `sandhi_server_run(addr, port, handler, ctx)` (sync) and
  `sandhi_server_run_async(…, opts)` (concurrent via `lib/async.cyr`'s event
  loop, arena-bounded recv buffers) — so concurrency is built in; the
  hand-rolled worker pool isn't needed.
- `sandhi_server_recv_request` (= `httpd_recv_full`), `sandhi_server_get_method`
  / `get_path` / `get_param` (query) / `path_segment`, `sandhi_server_send_response`
  / `send_status` / `send_204` / chunked send (= the `resp_*` framing).
- **Request-smuggling defenses** — `sandhi_server_request_has_cl_te_conflict`
  and `_has_dup_smuggling_header` — which `httpd.cyr` does **not** have. This is
  the strongest reason to sit on `sandhi` for the real SY port.

What `sandhi` does **not** provide yet (its own roadmap: "routing, middleware,
and auth primitives layer on top in later milestones"): a **route table**.
`sandhi_server_run` dispatches to a single handler. So the probe's `route_match`
(method + `:name` path-param dispatch, built on `path_segment`-style splitting)
is exactly the missing layer — **useful feedback for sandhi's routing
milestone**, not a stdlib gap. Known `sandhi` caveat: `run_async` leaks ~32 B
per connection via `lib/async.cyr`'s task structs (filed cyrius-side:
`docs/issues/2026-06-09-async-runtime-no-free-task-leak.md`).

### Ported onto sandhi (2026-06-17)

Done. `src/httpd.cyr` is now a thin shim over `sandhi/server`: each worker calls
`sandhi_server_recv_request` / `get_method` / `get_path` / `path_only` /
`find_header` / `body_offset` / `send_response` / `send_status`, and the
CL-TE / duplicate-header smuggling rejects, instead of the hand-rolled
equivalents. Kept on top (the two things sandhi lacks): the method+path route
table + `:name` matcher (`route_match`), and the worker-thread pool (sandhi's
`run` is single-flight, `run_async` cooperative — neither gives true multi-core
parallelism, which SY's axum backend has). `main.cyr`'s handlers + patra storage
were unchanged (the `resp_*` / `req_*` signatures were preserved). Deps added:
`sandhi` + its transitive modules `tls`, `async`, `random`, `fdlopen`, `dynlib`,
and `json` dropped in favor of `sandhi`'s bundled `bayan`.

Verified end to end on the sandhi-backed server: 13-case CRUD lifecycle, 250
concurrent POSTs → 250 unique contiguous ids, slow client holding 2/4 workers
leaves `/api/health` ~10 ms, **and the new smuggling rejects** — `Content-Length`+
`Transfer-Encoding` coexistence → 400, duplicate `Content-Length` → 400, sane
request → 200. Gains over the hand-rolled server: those smuggling defenses, a
strict RFC-7230 `Content-Length` parser, and a maintained wire layer.

Findings filed to sandhi's roadmap (another session owns sandhi):

- 🔴 **HIGH: the server doesn't guard SIGPIPE** — a client that sends a request
  line then disconnects (or drops mid-response) makes `sock_send` raise SIGPIPE
  and the **default disposition terminates the whole server** (verified: signal
  13, a trivial remote DoS). `net.cyr` `sock_send` uses no `MSG_NOSIGNAL` and
  sandhi installs no `SIG_IGN`. The probe works around it exactly like the patra
  shims: `httpd_ignore_sigpipe()` installs `rt_sigaction(SIGPIPE, SIG_IGN)` at
  `httpd_serve` startup (x86_64: syscall 13). After the fix the server survives
  every partial/empty/disconnect case. (This bug was latent in the old
  hand-rolled server too — same `sock_send` — the port's partial-request tests
  just exposed it.)
- 🟡 **Documentation** (not a bug — libs are opt-in by design): adding `sandhi`
  needs the companion modules `tls`/`async`/`random`/`fdlopen`/`dynlib` opted in
  too (undefined-symbol errors otherwise), and JSON must be `bayan` **not**
  `json` — `bayan` (the `json_v_*` successor) and `json` both define `json_v_*`/
  `_jv_*`/`_jp_*`, so opting into both collides regardless of sandhi. A
  "Requires: …" line in sandhi's docs would close it.
- 🔵 **Server-only use carries the whole client/h2/tls surface** (~400 KB static
  `.bss` of h2/hpack/tls tables `CYRIUS_DCE=1` can't reclaim). Not a new ask —
  a data point for the long-term **bundled-libs → individual-packages split**;
  a plaintext-HTTP server is the consumer that'd benefit from a server-only
  package.
- **Filed a request: thread-pool / true-parallel serve mode.** Both sandhi serve
  loops are single-threaded (`run` single-flight, `run_async` cooperative), so a
  blocking/CPU-bound handler serializes the rest — SY's axum backend is
  multi-threaded, so the port needs real parallelism. Filed on sandhi's roadmap
  (yeo-cy-test as first asker) proposing `sandhi_server_run_pooled`, with this
  probe's `httpd_serve`/`_httpd_worker` thread pool as the reference shape. Until
  then the probe keeps that pool feeding sandhi's (pool-safe) per-request fns.
- 🔵 Also filed: a stale `run_async` leak doc-comment (the header still claims
  ~32 B/conn; the inline 1.5.3 note + code show it was fixed to zero residual).

## Update — re-run on Cyrius 6.1.14 → 6.1.15 (2026-06-08)

Re-ran the slice on **cyrius 6.1.14** then **6.1.15**, **patra 1.10.3**,
**sakshi 2.2.6** (was 6.0.3 / 1.9.5 / 2.2.5). **Both 🔴 blockers from the 6.0.3
verdict are now closed**, verified end to end on this machine; the one emit bug
found along the way was fixed in 6.1.15 (below). Pin is **6.1.15**.

- ✅ **TS→JS / JSX emit — CLOSED** (cyrius 6.1.11+). `cyrius build --target=js
  web/app.tsx web/app.js` (and `cycc --emit-js`) lowers the real `web/app.tsx`
  to browser JS: types stripped, JSX lowered to an `h(tag, props, …children)`
  runtime emitted as a prelude. `web/app.js` is now a **generated artifact**
  (the hand-lowered stopgap is retired) and `build.sh` runs the real emit.
  Verified: `node --check` clean, and the emitted bundle *runs* in a DOM shim —
  `fetch` → JSX render → form submit all work, and a body containing
  `<img onerror=…>` is appended as a **text node** (XSS-safe by construction).
- ✅ **patra string safety — CLOSED** (patra 1.10.3). `?` placeholders +
  `patra_prepare` / `patra_bind_text` / `patra_bind_int` / `patra_exec_prepared`
  replace the base64 stopgap; the `body` column is now `TEXT` (no 256 B cap).
  Verified: `O'Brien'; DROP TABLE notes--` and a 400-byte body round-trip
  verbatim and survive a restart; the table is intact (no injection).

Issues surfaced and resolved along the way:

- ✅ **`--target=js` misplaced `async` with a nested arrow — FIXED in 6.1.15.**
  On 6.1.13/6.1.14, an `async function` whose body contained a nested arrow
  (e.g. `xs.map(x => …)`) emitted with `async` **stripped from the owner** and
  stamped on the inner arrow → a bare `await` → `SyntaxError` under
  `node --check`. Filed with a minimal repro + root cause (now archived at
  `cyrius/docs/development/issues/archived/2026-06-08-yeo-cy-test-emit-js-async-nested-arrow.md`);
  fixed by cyrius 6.1.15 — `async` now binds to the function node it was parsed
  on rather than the first nested arrow. The temporary `noteRows`
  sync-helper workaround in `web/app.tsx` has been **removed** — the idiomatic
  `.map((note) => NoteRow({ note }))` inside async `render()` now emits valid JS
  (re-verified: `node --check` clean + DOM harness passes).
- ✅ **Vendored `./lib/` shadow — RESOLVED.** The probe tracked a full stdlib
  copy under `lib/` (from `cyrius init`, 6.0.3-era) that shadowed the
  version-pinned `~/.cyrius/versions/<ver>/lib/`, compiling against stale
  stdlib. `lib/` is now **untracked + gitignored** and regenerated locally with
  `cyrius lib sync` (stdlib from the pin) + `cyrius deps` (external deps). The
  build is clean — no shadow warning — and reproducible from a fresh checkout.
- 🟡 **`cyrius build` warns on pin drift** — `cyrius.cyml pins X but cycc is Y`.
  Useful (caught the 6.1.13→6.1.14 bump mid-session), but the only remedy is to
  edit the pin by hand; a `cyrius pin --latest` convenience would help.

Note: the 6.0.3 findings below are **historical** — the two blockers are
resolved above; the patra INSERT-column-list / STR-cap / sakshi-transitive
items were tracked separately into patra and are partly addressed (TEXT column,
bind params). Left intact as the original record.

---

## Verdict

A complete, persistent full-stack slice — Cyrius HTTP server + patra SQL storage
+ JSON API + a TS/TSX-validated, browser-served frontend — **stands up today on
Cyrius 6.0.3.** Everything in the thin-slice target works end to end and survives
restarts. Cyrius is viable for the SecureYeoman backend port now; the dashboard
port is gated on one missing capability.

Top things to fix, in priority order for the port:

1. 🔴 **TS→JS / JSX emit** — the parser is excellent but there's no codegen, so
   the frontend can be *validated* by cyrius but not *built* by it. This is the
   single blocker for "build the TS/TSX frontend just by cyrius."
2. 🔴 **patra string safety** — no SQL escaping and no bind parameters, so
   arbitrary user text can't be stored safely (we base64-worked-around it). SY
   stores lots of free text; this needs `patra_bind_*` before the port.
3. 🟡 **Tooling exit codes & stdin** — `cyrius build` and `ts_test_runner`
   return 0 on failure, and `cycc --parse-ts` blocks on stdin; all three break
   scripted/CI use until fixed.
4. 🟡 **No HTTP server abstraction** — everything above the raw socket is
   hand-rolled; a small `httpd.cyr` (router + request parse + response framing
   + a concurrency story) would carry the whole port.

## Toolchain & scaffolding

- 🔵 `cyrius init` emits a stray trailing `---` line at the end of generated
  `cyrius.cyml` (line 16). The build tolerates it, but it reads like an
  accidental YAML doc separator left in the template.
- 🔵 Default `cyrius build` reports `277 unreachable fns (41200 bytes)` from the
  fully-vendored stdlib and only eliminates them when `CYRIUS_DCE=1` is set.
  Dead-code elimination being opt-out-by-default inflates dev binaries; worth
  considering DCE-on for release builds by default.
- 🔵 `cycc` (low-level compiler) writes a stub ELF to stdout for unrecognized
  invocations instead of a usage/error message — confusing when probing flags
  directly. The `cyrius` build tool is the intended interface; `cycc` flags are
  undiscoverable (stripped binary, no `--help`).
- 🟡 With a warm dep cache, `cyrius deps` / `cyrius build` print
  `fatal: destination path '.../deps/<dep>/<tag>' already exists and is not an
  empty directory` for each cached dep, yet still succeed (`N deps resolved`).
  The `fatal:` git noise reads like a failure — should detect the cache hit and
  stay quiet, or print `cached <dep>@<tag>`.
- 🔵 `cyrius build` re-resolves deps on every invocation (re-emits the above per
  build). A lockfile-fast-path / `--offline` would speed the edit-build loop.
- 🟡 **`cyrius test` discovers no `.tcyr` files.** `cyrius init` scaffolds
  `tests/<name>.tcyr`, but `cyrius test` reports `No .tcyr files found in
  tests/tcyr/ or tests/` and exits 0 — for a file sitting in `tests/`, for a
  simply-named `tests/smoke.tcyr`, and for a copy placed in `tests/tcyr/`. So
  the out-of-box test suite never runs and reports green (false pass). The
  `[build].test` entry (`src/test.cyr`) isn't run by `cyrius test` either; it
  works via `cyrius run src/test.cyr`. Scaffold layout and runner discovery are
  out of sync, and "no tests" should not be a silent exit 0.
- 🟡 **`cyrius fmt --check` disagrees with `cyrius fmt`.** `--check` exited 1 on
  `src/main.cyr` while apply-mode `cyrius fmt` produced a byte-identical file
  (empty diff). The trigger was a single function call split across two lines
  (`json_v_obj_set(o, …,\n   json_v_str_new(…))`); `--check` flags it but
  apply-mode won't fix it, and `--check` prints nothing (no file/line/what), so
  you're left guessing. Either apply-mode should reformat what `--check` flags,
  or `--check` shouldn't flag continuations it can't fix — and it should name
  the offending location.

## HTTP / networking

- 🔵 `net.cyr` TCP stack (`tcp_socket`/`sock_reuse`/`sock_bind`/`sock_listen`/
  `sock_accept`/`sock_recv`/`sock_send`/`sock_close`) is clean and complete
  enough to stand up an HTTP/1.1 responder in ~30 lines. `Result` ergonomics
  (`is_ok`/`result_unwrap`) work fine. **No HTTP server abstraction** in stdlib
  though — there is `http.cyr` (client: `http_get`) but no `http_serve`/router.
  Everything above the socket (request parsing, response framing, headers,
  Content-Length) is hand-rolled. For the SY port this is the single biggest
  gap: SY leans on axum. A small `httpd.cyr` server helper would carry a lot.
  **Update (6.1.15):** addressed *in-probe* by extracting `src/httpd.cyr` —
  request parse (method/path/query/headers/body), a function-pointer route
  table with method-aware dispatch (404/405), `resp_*` framing helpers, and an
  `httpd_serve(port, router)` loop. The function-pointer router works cleanly
  (`&handler` + `fncall2`). This is a candidate to upstream into the stdlib as
  an `httpd.cyr`/`http_serve`. Still missing upstream: a stdlib server, a
  concurrency story (below), and per-request arena/free (the bump allocator
  never reclaims per-request `str_builder`/`Req` allocations, so a long-lived
  server grows unboundedly — fine for the probe, not for production).
- 🟡 The accept loop is single-threaded and blocking — one slow client stalls
  all others. `sock_set_recv_timeout` exists (slowloris guard) but real
  concurrency needs `thread.cyr` or an epoll loop, neither wired into a server
  helper. Acceptable for a probe; a real port needs a concurrency story.
  **Update (2026-06-09):** addressed in `httpd.cyr` with a **fixed worker-thread
  pool fed by a bounded channel** (`thread.cyr` `thread_create` + `chan_*`):
  `HTTPD_WORKERS` workers pull accepted connections off the channel, so a slow
  client ties up only its own worker. Verified: `/api/health` returns in ~10ms
  while 2 silent connections hold workers; 250 concurrent POSTs complete with
  0 errors and contiguous unique ids. Two enabling notes:
    - `thread.cyr` is solid (`thread_create`/`mutex_*`/`chan_*`/`atomic_*`) and
      `alloc()` is **thread-safe** (process-wide CAS spinlock, v6.0.64), so
      concurrent JSON/string building across workers is safe out of the box.
      Thread stacks are 64 KB and reclaimed only on `thread_join` — hence a
      fixed pool (not thread-per-connection, which would leak a stack per conn).
    - **patra is not thread-safe** (one shared handle + global parse/bind
      scratch), so every DB call is serialized under one app-level mutex
      (`g_db_lock`). Filed to patra's roadmap as **P1** (make a shared handle
      safe) / **P2** (concurrent readers). This is the real ceiling on DB
      parallelism here.
- 🟡 **A single `sock_recv` is not a full request read.** The original loop
  (and the first worker cut) read once and assumed the whole request arrived —
  fine for curl (coalesces headers+body into one segment), but POST bodies from
  clients that write headers and body separately (e.g. Python `urllib`) landed
  in a later segment and were dropped → spurious `400`. Concurrency surfaced it
  (1/10 POSTs succeeded). Fixed with `httpd_recv_full`: read until `\r\n\r\n`,
  then until `Content-Length` body bytes arrive. A stdlib `http_serve` should do
  this framing (incl. growable buffers — the probe caps requests at 8 KB).
- 🔵 No unary `!` operator — `if (!is_ok(x))` does not parse; use
  `if (is_ok(x) == 0)`. Minor, but a common porting papercut from Rust/TS.
- 🔵 `json.cyr` typed builder (`json_v_obj_new`/`json_v_obj_set`/
  `json_v_str_new`/`json_v_build`) produces clean, correct output and is
  pleasant to use. **Gotcha**: object keys *and* string values must be `Str`,
  not cstring literals — passing a literal compiles but serializes garbage. A
  one-line `str_lit(c) = str_new(c, strlen(c))` wrapper bridges it. Worth either
  a cstring-accepting overload (`json_v_obj_set_c`) or a stdlib `str_lit`.

## patra (SQL persistence)

patra **works** — open, CREATE TABLE, INSERT, SELECT, ORDER BY, aggregates, and
crash-safe persistence across restarts all verified. The `.patra` file survived
a full process restart and `MAX(id)` re-seeding kept ids monotonic. The gaps
below are the consumer feedback patra is waiting on; ordered by impact for the
SecureYeoman port.

- 🔴 **No SQL string escaping.** The tokenizer (`sql_tokenize`,
  `lib/patra.cyr:1089`) opens on `'` and closes at the *first* following `'` —
  no `''` doubling, no backslash escapes. Any user string containing a single
  quote either truncates the literal (→ `PATRA_ERR_SYNTAX`) or, with crafted
  input, **injects SQL**. There is no safe way to store arbitrary text through
  `patra_exec` today. We worked around it by base64-encoding the note body
  before INSERT and decoding on read (base64's alphabet has no quotes). The SY
  port stores lots of free text — this is the #1 thing to fix.
- 🔴 **No bind parameters / placeholders.** `patra_prepare` caches the tokenized
  parse for speed but bakes the literal values in at prepare time; there are no
  `?` placeholders and no `patra_bind_*` functions. So prepared statements do
  not solve the escaping problem either. A `patra_bind_text/int/blob` API would
  fix both #1 and #2 at once and is the standard answer (sqlite3_bind_*).
- 🟡 **INSERT has no column list.** `INSERT INTO t (a, b) VALUES (...)` is a
  syntax error (`_parse_insert` requires `VALUES` immediately after the table
  name). Values must be positional in CREATE TABLE order. Brittle as schemas
  evolve and a porting footgun (axum/SQLx code names columns).
- 🟡 **STR columns are fixed 256 bytes** (`COL_STR_SZ`, incl. NUL) and truncate
  silently past that. base64 inflation (4/3) drops the effective text cap to
  ~189 bytes. There's a `COL_BYTES`/blob-page type for larger payloads but no
  SQL syntax surfaced to write it via `patra_exec` — needs either a TEXT/VARLEN
  column or a documented blob-insert API.
- 🔵 **No AUTOINCREMENT / rowid.** Consumers must allocate ids themselves; we
  seed `g_next_id` from `SELECT id ... ORDER BY id` at boot. An auto rowid or
  `SELECT MAX(id)` convenience would remove boilerplate.
- 🔵 **Undocumented transitive dep on sakshi.** `dist/patra.cyr` calls
  `sakshi_error` / `sakshi_set_level` but doesn't vendor sakshi, so a consumer
  that adds only `[deps.patra]` fails to link until they *also* add
  `[deps.sakshi]`. Either inline sakshi into the dist bundle or document the
  requirement in patra's README/cyrius.cyml.

## TS/TSX frontend build

The headline question — *"can a TS/TSX frontend be built just by cyrius?"*

**Parser: yes, and it's impressively complete.** `cycc --parse-ts` accepted
every real-world fixture thrown at it, including a React component using
`useState<Note[]>`, `useEffect`, JSX with `.map`/`key`/`data-*`, `<K extends
string, V>` generics, default type params (`Result<T, E = Error>`), `?.`/`??`,
async/await, enums, `readonly`/optional members, destructuring, spread, `as`
casts, tuples, `Record<K,V>`, and `// line comments`. This validates the claim
that the TS/TSX front-end (built off SecureYeoman's own TS handling) was
"extended to the full" parser. For the SY port, the dashboard's TSX should
parse-clean as-is.

**Emit: no — this is THE gap.** There is no TS→JS emit anywhere in the
toolchain. `cyrius build web/app.tsx …` does not route through the TS parser at
all — it tries to compile the `.tsx` as *Cyrius source* and dies on the first
`//` (Cyrius comments are `#`). So "built just by cyrius" today means
**parse-validated** by cyrius, not **transpiled** by cyrius. We author the
canonical typed source in `web/app.tsx` (cyrius validates it as a build gate)
and hand-lower the served bundle to `web/app.js`. The missing piece for the
vision is a `cycc --emit-js` / `cyrius build --target=js` codegen stage that
turns the already-parsed AST into browser JS (strip types, lower JSX). The hard
part — a correct full-fidelity parser — already exists.

- 🔴 **No TS→JS / JSX emit.** (above) The one capability that stands between
  "cyrius validates my frontend" and "cyrius builds my frontend."
- 🟡 **`cycc --parse-ts <file>` blocks on stdin even when given a file arg.**
  Cost me the most time here: in a no-tty / backgrounded / scripted context it
  hangs forever (one orphaned invocation sat for 17 min holding things up).
  Always invoke with `</dev/null`. Fix: don't read stdin when a path argument
  is present. This will bite anyone scripting the parser (CI, build tools).
- 🟡 **`cyrius build` exits 0 on compile failure.** `cyrius build web/app.tsx`
  printed `error: … unexpected '/'` and `FAIL` but returned exit code 0. Build
  scripts/CI can't detect failures by exit status — they'd have to scrape
  stderr. Compile errors must yield a non-zero exit.
- 🟡 **`ts_test_runner` looks for the compiler at `~/.cyrius/bin/cyc`** (note:
  `cyc`, not `cycc`) and prints `error: cycc not found at …/cyc` — then *still
  exits 0*. So the official TS harness is currently unusable out of the box and
  silently "passes". Two bugs: wrong binary name + zero exit on error.
- 🔵 Static file serving from the Cyrius side (`io.cyr file_read_all` +
  `fs.cyr`) is fine — served `index.html`/`app.js` came back byte-identical to
  source. No `Content-Type`-by-extension helper though; you set MIME manually.
