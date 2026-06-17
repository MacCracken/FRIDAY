# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on cyrius 6.2.18 /
patra 1.11.2 / sakshi 2.3.1 (2026-06-17): both original 🔴 blockers stay closed
(TS/TSX→JS emit, patra string safety), re-verified end to end. patra's
thread-safety **P1 shipped in v1.11.0** — the filed finding from this probe — so
the app-level `g_db_lock` was removed; id allocation is now lock-free
(`atomic_fetch_add`). Earlier (2026-06-08, cyrius 6.1.15): the 6.1.14
`async`+nested-arrow emit bug fixed in 6.1.15, frontend workaround removed. See
[`../../FINDINGS.md`](../../FINDINGS.md).

## Toolchain

- **Cyrius pin**: `6.2.18` (in `cyrius.cyml [package].cyrius`)
- `lib/` is untracked + gitignored; regenerate with `cyrius lib sync` +
  `cyrius deps`.

## Source

- `src/httpd.cyr` — a thin routing shim that **composes `sandhi/server`** (the
  stdlib services lib). Per-request work is sandhi: `sandhi_server_recv_request`,
  `get_method` / `get_path` / `path_only` / `find_header` / `body_offset`,
  `send_response` / `send_status`, and the CL-TE / duplicate-header
  **request-smuggling rejects**. Kept locally (sandhi has neither yet): a
  function-pointer route table with method-aware dispatch (404 vs 405) and
  **`:name` path params** (`route_match` + `req_param` / `req_param_int`), the
  `resp_*` / `req_*` wrappers (so `main.cyr` is unchanged), and a **concurrent**
  server — `httpd_serve` runs a fixed worker-thread pool (`HTTPD_WORKERS`,
  default 4) fed by a bounded channel, each worker driving sandhi's per-request
  fns (sandhi's own `run`/`run_async` aren't truly parallel). `httpd_serve` also
  installs `SIG_IGN` for SIGPIPE (`httpd_ignore_sigpipe`) — sandhi/net's
  `sock_send` sets no `MSG_NOSIGNAL`, so a client disconnecting mid-response
  would otherwise crash the process (filed to sandhi as HIGH).
- `src/main.cyr` — wires routes to handlers and owns the patra persistence.
  `include "src/httpd.cyr"`. Registers `GET /`, `GET /app.js`,
  `GET /api/health`, `GET|POST /api/notes`, and the single-note resource
  `GET|PUT|DELETE /api/notes/:id` (bound `SELECT…WHERE` / `UPDATE` / `DELETE`;
  `PUT` does a pre-`SELECT` existence check since patra has no rows-affected
  API; `DELETE` is idempotent-200; `note_row_json` builds a row's JSON, shared
  by list + get). Note bodies are stored in a `TEXT`
  column via prepared statements with a bound `?` param (`patra_bind_text`) —
  SQL injection-safe, no length cap; the base64 stopgap is retired. **patra is
  now internally thread-safe** (P1 shipped v1.11.0: a process-global mutex
  serializes statement ops, result sets are caller-owned), so DB access needs
  no external lock — the old `g_db_lock` is gone. The app's `g_next_id` counter
  is bumped lock-free with `atomic_fetch_add(&g_next_id, 1)`. Health + static
  serving were already concurrent.
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
  **httpd `route_match`** — `:name` path-param capture, segment-count rules,
  and `req_param_int` numeric parsing. Passes via `cyrius run src/test.cyr`
  (idempotent).
  (`cyrius test` still does not discover the scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, freelist, chrono, thread, atomic, tls, async, random, fdlopen,
  dynlib, **sandhi** (the HTTP services lib; `json` dropped — sandhi bundles its
  successor `bayan`. `tls`/`async`/`random`/`fdlopen`/`dynlib` are sandhi's
  transitive modules, added by hand since `+sandhi` doesn't auto-pull them.)
- **patra** `1.10.3` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.2.6` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
