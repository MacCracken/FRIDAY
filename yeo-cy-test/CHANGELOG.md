# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Concurrency: a fixed worker-thread pool** in `httpd.cyr` (`thread.cyr`
  `thread_create` + a bounded `chan_*` handoff), replacing the single-threaded
  accept loop — a slow client now ties up only its worker. patra is not
  thread-safe, so DB access + `g_next_id` are serialized under a `g_db_lock`
  mutex; health/static serving run concurrent (`alloc()` is thread-safe).
  Verified: `/api/health` ~10ms while silent connections hold workers; 250
  concurrent POSTs → 0 errors, contiguous unique ids. Filed patra thread-safety
  **P1/P2** to patra's roadmap. Added `thread`, `atomic` to the stdlib deps.
- **`httpd_recv_full`** — reads a complete request (headers, then
  `Content-Length` body) instead of a single `sock_recv`; fixes POST bodies that
  arrive in a later TCP segment (dropped → spurious 400 under non-curl clients).
- **`src/httpd.cyr` — an HTTP/1.1 server abstraction**, extracted from the
  hand-rolled socket loop (addresses the FINDINGS "no HTTP server abstraction"
  gap in-probe). Request parsing (method / path / query / headers / body), a
  function-pointer route table with method-aware dispatch (404 for unknown
  path, **405** for wrong method), response framing helpers (`resp_json` /
  `resp_file` / `resp_json_err` / …), and the accept loop `httpd_serve`.
  `main.cyr` now just registers routes; handlers share the signature
  `fn(cfd, req): i64`.
- **SecureYeoman dashboard shell** (`web/app.tsx`): header + nav with a hash
  router (`#/` Home — service status + note count; `#/notes` — list + add).
  `web/index.html` is now a minimal `#app` mount + dashboard CSS.

### Changed
- Re-run on **cyrius 6.1.15 / patra 1.10.3 / sakshi 2.2.6** (was 6.0.3 / 1.9.5 /
  2.2.5). Both original 🔴 blockers are now closed upstream and verified here.
- **Frontend is now built by cyrius.** `web/app.js` is generated from
  `web/app.tsx` via `cyrius build --target=js` (TS/TSX→JS + JSX→`h` emitter,
  cyrius 6.1.11+); the hand-lowered stopgap is retired. `app.tsx` is now the
  whole app (render loop + mount), not just exported pieces. `build.sh` runs the
  real emit + `node --check`.
- **patra storage uses bound parameters.** Note bodies are stored in a `TEXT`
  column via `patra_prepare` + `patra_bind_text` + `patra_exec_prepared`
  (patra 1.10.3), replacing the base64-encode-for-SQL-safety stopgap. Removes
  the 256-byte body cap and is SQL-injection safe.
- `src/test.cyr` rewritten to assert the patra bound-text invariant (verbatim
  round-trip + injection safety) instead of the retired base64 invariant.
- Dropped `base64` from the stdlib dep list (no longer used).
- `lib/` is now untracked + gitignored; regenerated locally with `cyrius lib
  sync` + `cyrius deps` (was a 6.0.3-era vendored copy shadowing the pinned
  toolchain snapshot).

### Findings (filed)
- ✅ `cyrius --target=js` misplaced `async` when an `async function` contains a
  nested arrow → invalid JS. Reported from this probe; **fixed in cyrius
  6.1.15** (`async` now binds to the function it was parsed on). The `.map`
  arrow workaround in `web/app.tsx` has been removed.
- ✅ Tracked `./lib/` shadowing the pinned toolchain — resolved by untracking +
  gitignoring `lib/` and regenerating via `cyrius lib sync`. See FINDINGS.md.

## [0.1.0]

### Added
- Initial project scaffold
