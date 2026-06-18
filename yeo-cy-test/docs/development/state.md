# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.2.21 /
patra 1.11.4 / sandhi 1.6.7 / sakshi 2.3.1** (2026-06-18). **Every finding this
probe filed against the ecosystem is now resolved upstream** (sandhi route table
+ `run_pooled` in 1.6.7, SIGPIPE guard + docs in 1.6.6; patra
`last_insert_id`/`rows_affected` in 1.11.3; cyrius async leak in 6.1.22) and the
probe **adopted** all of them — it is now a thin sandhi + patra composition
(`src/httpd.cyr` collapsed 353 → 83 lines). 2 unit invariants + 24 end-to-end
scenarios pass. Both original 🔴 blockers (TS/TSX→JS emit, patra string safety)
stay closed. See [`../../FINDINGS.md`](../../FINDINGS.md).

## Toolchain

- **Cyrius pin**: `6.2.21` (in `cyrius.cyml [package].cyrius`); folds sandhi
  1.6.7.
- `lib/` is untracked + gitignored; regenerate with `cyrius lib sync` +
  `cyrius deps`.

## Source

- `src/httpd.cyr` — now just **response framing + body accessors over sandhi**
  (83 lines, down from a 353-line hand-rolled server). Keeps `str_lit`, the
  `http_body_ptr`/`http_body_len` accessors (over `sandhi_server_body_offset`),
  and the `resp_*` helpers (a "CODE Msg"-string convenience + JSON/file
  responders over `sandhi_server_send_response`). The hand-rolled route table,
  `Req` struct, accept loop, worker pool, and `httpd_ignore_sigpipe` shim are all
  **retired** — sandhi provides all of it as of 1.6.7 (route table) / 1.6.6
  (SIGPIPE guard, installed by the serve loop itself).
- `src/main.cyr` — handlers + route registration + patra persistence.
  `include "src/httpd.cyr"`. Handlers use **sandhi's route-handler signature**
  `fn(app_ctx, cfd, req_buf, req_len, params)`: body via `http_body_*`, path
  params via `sandhi_route_param_int`. Routes are registered on **sandhi's
  router** (`sandhi_router_new` / `sandhi_router_add`) and served by
  **`sandhi_server_run_pooled`** (`max_conns = 4` fixed worker threads;
  `SO_RCVTIMEO` slowloris guard; installs the SIGPIPE `SIG_IGN` guard itself).
  Endpoints: `GET /`, `GET /app.js`, `GET /api/health`, `GET|POST /api/notes`,
  and `GET|PUT|DELETE /api/notes/:id`. Persistence: note bodies in a `TEXT`
  column via prepared `?`-bound statements (`patra_bind_text`) — injection-safe,
  no cap. patra is internally thread-safe (P1, v1.11.0), so no external lock.
  Ids are **patra `AUTOINCREMENT`** (schema `id INT AUTOINCREMENT`, column-list
  `INSERT`, echoed via `patra_last_insert_id`) — the app-side `g_next_id` is
  gone. `PUT`/`DELETE` use `patra_rows_affected` for a real 404 (no pre-`SELECT`).
  Caveats (FINDINGS): AUTOINCREMENT reuses ids (derive-from-MAX); the
  `last_insert_id`/`rows_affected` readbacks are shared-handle (latent echo race,
  unreproduced).
- `web/app.tsx` — typed frontend, single source of truth: a SecureYeoman
  dashboard shell with header/nav and a hash router (`#/` Home, `#/notes`
  Notes) that swaps views into `#app`.
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
- `tests/verify.py` — 24-scenario end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart persistence, 250-concurrent unique ids,
  slow-client isolation, request-smuggling rejects, SIGPIPE survival,
  rows_affected concurrency). Run against a built `build/yeo-cy-test`.
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
