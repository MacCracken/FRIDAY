# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Full single-note REST resource** — `GET` / `PUT` / `DELETE /api/notes/:id`,
  alongside the existing list/create. Exercises patra's `SELECT…WHERE` /
  `UPDATE` / `DELETE` with bound `?` params (first non-INSERT bind use) and a
  new **`:name` path-param router** in `httpd.cyr` (`route_match`:
  segment-by-segment matching, `:name` capture, equal-segment-count rule;
  `req_param` / `req_param_int` accessors). Verified end to end (get-by-id,
  404/400 edges, injection-safe update, idempotent delete, 405 on unmapped
  method, restart persistence) + a `route_match` unit test in `src/test.cyr`.
  Surfaced findings: patra has no rows-affected/`last_insert_id` readback
  (worked around with a pre-SELECT for `PUT`); Cyrius allows forward fn refs
  within a file. See FINDINGS.md.
- **Concurrency: a fixed worker-thread pool** in `httpd.cyr` (`thread.cyr`
  `thread_create` + a bounded `chan_*` handoff), replacing the single-threaded
  accept loop — a slow client now ties up only its worker. `alloc()` is
  thread-safe, so JSON/string building across workers is safe. DB access needs
  no external lock: patra is internally thread-safe (v1.11.0+), and the app's
  own id counter is bumped with `atomic_fetch_add` (`&g_next_id`) — see the
  lock-removal note under _Changed_. Verified: `/api/health` ~10ms while silent
  connections hold 2/4 workers; 250 concurrent POSTs → 0 errors, 250 unique
  contiguous ids. Filed patra thread-safety **P1/P2** to patra's roadmap; P1
  shipped in patra 1.11.0. Added `thread`, `atomic` to the stdlib deps.
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
- **Ported the HTTP service layer onto `sandhi/server`.** `src/httpd.cyr` is now
  a thin shim that composes sandhi for all wire work — `sandhi_server_recv_request`
  / `get_method` / `get_path` / `path_only` / `find_header` / `body_offset` /
  `send_response` / `send_status`, plus the CL-TE and duplicate-header
  **request-smuggling rejects** the hand-rolled server lacked. Kept on top: the
  route table + `:name` matcher (sandhi has no server router yet) and the
  worker-thread pool (sandhi's `run`/`run_async` aren't truly parallel).
  `main.cyr` + patra storage unchanged (`resp_*`/`req_*` signatures preserved).
  Added `httpd_ignore_sigpipe()` (`rt_sigaction(SIGPIPE, SIG_IGN)`) — sandhi/net
  don't set `MSG_NOSIGNAL`, so a client disconnecting mid-response was crashing
  the server (signal 13). Deps: `+sandhi` and its transitive modules
  `tls`/`async`/`random`/`fdlopen`/`dynlib`; dropped `json` (use sandhi's bundled
  `bayan`). Re-verified: 13-case CRUD, 250 concurrent POSTs (250 unique ids),
  slow-client isolation (~10 ms), smuggling rejects (CL+TE / CL.CL → 400).
  Filed to sandhi's roadmap: the SIGPIPE bug (HIGH); a docs note (opt-in
  companion modules + "use bayan not json"); the server-only ~400 KB static
  surface as a data point for the long-term bundled-libs→packages split; and a
  request for a thread-pool serve mode (`sandhi_server_run_pooled`).
- Re-run on **cyrius 6.2.18 / patra 1.11.2 / sakshi 2.3.1** (was 6.1.15 /
  1.10.3 / 2.2.6). Both original 🔴 blockers stay closed; clean build, invariant
  test, injection/unicode round-trip, restart persistence, and the concurrency
  suite all re-verified end to end on the new toolchain.
- **Removed the `g_db_lock` workaround.** patra's thread-safety **P1 shipped in
  v1.11.0** (a process-global mutex serializes every statement op; result-set
  accessors are caller-owned) — the filed finding from this probe — so the
  app-level mutex around all patra calls is gone. The only thing patra doesn't
  cover is the app's id allocation, now done lock-free with
  `atomic_fetch_add(&g_next_id, 1)`. Re-verified: 250 concurrent POSTs still
  yield 250 unique contiguous ids with no lock.
- _(earlier re-run)_ cyrius 6.1.15 / patra 1.10.3 / sakshi 2.2.6 (was 6.0.3 /
  1.9.5 / 2.2.5). Both original 🔴 blockers were closed upstream and verified.
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
- ⚠️ **Correction: the HTTP server abstraction exists — it's `sandhi`.** The
  original "no HTTP server abstraction" verdict looked at top-level stdlib
  primitives; the real services lib is `sandhi` (`sandhi/server`, a lift of
  stdlib `lib/http_server.cyr`): serve loop (sync + async), full-request read,
  method/path/param accessors, response framing, **and request-smuggling
  defenses** the probe lacks. What sandhi doesn't have yet is a route table
  (roadmapped) — which is exactly what the probe's `route_match` provides. Next
  step: port `src/httpd.cyr` onto `sandhi_server_*`. See FINDINGS.md.
- ✅ `cyrius --target=js` misplaced `async` when an `async function` contains a
  nested arrow → invalid JS. Reported from this probe; **fixed in cyrius
  6.1.15** (`async` now binds to the function it was parsed on). The `.map`
  arrow workaround in `web/app.tsx` has been removed.
- ✅ Tracked `./lib/` shadowing the pinned toolchain — resolved by untracking +
  gitignoring `lib/` and regenerating via `cyrius lib sync`. See FINDINGS.md.

## [0.1.0]

### Added
- Initial project scaffold
