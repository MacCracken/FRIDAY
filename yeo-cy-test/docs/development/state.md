# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on cyrius 6.1.15 /
patra 1.10.3 / sakshi 2.2.6 (2026-06-08): both original 🔴 blockers closed
(TS/TSX→JS emit, patra string safety); the 6.1.14 `async`+nested-arrow emit bug
is fixed in 6.1.15 and the frontend workaround was removed. See
[`../../FINDINGS.md`](../../FINDINGS.md).

## Toolchain

- **Cyrius pin**: `6.1.15` (in `cyrius.cyml [package].cyrius`)
- `lib/` is untracked + gitignored; regenerate with `cyrius lib sync` +
  `cyrius deps`.

## Source

- `src/httpd.cyr` — reusable HTTP/1.1 server abstraction (extracted from the
  hand-rolled loop): request parsing (method / path / query / headers / body),
  a function-pointer route table with method-aware dispatch (404 vs 405),
  response framing helpers (`resp_json` / `resp_file` / `resp_*`), and the
  accept loop `httpd_serve(port, router)`. Single-threaded/blocking; one
  reusable `Req` instance shared across connections.
- `src/main.cyr` — wires routes to handlers and owns the patra persistence.
  `include "src/httpd.cyr"`. Registers `GET /`, `GET /app.js`,
  `GET|POST /api/notes`, `GET /api/health`. Note bodies are stored in a `TEXT`
  column via prepared statements with a bound `?` param (`patra_bind_text`) —
  SQL injection-safe, no length cap; the base64 stopgap is retired.
- `web/app.tsx` — typed frontend, single source of truth: a SecureYeoman
  dashboard shell with header/nav and a hash router (`#/` Home, `#/notes`
  Notes) that swaps views into `#app`.
- `web/app.js` — **generated** from `web/app.tsx` by `cyrius build --target=js`
  (do not hand-edit); `web/index.html` is a minimal mount + dashboard CSS.
- `build.sh` — emits `web/app.js` from the TSX (`--target=js` + `node --check`),
  then builds the backend.

## Tests

- `src/test.cyr` — patra bound-text invariant: a quote/injection/unicode body
  bound via `patra_bind_text` round-trips byte-for-byte through a `TEXT` column
  and leaves the table intact. Passes via `cyrius run src/test.cyr` (idempotent).
  (`cyrius test` still does not discover the scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, json, freelist, chrono
- **patra** `1.10.3` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.2.6` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
