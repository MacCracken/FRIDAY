# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.3.42 /
patra 1.12.7 / sandhi 1.7.0 / sigil 3.9.9 (folded) / sakshi 2.4.3** (2026-07-03;
regenerate `lib/` with `cyrius lib sync --full`, not bare — see Toolchain note).
Serves **HTTP (:8080) and HTTPS (:8443, TLS 1.3 + Ed25519)** off one sandhi router
+ handler set over the patra backend. Both original 🔴 blockers (TS/TSX→JS emit,
patra string safety) stay closed.

**Both residuals shipped — and both were consumer MISDIAGNOSES (the value of
filing).** The probe went from two workarounds to zero:

- ✅ **"string-literal global at scale" was a SYMBOL COLLISION** (fixed cyrius
  6.3.24). The old `var DB_PATH = "yeo.patra"` collided by name with patra's
  `enum DbOff { DB_PATH = 16 }`; cyrius took the last registration, so
  `patra_open`'s `store64(db + DB_PATH, …)` used a string pointer as an ABI offset
  → wild store → SIGSEGV. cyrius now makes a non-int-literal var shadowing an enum
  a **hard error**. Fix adopted: the `db_path()` fn is gone; the path is a plain
  global renamed to dodge the collision — `var g_dbpath = "yeo.patra"`.
- ✅ **"multi-worker-TLS `RECORD_LAYER_FAILURE`" was a THREAD-LOCAL SLOT COLLISION**
  (fixed cyrius 6.3.25 / sigil 3.9.9). sigil's crypto-bank lane and patra's parse
  scratch both hardcoded thread-local slot 0; a patra query clobbered sigil's bank
  index → wrong crypto lane → corrupted handshake. Deterministic (every 4th
  handshake), not the "mixed pattern" filed. Fixed by moving sigil to slot 8 + a
  slot-namespace registry. Fix adopted: **TLS pool `max_conns` 1 → 4** (verify.py
  5/5 clean; amplified stress 0 errors at 4 and 8). Plaintext also 4.
- (Prior bumps resolved: str_builder array-local codegen (6.3.15), patra
  table-cache (1.12.7), both sandhi findings, sigil concurrent-handshake crash.)

**One lock stays — correctly attributed now:** 🔴 **patra TEXT/BLOB readback
escapes the query's flock window.** `patra_query` releases its shared flock before
returning; `patra_result_read_text` reads the payload pages **unlocked** later, so
a concurrent writer can tear the body. `g_db_lock` is **kept** to hold each SELECT
+ its readback atomic — **correcting** the earlier note that claimed the lock was
removed (it was removed for the table-cache race, but is required for *this* one).
Filed to patra. 🔵 The `sync.cyr`/`thread.cyr` `mutex_*` duplicate-definition
warning is now filed to cyrius (benign). See [`../../FINDINGS.md`](../../FINDINGS.md)
and each repo's `docs/development/issues/`.

2 unit invariants + **34 backend scenarios** + 10 UI pass — **green + stable** at
`max_conns=4` (verify.py 5/5). `tests/concurrency_repro.sh` is a 0/300 regression
guard.

## Toolchain

- **Cyrius pin**: `6.3.42` (in `cyrius.cyml [package].cyrius`); folds sandhi
  1.7.0 + sigil 3.9.9. patra `1.12.7` / sakshi `2.4.3` pinned via `[deps.*]`.
  (cycc auto-drifts same-day; keep the pin matched to the installed cycc to silence
  the toolchain-drift warning — 6.3.42 is a probe-irrelevant protobuf-only bump.)
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
  Endpoints: `GET /`, `GET /app.js`, `GET /api/health`, `GET|POST /api/notes`,
  `GET|PUT|DELETE /api/notes/:id`. Persistence: `TEXT` bodies via bound `?` params
  (injection-safe). Ids are patra `AUTOINCREMENT` (column-list `INSERT`, echoed via
  `last_insert_id`); `PUT`/`DELETE` 404 via `rows_affected`. Caveat (FINDINGS):
  AUTOINCREMENT reuses ids.
  - **Persistence model: connection-per-thread + `g_db_lock`.** `db()` opens one
    patra handle per worker, cached in a thread-local slot (TLS slot 15), so each
    worker reads/writes on a per-thread fd — patra's parallel-read model. The DB
    path is a plain global `var g_dbpath = "yeo.patra"` (renamed from the
    enum-colliding `DB_PATH` — see FINDINGS). patra 1.12.7 moved its table-lookup
    cache into the handle, closing that race — but **`g_db_lock` STILL wraps every
    patra op**, because patra's TEXT readback (`patra_result_read_text`) reads pages
    *after* `patra_query` drops its shared flock, so SELECT + `note_row_json`
    readback must stay atomic vs a concurrent writer (filed to patra). Writers also
    serialize via patra's per-fd flock; `last_insert_id`/`rows_affected` are
    per-handle.
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

- `src/test.cyr` — two invariants: (1) **patra bound-text** — a
  quote/injection/unicode body bound via `patra_bind_text` round-trips
  byte-for-byte through a `TEXT` column and leaves the table intact; (2)
  **sandhi `route_match`** — `:name` path-param capture, segment-count rules,
  and `sandhi_route_param_int` numeric parsing (a consumer-side regression guard
  on sandhi's matcher, which the `/api/notes/:id` resource depends on). Passes
  via `cyrius run src/test.cyr` (idempotent).
  (`cyrius test` still does not discover the scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/verify.py` — **34-scenario** end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart persistence, 250-concurrent unique ids,
  slow-client isolation, request-smuggling rejects, SIGPIPE survival,
  rows_affected concurrency, **HTTPS: CRUD over TLS 1.3, real cert verification,
  HTTP↔HTTPS shared backend, ALPN negotiates `http/1.1` (9i), 60-concurrent-HTTPS
  served without crashing (10)**). **All scenarios are now stable** (the cyrius 6.3.15
  str_builder fix removed the concurrency flakiness). Run against a
  built `build/yeo-cy-test` (needs `cert.pem`/`key.pem` — `./gen-certs.sh`, or
  `build.sh` auto-mints).
- `tests/ui_check.mjs` — **headless full-stack proof**: loads the real
  cyrius-emitted `web/app.js` into a DOM+fetch shim against a running server and
  drives the rendered UI (list → add → detail → edit → delete), cross-checking
  the DOM vs the patra backend (10 scenarios incl. XSS-safe text-node rendering).
- `tests/run.sh` — one command: build + unit + 34 backend e2e + 10 UI e2e.
- `tests/concurrency_repro.sh` — standalone diagnostic for the upstream cyrius
  `str_builder` race: curl-hammers static `/api/health` and reports the ~3%
  corrupt-response rate. Exits 0 (documents a filed upstream bug, not a gate).
- `gen-certs.sh` — mints the self-signed Ed25519 cert+key for HTTPS (gitignored).
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, freelist, chrono, thread, atomic, tls, async, random, fdlopen,
  dynlib, **sandhi** (the HTTP services lib; `json` dropped — sandhi bundles its
  successor `bayan`. `tls`/`async`/`random`/`fdlopen`/`dynlib` are sandhi's
  transitive modules, added by hand since `+sandhi` doesn't auto-pull them.
  `thread`/`atomic` are now needed by sandhi's `run_pooled` / `run_pooled_tls`
  rather than the probe's own pool.)
- **patra** `1.12.7` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.4.3` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
