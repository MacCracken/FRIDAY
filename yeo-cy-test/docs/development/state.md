# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.4.62 /
patra 1.12.10 / libro 2.8.1 / sandhi 1.8.2 (thin `server` profile bundle) / sigil
3.9.9 (via cyrius) / sakshi 2.4.6** (2026-07-13; regenerate `lib/` with `cyrius lib sync
--full` + `cyrius deps` — see Toolchain note). Serves **HTTP (:8080) and HTTPS
(:8443, TLS 1.3 + Ed25519)** off one sandhi router + handler set over the patra
backend, both at **`max_conns=4`**. Both original 🔴 blockers (TS/TSX→JS emit,
patra string safety) stay closed.

**Zero residual workarounds — the probe now runs lock-free:**

- ✅ **`g_db_lock` REMOVED (patra 1.12.9).** Its last remaining job was holding each
  SELECT + its TEXT readback atomic against a concurrent writer: `patra_query` used
  to release its shared flock before `patra_result_read_text` lazily read the payload
  pages, so a writer on another handle could free/overwrite them mid-read (torn body
  returned as `PATRA_OK`). patra **1.12.8**'s `_rs_materialize` snapshots every
  TEXT/BYTES payload into an owned heap buffer *while the query's shared flock is
  held*, so `read_text`/`read_bytes` are pure memcpys — safe against any later
  writer. Folded into patra **1.12.9** and adopted here: handlers call `db()` (this
  worker's own handle) directly, no mutex. patra's connection-per-thread "lock-free
  parallel reads" promise is finally delivered for **TEXT** columns too (was
  fixed-width only). New scenario 11 proves it: 310 reads during concurrent writes,
  **0 torn/garbled**.
- ✅ **Adopted sandhi's thin `server` profile bundle (sandhi 1.8.0 → 1.8.2).** sandhi
  is no longer the folded-stdlib monolith; it's pulled as `dist/sandhi-server.cyr`
  (**141 KB vs the full 590 KB folded bundle, ~76 % smaller**) via `[deps.sandhi]` —
  the **"bundled-libs → individual-packages split" this probe filed**, now shipped
  and **dogfooded here as sandhi's first profile-bundle consumer**. sandhi 1.8.1 made
  `run_pooled_tls` safe at `max_conns>1`; the TLS pool stays at 4.
- (Prior cycles resolved: the enum-shadow `DB_PATH` collision → `g_dbpath` rename
  (cyrius 6.3.24); the sigil⇄patra slot-0 collision → TLS `max_conns` 1→4 (sigil
  3.9.9 / cyrius 6.3.25); `str_builder`/array-local codegen (6.3.15); patra
  table-cache (1.12.7); both sandhi findings; sigil's concurrent-handshake crash.)

No new findings this cycle — every previously-filed ecosystem finding is now shipped
and adopted. See [`../../FINDINGS.md`](../../FINDINGS.md) and each repo's
`docs/development/issues/`.

**First `sy-core` module grown into the probe: `audit` → libro (PERSISTENT).** The
probe is now evolving from a pure viability slice toward the real SecureYeoman →
Cyrius port. The first module ported is `sy-core`'s **audit** (an append-only,
hash-linked crypto audit log) onto **libro** (v2.8.1) — a near-exact lib match. Every
note mutation (create/update/delete) appends a SHA-256 hash-linked entry to a
**patra-backed store** (libro `patrastore`, file `yeo-audit.patra`, separate from the
notes DB); `GET /api/audit` returns `{entries, verified, head, persistent}` and
re-verifies the **on-disk** chain each call. Appends serialize under `g_audit_lock`
— a hash chain is inherently serial, so one writer at a time is correct, not a
workaround. **Durable:** the log survives a restart — `audit_init` reconstructs the
head hash from the on-disk entries so appends after a restart link onto the existing
chain and the whole chain still verifies (scenario 12c). **Connection-per-thread**
(TLS slot 14, like the notes `db()`): patra handles must be used on the thread that
opened them, so each worker opens its own audit handle. Verified under full
concurrency (250 + 60 concurrent appends → chain verifies) and across a restart.
Now safe to store **arbitrary content** (quotes/injection/unicode) — the underlying
libro `patrastore_append` uses a bound INSERT (libro 2.8.1) and patra escapes `''`
(1.12.10); see the quote-corruption fix note below and FINDINGS.

**Second module: `hwprobe` → ai-hwaccel.** sy-core's `hwprobe` is "a thin wrapper
around `ai_hwaccel`" (hardware-accelerator detection); its Cyrius target,
**ai-hwaccel** (v2.3.14), is *already* Cyrius, so the port is thin. `src/hwprobe.cyr`
runs `registry_detect_no_exec()` **once at startup** (detection via /sys + /proc, no
subprocess spawning — no per-request fork/exec, no command-injection surface) and
caches the summary JSON; **`GET /api/hwinfo`** serves it. On this host it reports
`{device_count, has_accelerator, total_memory_bytes, accelerator_memory_bytes,
gpu_count, tpu_count, npu_count, warnings}` — e.g. 2 devices / 1 GPU / ~64 GB. The
cached string is immutable, so all workers serve it lock-free.

**Third module: `crypto` → sigil (first server-side sigil use beyond TLS).** sy-core's
`crypto` is the primitive layer (AES-GCM/X25519/Ed25519/SHA-2/HMAC/HKDF) audit/auth/tee
lean on; its Cyrius target is **sigil** (already linked here for TLS). `src/crypto.cyr`
generates a server **Ed25519 identity keypair** at startup (`ed25519_generate_keypair`,
read-only after → signing is thread-safe), exposes it at **`GET /api/pubkey`**
(`{alg, pubkey}`), and **signs the audit chain head** (`head_sig` on `GET /api/audit`)
so a client can verify the log is authentically from this server — authenticity on top
of libro's tamper-evidence. **Independently cross-checked:** Python's `cryptography`
(OpenSSL Ed25519) verifies `head_sig` against `/api/pubkey` (scenario 14) — sigil's
server signature interoperates with a standard impl. Unit invariant adds a SHA-256
known-answer (RFC 6234) for impl-independent correctness. Limitation: the identity key
is **ephemeral** (regenerated per process start) — a persistent sealed key (à la
sy-core's tee) is a future bite.

5 unit invariants + **40 backend scenarios** + 10 UI pass — **green + stable** at
`max_conns=4`. `tests/concurrency_repro.sh` is a 0/300 regression guard.

## Toolchain

- **Cyrius pin**: `6.4.62` (in `cyrius.cyml [package].cyrius`); bundles sigil 3.9.9.
  patra `1.12.9`, **sandhi `1.8.2`** (the thin `dist/sandhi-server.cyr` **profile
  bundle**, no longer the folded stdlib), and sakshi `2.4.6` pinned via `[deps.*]`.
  Because the thin bundle carries only session_cache + conn + server/mod, the deps it
  used to pull transitively are now **declared explicitly** in `[deps].stdlib`:
  **`bayan`** (the probe's `json_v_*` build/parse — NOT `json`, which collides with
  bayan on `json_v_*`/`_jv_*`/`_jp_*`) and **`hashmap`** (`map_*`, used by sandhi's
  TLS session cache). `tls` still pulls sigil transitively (→ `pem_decode_certs`,
  crypto), independent of sandhi. (Keep the pin matched to the installed cycc to
  silence the toolchain-drift warning; cycc auto-drifts same-day.)
- `lib/` is untracked + gitignored; regenerate with **`cyrius lib sync --full`** +
  `cyrius deps`. **Use `--full`, not bare `cyrius lib sync`** — the bare form only
  refreshes the *declared* `[deps].stdlib` subset, so transitively-pulled deps like
  **sigil** (via `tls`/sandhi) are NOT updated and can silently stay stale. This
  bit the probe: a bare sync left `lib/sigil.cyr` at 3.9.4 (the pre-fix opt-in
  banking) while cyrius 6.3.12 actually bundles sigil 3.9.7 — so the probe built
  against the old crypto race and the TLS pool appeared to still crash. `--full`
  pulls the whole snapshot (current sigil 3.9.9). See FINDINGS.

## Source

- `src/httpd.cyr` — **thin response helpers + body accessors over sandhi**
  (~95 lines; the hand-rolled Conn seam / TLS accept loop / route table are
  retired now that sandhi ships server-side TLS). `resp_*(conn, …)` build a JSON/
  file response and delegate framing + transport to `sandhi_server_send_response_c`
  (sandhi's Conn seam handles plaintext `sock_send` vs chunked `tls_write`); the
  CORS header rides `extra_headers`. `_status_code`/`_status_msg` split the probe's
  "CODE Msg" status cstr for sandhi's separate code+msg params. `http_body_*`
  accessors read the body via `sandhi_server_body_offset`.
- `src/main.cyr` — handlers + route registration + patra persistence + dual serve.
  `include "src/httpd.cyr"`. Handlers take a **SandhiConn** (`fn(app_ctx, conn,
  req_buf, req_len, params)`): write via `resp_*(conn,…)`, body via `http_body_*`,
  path params via `sandhi_route_param_int`. Routes on **sandhi's router**
  (`sandhi_router_new`/`sandhi_router_add`). `main` loads the cert (DER leaf via
  `pem_decode_certs`) + key (PEM) into `sandhi_server_options_tls`, starts
  **plaintext `run_pooled` (4 workers, :8080) in a worker thread** via
  `sandhi_server_router_handler_cp` and the **HTTPS `run_pooled_tls` (:8443) in
  main** via `sandhi_server_router_handler_c`, sharing the read-only router.
  **The TLS pool runs 4 workers** (`max_conns=4`, matching plaintext) — the
  sigil⇄patra thread-local slot-0 collision that caused `RECORD_LAYER_FAILURE` was
  fixed in sigil 3.9.9 (slot 0→8, cyrius 6.3.25); verify.py is 5/5 clean at 4 and an
  amplified stress is 0-error at 4 and 8 (see FINDINGS).
  Endpoints: `GET /`, `GET /app.js`, `GET /api/health`, `GET /api/audit`,
  `GET /api/hwinfo`, `GET /api/pubkey`, `GET|POST /api/notes`, `GET|PUT|DELETE /api/notes/:id`. Persistence: `TEXT` bodies via bound `?` params
  (injection-safe). Ids are patra `AUTOINCREMENT` (column-list `INSERT`, echoed via
  `last_insert_id`); `PUT`/`DELETE` 404 via `rows_affected`. Caveat (FINDINGS):
  AUTOINCREMENT reuses ids.
  - **Persistence model: connection-per-thread, lock-free.** `db()` opens one patra
    handle per worker, cached in a thread-local slot (TLS slot 15), so each worker
    reads/writes on a per-thread fd — patra's parallel-read model. The DB path is a
    plain global `var g_dbpath = "yeo.patra"` (renamed from the enum-colliding
    `DB_PATH` — see FINDINGS). **No `g_db_lock`.** patra 1.12.7 moved the table-lookup
    cache into the handle, and patra **1.12.9** (via 1.12.8's `_rs_materialize`)
    snapshots TEXT/BLOB payloads into owned heap under the query's shared flock, so
    `patra_result_read_text` is a pure memcpy — the last reason to hold a lock is
    gone. Writers serialize via patra's per-fd exclusive flock; reads run fully in
    parallel; `last_insert_id`/`rows_affected` are per-handle.
- `src/audit.cyr` — **the `sy-core` `audit` module, ported onto libro's persistent
  patrastore.** A SHA-256 hash-linked audit chain persisted to `yeo-audit.patra`
  (separate from the notes DB) via `patrastore_open`/`patrastore_append`/
  `patrastore_load_all` + `entry_new(…, prev_hash)` + `verify_chain`. `audit_init()`
  (main-thread) `ed25519_init`s, ensures the store, and reconstructs the head hash
  from the on-disk entries (restart continuity); `audit_store()` opens a **per-thread**
  handle (TLS slot 14 — patra is connection-per-thread, like `db()`); `audit_log(source,
  action, details)` links + persists one SEV_INFO entry under `g_audit_lock` (serial by
  nature) and advances the shared head; `audit_json()` re-verifies the on-disk chain
  and returns `{entries, verified, head, persistent}`. Wired into `handle_create/update/
  delete_note`, so every note mutation is durably recorded — surviving a restart
  (scenario 12c) and safe for arbitrary content (libro 2.8.1 bound INSERT / patra
  1.12.10 `''`).
- `src/crypto.cyr` — **the `sy-core` `crypto` module, ported onto sigil** (first
  server-side sigil use beyond TLS). `crypto_init()` (main-thread) generates a server
  Ed25519 keypair (`ed25519_generate_keypair`, read-only after → sign is thread-safe);
  `crypto_pubkey_hex()`/`crypto_sign_hex()` wrap sigil's `hex_encode` (which returns a
  cstr) in `str_from`; `crypto_verify()` → `ed25519_verify` (1=ok). `handle_pubkey`
  serves `GET /api/pubkey` `{alg, pubkey}`; `audit_json` adds `head_sig` (Ed25519 over
  the head, under `g_audit_lock`). Keys ephemeral per process (persistent sealed key
  = future).
- `src/hwprobe.cyr` — **the `sy-core` `hwprobe` module, ported onto ai-hwaccel.**
  `hwprobe_init()` (main-thread) calls `hwlog_init()` then
  `registry_detect_no_exec()` (no subprocess spawning) once, caching
  `registry_to_summary_json(r)` in `g_hwinfo` (an immutable `str`, served lock-free).
  `handle_hwinfo` serves it raw at `GET /api/hwinfo` via `resp_raw`.
- `web/app.tsx` — typed frontend, single source of truth: a SecureYeoman notes
  dashboard with a hash router exercising the **full** `/api/notes` resource —
  `#/` Home (live status + count), `#/notes` (list + add + per-row delete),
  `#/notes/:id` (detail: GET by id, edit→PUT, delete→DELETE). JSX lowers to the
  emitter's `h()` runtime (text children → text nodes → XSS-safe).
- `web/app.js` — **generated** from `web/app.tsx` by `cyrius build --target=js`
  (do not hand-edit); `web/index.html` is a minimal mount + dashboard CSS.
- `build.sh` — emits `web/app.js` from the TSX (`--target=js` + `node --check`),
  then builds the backend.

## Tests

- `src/test.cyr` — five invariants: (1) **patra bound-text** — a
  quote/injection/unicode body bound via `patra_bind_text` round-trips
  byte-for-byte through a `TEXT` column and leaves the table intact; (2)
  **sandhi `route_match`** — `:name` path-param capture, segment-count rules,
  and `sandhi_route_param_int` numeric parsing (a consumer-side regression guard
  on sandhi's matcher, which the `/api/notes/:id` resource depends on); (3)
  **libro audit chain** — `chain_append` builds a chain that `chain_verify`s and
  whose `chain_head_hash` advances per entry (the hash-linking the `audit` module
  relies on); (4) **ai-hwaccel hwprobe** — `registry_detect_no_exec()` →
  `registry_to_summary_json` yields a non-empty JSON summary (the detect→serialize
  path `/api/hwinfo` relies on; hardware-agnostic); (5) **sigil crypto** — a server
  Ed25519 sign→verify round-trip (tamper rejected) + a SHA-256 known-answer (RFC
  6234, impl-independent), the `crypto` module's primitives. Passes via `cyrius run
  src/test.cyr` (idempotent).
  (`cyrius test` still does not discover the scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/verify.py` — **40-scenario** end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart persistence, 250-concurrent unique ids,
  slow-client isolation, request-smuggling rejects, SIGPIPE survival,
  rows_affected concurrency, **HTTPS: CRUD over TLS 1.3, real cert verification,
  HTTP↔HTTPS shared backend, ALPN negotiates `http/1.1` (9i), 60-concurrent-HTTPS
  served without crashing (10), read-during-write: 310 reads under concurrent
  writes → 0 torn/garbled (11) proving lock-free TEXT readback, the audit
  chain (12a/b): `/api/audit` stays `verified` + `persistent` after all mutations
  incl. the concurrent ones + a controlled create+update+delete adds exactly 3
  linked entries, audit durability (12c): the on-disk chain survives a full server
  restart with entries + head intact and still verified, hwprobe (13):
  `/api/hwinfo` returns a valid ai-hwaccel summary, and crypto (14): `/api/pubkey`
  Ed25519 + the audit `head_sig` verifies INDEPENDENTLY via OpenSSL Ed25519
  (Python cryptography)**). **All scenarios are stable** (the cyrius 6.3.15
  str_builder fix removed the concurrency flakiness). Run against a
  built `build/yeo-cy-test` (needs `cert.pem`/`key.pem` — `./gen-certs.sh`, or
  `build.sh` auto-mints).
- `tests/ui_check.mjs` — **headless full-stack proof**: loads the real
  cyrius-emitted `web/app.js` into a DOM+fetch shim against a running server and
  drives the rendered UI (list → add → detail → edit → delete), cross-checking
  the DOM vs the patra backend (10 scenarios incl. XSS-safe text-node rendering).
- `tests/run.sh` — one command: build + unit + 40 backend e2e + 10 UI e2e.
- `tests/concurrency_repro.sh` — standalone diagnostic for the upstream cyrius
  `str_builder` race: curl-hammers static `/api/health` and reports the ~3%
  corrupt-response rate. Exits 0 (documents a filed upstream bug, not a gate).
- `gen-certs.sh` — mints the self-signed Ed25519 cert+key for HTTPS (gitignored).
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, freelist, chrono, thread, atomic, tls, async, random, fdlopen,
  dynlib, **hashmap**, **bayan**. `bayan` is the probe's JSON build/parse
  (`json_v_*`); `json` is dropped — it collides with bayan on `json_v_*`/`_jv_*`/
  `_jp_*`. `hashmap` (`map_*`) is used by sandhi's TLS session cache.
  `tls`/`async`/`random`/`fdlopen`/`dynlib` were sandhi's transitive modules when it
  was folded; with the thin `server` profile bundle they (and `bayan`/`hashmap`) are
  now declared explicitly. `thread`/`atomic` back sandhi's `run_pooled` /
  `run_pooled_tls`. `tls` pulls **sigil** transitively — now used **directly
  server-side** by `src/crypto.cyr` (Ed25519 keygen/sign/verify, SHA-256), not just
  for TLS. **`fs`, `process`, `ct`,
  `keccak`, `thread_local`, `slice`** were added for **libro** (its `dist/libro.deps`
  sidecar lists them); **`args`** (argc/argv) for **ai-hwaccel** (its CLI helpers
  reference them; unused on the probe's no-exec detection path).
- **sandhi** `1.8.2` — the HTTP services lib, pulled as the thin `server` **profile
  bundle** (`[deps.sandhi]`, `modules = ["dist/sandhi-server.cyr"]`; 141 KB vs the
  590 KB full folded bundle). Server-side TLS + Conn-aware router + `run_pooled`/
  `run_pooled_tls`.
- **libro** `2.8.1` — cryptographic audit chain (SHA-256 hash-linked, tamper-
  evident) + patra-backed `patrastore`; the Cyrius target for `sy-core`'s `audit`
  module (`[deps.libro]`). GPL-3.0-only (compatible with this project's AGPL-3.0-only).
  2.8.1 fixed the raw-SQL quote-drop in `patrastore_append` (bound INSERT) — the P1
  this probe filed.
- **ai-hwaccel** `2.3.14` — hardware-accelerator detection (GPU/TPU/NPU/AI-ASIC);
  the Cyrius target for `sy-core`'s `hwprobe` module (`[deps.ai-hwaccel]`). Already
  a Cyrius lib. Detection is read-only (`registry_detect_no_exec`, no subprocess).
- **patra** `1.12.10` — SQL persistence (`[deps.patra]`). 1.12.10 added standard
  `''` escaping + `patra_quote_str` (the P1 quote fix this probe drove).
- **sakshi** `2.4.6` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The probe is now **growing toward the real SecureYeoman → Cyrius port** (see
[`roadmap.md`](roadmap.md)). **Three `sy-core` modules are in and complete:**
**`audit` → libro** (durable via patrastore, Ed25519-signed head), **`hwprobe` →
ai-hwaccel**, and **`crypto` → sigil** (server-side Ed25519 + SHA-256, OpenSSL-interop
verified). Next bite candidates: **`sandbox` → kavach** (v3.7.1), **`auth`** (JWT/PKCE
via bote + sigil), or a persistent sealed identity key for `crypto` (à la sy-core's
tee). The viability findings remain a first-class output — see
[`../../FINDINGS.md`](../../FINDINGS.md).
