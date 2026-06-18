# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Full notes-dashboard frontend + headless full-stack proof.** `web/app.tsx`
  grew from a list+add shell into a real CRUD UI: a `#/notes/:id` detail/edit
  route (GET by id + PUT), per-row delete (DELETE), and live Home status — so the
  browser now exercises the *entire* `/api/notes` resource. New
  `tests/ui_check.mjs` loads the **real cyrius-emitted `web/app.js`** into a
  minimal DOM+fetch shim against a running server and drives the rendered UI
  (list → add → open detail → edit → delete), cross-checking the DOM against the
  patra backend at each step (10 scenarios incl. XSS-safe text-node rendering).
  **Proves the whole stack together**: app.tsx → `cyrius --target=js` → browser
  JS → fetch → sandhi router → patra → JSX render. New `tests/run.sh` runs
  build + unit + 32 backend + 10 UI in one command. The TS/TSX→JS emitter
  handled a real multi-view CRUD SPA cleanly (positive finding — see FINDINGS).
- **HTTPS listener on :8443** over `tls_native` + `sigil` (pure-Cyrius TLS 1.3,
  Ed25519 cert/key via `gen-certs.sh`), serving the same routes as HTTP :8080 —
  both run together (plaintext in a worker thread, TLS in main), sharing one
  handler set and the patra backend. New `src/httpd.cyr` pieces: a `Conn`
  transport seam (`conn_write` → `sock_send` | chunked `tls_native_write`),
  conn-based `resp_*` framing (replicated from sandhi — it has no frame-to-buffer
  helper), `tls_serve` / `tls_recv_request` (hand-rolled accept loop — sandhi has
  no server-side TLS hook), and a conn-aware `srv_dispatch` over sandhi's matcher.
  `gen-certs.sh` mints the Ed25519 cert (RSA is rejected by `tls_native`);
  `build.sh` auto-mints if absent; cert/key are gitignored. Verified: 32 scenarios
  (24 HTTP + 8 HTTPS) — TLS 1.3 handshake, cert verify (`Verify return code: 0`),
  CRUD over TLS, injection/unicode-safe, untrusted-cert rejection, shared backend.
  Findings filed (sandhi server-TLS gap; `tls_native` server-side ALPN missing;
  RSA-key + cert-tooling gaps). See FINDINGS.md.
- `tests/verify.py` gained scenario 9 (HTTPS): CRUD over TLS, real cert
  verification, HTTP↔HTTPS shared-backend check.

### Added (earlier)
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
- **Fixed the patra shared-handle readback race (confirmed under concurrency).**
  The scenario-8 probe caught a real spurious 404 (concurrent PUTs racing on
  `DB_ROWS_AFFECTED`). Added a narrow `g_wr_lock` pairing each `[exec_prepared;
  readback]` (create's `last_insert_id`, PUT/DELETE's `rows_affected`) atomically;
  reads stay lock-free. Now deterministic (8/8 runs). Upgrades the earlier
  "latent" finding to confirmed+fixed and strengthens the filed patra
  atomic-insert-returning-id request. See FINDINGS.md.
- **Routing now goes through a `Conn`-aware `srv_dispatch`** (reusing sandhi's
  `sandhi_server_route_match`) instead of `sandhi_server_router_handler`, because
  the latter is plaintext-welded (its handlers `sock_send`). Plaintext keeps
  `run_pooled` via a `_plain_handler` adapter; handlers now take a `Conn` instead
  of a raw fd. sandhi's matcher remains the adopted piece.
- **Re-run on cyrius 6.2.21 / patra 1.11.4 / sandhi 1.6.7 / sakshi 2.3.1** (was
  6.2.18 / 1.11.2 / 1.6.5 / 2.3.1; sandhi is folded into the cyrius toolchain, so
  the cyrius bump pulls 1.6.7). All previously-filed findings are now resolved
  upstream; 2 unit invariants + 24 end-to-end scenarios pass, nothing regressed.
- **Adopted patra's write-readback (1.11.3).** `PUT /api/notes/:id` drops its
  pre-`SELECT` existence check — it `UPDATE`s and 404s on
  `patra_rows_affected == 0` (one statement, not two); `DELETE` now 404s on a
  missing id (was idempotent-200, a workaround for the missing count).
- **Adopted patra `AUTOINCREMENT` + `last_insert_id` (1.11.3).** Schema is
  `id INT AUTOINCREMENT`; create uses a column-list `INSERT` and echoes
  `patra_last_insert_id`. Removed the app-side `g_next_id` + `MAX(id)` seeding +
  `atomic_fetch_add`. Caveats filed (FINDINGS): a shared-handle `last_insert_id`
  echo race (latent — did not reproduce at 24 workers × 2400 inserts) and
  AUTOINCREMENT id-reuse (derive-from-MAX; observed in the suite).
- **Adopted sandhi's server route table (1.6.7).** Replaced the hand-rolled
  `route_match`/router + `Req` struct with `sandhi_router_*` +
  `sandhi_server_router_handler`; handlers moved to sandhi's
  `fn(app_ctx, cfd, buf, blen, params)` signature. `src/test.cyr` now validates
  sandhi's matcher. 404/405 are now sandhi's (status-only, not JSON).
- **Adopted sandhi `sandhi_server_run_pooled` (1.6.7).** Replaced the
  hand-rolled accept loop + worker pool (and the `httpd_ignore_sigpipe` shim —
  run_pooled installs the SIGPIPE `SIG_IGN` guard itself, Linux) with
  `sandhi_server_run_pooled` (`max_conns = 4`; gains a `SO_RCVTIMEO` slowloris
  guard). `src/httpd.cyr` collapsed 353 → 83 lines (response/body glue only) —
  **the probe is now a thin sandhi + patra composition.** Both features
  (route table + thread pool) were filed by this probe and shipped in sandhi
  1.6.7.
- Added `tests/verify.py` — the 24-scenario end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart, 250-concurrent unique ids, slow-client
  isolation, smuggling rejects, SIGPIPE survival, rows_affected concurrency).
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
- 🔴 **sandhi has no server-side TLS** — its serve loops/options/send paths are
  plaintext-only, so HTTPS required bypassing sandhi and hand-rolling a
  `tls_native` accept loop. Ask: a server TLS option (cert/key/ALPN) or a
  transport seam. (Filed to sandhi roadmap.)
- 🟡 **`tls_native` server-side ALPN not implemented** — `set_alpn` wires only the
  client offer; a server never negotiates ALPN (`openssl s_client` → "No ALPN
  negotiated"), so h2-over-TLS is unreachable server-side. (Filed cyrius-side.)
- 🔵 **`tls_native` rejects RSA server keys** (Ed25519/ECDSA only) + **no first-party
  cert/keygen/ACME tooling** — minted via openssl (`gen-certs.sh`).
- ✅ **Confirmed + fixed: patra shared-handle readback race** (see _Changed_) —
  strengthens the filed `requests/2026-06-18-…-insert-returning-id`.
- ✅ **All probe-filed ecosystem findings shipped upstream** (verified file:line):
  sandhi route table (1.6.7) + `sandhi_server_run_pooled` (1.6.7) + SIGPIPE guard
  (1.6.6) + docs (1.6.6); patra `last_insert_id`/`rows_affected` (1.11.3); cyrius
  async leak (6.1.22). All adopted (see _Changed_). Several credit yeo-cy-test.
- 🔵 **patra: shared-handle `last_insert_id`/`rows_affected` readback race.** The
  fields live on the shared handle and the write + readback are two non-atomic
  ops, so concurrent writers can read each other's value. Did not reproduce
  (24×2400), but filed: an atomic `INSERT … RETURNING id` / id-from-`exec_prepared`
  would make it race-free for concurrent inserts. Until then the race-free choice
  is app-assigned ids.
- 🔵 **sandhi: `run_pooled` handoff channel is sized to the worker count,** so a
  thundering-herd burst far exceeding workers sheds via the listen backlog (clean
  ECONNRESET, no data loss). A backlog depth decoupled from `max_conns` would
  absorb bursts better. (Filed as a note; size `max_conns` to workload meanwhile.)
- 🟡 **cyrius: `fmt <file> --check` continuation false-positive persists on
  6.2.21** — flags the two-line `sandhi_server_send_response` call in
  `src/httpd.cyr` (exit 1) while apply-mode `cyrius fmt` is byte-identical.
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
