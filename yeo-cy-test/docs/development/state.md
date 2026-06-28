# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.3.0 /
patra 1.12.6 / sandhi 1.6.13 (folded) / sakshi 2.4.0** (2026-06-28). The two
headline TLS findings from the prior bite **both shipped upstream and are now
adopted**: **sandhi server-side TLS** (`sandhi_server_run_pooled_tls` + the
Conn-aware router family, sandhi 1.6.10) and **`tls_native` server-side ALPN**
(cyrius 6.2.22, now negotiating `http/1.1`). So the probe **retired its entire
hand-rolled HTTPS stack** (Conn seam / `tls_serve` accept loop / ALPN wire /
SIGPIPE guard / route table) — it now serves **both HTTP (:8080) and HTTPS
(:8443, TLS 1.3 + Ed25519)** off one sandhi router + handler set, sharing the
patra backend. Both original 🔴 blockers (TS/TSX→JS emit, patra string safety)
stay closed.

**Headline open finding (🔴, deep-dive 2026-06-28): cyrius `str_builder` is not
thread-safe** — concurrent HTTP responses corrupt ~3% under load (an 8-thread
bisect pins it to the `str_builder` library functions; a byte-identical hand-rolled
replica is clean). It underlies every concurrent string build, so it gates *any*
cyrius concurrent server, and it makes the probe's concurrency scenarios (verify.py
4/8/10) **flaky** (functional scenarios are stable). Other open 🔴: **sigil**
concurrent-TLS-handshake crash (TLS pool pinned to **1 worker**) and **patra**
1.12.0 parallel-read table-cache race (every patra op serialized under `g_db_lock`).
All filed upstream — see [`../../FINDINGS.md`](../../FINDINGS.md) and each repo's
`docs/development/issues/`.

2 unit invariants + **34 backend scenarios** + 10 UI pass when the upstream
`str_builder` race doesn't fire on a concurrency scenario; `tests/concurrency_repro.sh`
is a standalone diagnostic for that race (not a gate).

## Toolchain

- **Cyrius pin**: `6.3.0` (in `cyrius.cyml [package].cyrius`); folds sandhi
  1.6.13.
- `lib/` is untracked + gitignored; regenerate with `cyrius lib sync` +
  `cyrius deps`.

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
  **The TLS pool is pinned to 1 worker** (`max_conns=1`) — sigil's global crypto
  scratch crashes on 2+ concurrent handshakes (see FINDINGS); plaintext stays at 4.
  Endpoints: `GET /`, `GET /app.js`, `GET /api/health`, `GET|POST /api/notes`,
  `GET|PUT|DELETE /api/notes/:id`. Persistence: `TEXT` bodies via bound `?` params
  (injection-safe). Ids are patra `AUTOINCREMENT` (column-list `INSERT`, echoed via
  `last_insert_id`); `PUT`/`DELETE` 404 via `rows_affected`. Caveat (FINDINGS):
  AUTOINCREMENT reuses ids.
  - **Persistence model: connection-per-thread.** `db()` opens one patra handle per
    worker, cached in a thread-local slot (TLS slot 15), so reads/writes are on a
    per-thread fd — patra 1.12.0's parallel-read model. `db_path()` returns the DB
    path as a fn, not a `var = "literal"` global (those crash — see FINDINGS).
    Because patra's table-lookup cache is still process-global (filed patra-side),
    every patra op is serialized under **`g_db_lock`** as the workaround (drop it
    when patra fixes the cache → the per-thread handles give correct parallel reads).
    Per-handle `last_insert_id`/`rows_affected` make `g_wr_lock` unnecessary (removed).
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
  served without crashing (10 — the sigil-concurrency tripwire)**). The functional
  scenarios are stable; the concurrency ones (4/8/10) can flake on the upstream
  cyrius `str_builder` race (FINDINGS). Run against a
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
- **patra** `1.12.6` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.4.0` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
