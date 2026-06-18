# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.2.21 /
patra 1.11.4 / sandhi 1.6.7 / sakshi 2.3.1** (2026-06-18). **Every finding this
probe filed against the ecosystem is now resolved upstream** (sandhi route table
+ `run_pooled` in 1.6.7, SIGPIPE guard + docs in 1.6.6; patra
`last_insert_id`/`rows_affected` in 1.11.3; cyrius async leak in 6.1.22) and the
probe **adopted** all of them. It now serves **both HTTP (:8080) and HTTPS
(:8443, TLS 1.3 via `tls_native` + an Ed25519 cert)** over one handler set,
sharing the patra backend. 2 unit invariants + **32 end-to-end scenarios** (24
HTTP + 8 HTTPS) pass. Both original 🔴 blockers (TS/TSX→JS emit, patra string
safety) stay closed. Headline open findings: **sandhi has no server-side TLS
hook** (HTTPS is hand-rolled on `tls_native`) and **`tls_native` server-side ALPN
is unimplemented**. See [`../../FINDINGS.md`](../../FINDINGS.md).

## Toolchain

- **Cyrius pin**: `6.2.21` (in `cyrius.cyml [package].cyrius`); folds sandhi
  1.6.7.
- `lib/` is untracked + gitignored; regenerate with `cyrius lib sync` +
  `cyrius deps`.

## Source

- `src/httpd.cyr` — the **transport seam + framing + routing + HTTPS serve loop**.
  A `Conn {kind, handle}` lets one handler set serve both transports:
  `resp_*(conn, …)` frame a response (replicated from sandhi — no frame-to-buffer
  helper) and `conn_write` dispatches `sock_send` (plaintext) vs chunked
  `tls_native_write` (TLS). A tiny route table + `srv_dispatch` reuse sandhi's
  **matcher** (`sandhi_server_route_match`) but carry the Conn (sandhi's
  router_handler/run_pooled-send are plaintext-welded). `_plain_handler` adapts
  `run_pooled` (plaintext) onto the Conn dispatch. `tls_serve`/`tls_recv_request`
  hand-roll the HTTPS accept loop over `tls_native` (sandhi has no server-TLS
  hook): per-conn `tls_native_new_server`(+ALPN, currently a no-op server-side —
  see FINDINGS)→`accept`→read-loop→dispatch→`tls_write_all` (16 KiB chunks)→close.
  `http_body_*` accessors + `httpd_ignore_sigpipe` (the TLS loop needs it) stay.
- `src/main.cyr` — handlers + route registration + patra persistence + dual serve.
  `include "src/httpd.cyr"`. Handlers take a **`Conn`** (`fn(app_ctx, conn,
  req_buf, req_len, params)`): write via `resp_*(conn,…)`, body via `http_body_*`,
  path params via `sandhi_route_param_int`. Routes on the probe table
  (`router_new`/`route_add`). `main` loads the cert (DER leaf via
  `pem_decode_certs`) + key (PEM), starts **plaintext `run_pooled` in a worker
  thread (:8080)** and the **HTTPS `tls_serve` loop in main (:8443)**, sharing the
  read-only router. Endpoints: `GET /`, `GET /app.js`, `GET /api/health`,
  `GET|POST /api/notes`, `GET|PUT|DELETE /api/notes/:id`. Persistence: `TEXT`
  bodies via bound `?` params (injection-safe). Ids are patra `AUTOINCREMENT`
  (column-list `INSERT`, echoed via `last_insert_id`); `PUT`/`DELETE` 404 via
  `rows_affected`. **`g_wr_lock`** pairs each `[exec; readback]` atomically (the
  shared-handle readback race — confirmed and fixed; reads stay lock-free).
  Caveat (FINDINGS): AUTOINCREMENT reuses ids (derive-from-MAX).
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
- `tests/verify.py` — 32-scenario end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart persistence, 250-concurrent unique ids,
  slow-client isolation, request-smuggling rejects, SIGPIPE survival,
  rows_affected concurrency, **+ HTTPS: CRUD over TLS 1.3, real cert verification,
  HTTP↔HTTPS shared backend**). Run against a built `build/yeo-cy-test` (needs
  `cert.pem`/`key.pem` — `./gen-certs.sh`, or `build.sh` auto-mints).
- `tests/ui_check.mjs` — **headless full-stack proof**: loads the real
  cyrius-emitted `web/app.js` into a DOM+fetch shim against a running server and
  drives the rendered UI (list → add → detail → edit → delete), cross-checking
  the DOM vs the patra backend (10 scenarios incl. XSS-safe text-node rendering).
- `tests/run.sh` — one command: build + unit + 32 backend e2e + 10 UI e2e.
- `gen-certs.sh` — mints the self-signed Ed25519 cert+key for HTTPS (gitignored).
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, freelist, chrono, thread, atomic, tls, async, random, fdlopen,
  dynlib, **sandhi** (the HTTP services lib; `json` dropped — sandhi bundles its
  successor `bayan`. `tls`/`async`/`random`/`fdlopen`/`dynlib` are sandhi's
  transitive modules, added by hand since `+sandhi` doesn't auto-pull them.
  `thread`/`atomic` are now needed by sandhi's `run_pooled` rather than the
  probe's own pool.)
- **patra** `1.11.4` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.3.1` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
