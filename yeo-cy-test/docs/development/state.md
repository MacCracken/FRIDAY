# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end as of 2026-05-27.

## Toolchain

- **Cyrius pin**: `6.0.3` (in `cyrius.cyml [package].cyrius`)

## Source

- `src/main.cyr` — the entire backend: TCP server loop over `net.cyr`, request
  routing, JSON responses (`json.cyr`), static file serving (`io.cyr`), and
  patra-backed CRUD for `/api/notes` (bodies base64-encoded for SQL safety).
- `web/app.tsx` — typed frontend source of truth (cyrius-validated).
- `web/app.js`, `web/index.html` — served browser bundle + shell.
- `build.sh` — validates the TS/TSX with `cycc --parse-ts`, then builds backend.

## Tests

- `src/test.cyr` — base64 quote-free + lossless invariant; passes via
  `cyrius run src/test.cyr`. (`cyrius test` does not currently discover the
  scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, json, freelist, chrono, base64
- **patra** `1.9.5` — SQL persistence (`[deps.patra]`)
- **sakshi** `2.2.5` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The findings, not the demo, are the output. See [`../../FINDINGS.md`](../../FINDINGS.md)
and [`roadmap.md`](roadmap.md).
