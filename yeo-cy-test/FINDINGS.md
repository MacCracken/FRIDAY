# Cyrius Viability Findings — yeo-cy-test

Running log of rough edges, gaps, and DX notes hit while building a thin
full-stack slice (Cyrius backend + patra persistence + TS/TSX frontend).
Purpose: de-risk the eventual SecureYeoman → Cyrius port. The original probe
was on **Cyrius 6.0.3**; see the dated re-run sections below for newer toolchains.

Severity: 🔴 blocker · 🟡 friction · 🔵 note/nice-to-have

## Update — re-run on Cyrius 6.2.18 (2026-06-17)

Re-ran the whole slice on **cyrius 6.2.18 / patra 1.11.2 / sakshi 2.3.1** (was
6.1.15 / 1.10.3 / 2.2.6 — a full cyrius minor forward). Bumped the three pins
(`cyrius.cyml`), regenerated `lib/` + deps (`cyrius lib sync && cyrius deps`),
and rebuilt. **Everything still works, nothing regressed**, and the headline
finding from the last concurrency milestone is now **closed upstream**.

- ✅ **patra thread-safety P1 — SHIPPED (patra 1.11.0), workaround removed.**
  The 2026-06-09 milestone filed that patra was not thread-safe (one shared
  handle + global parse/bind scratch), forcing the probe to serialize *all* DB
  access under an app-level `g_db_lock`. patra 1.11.0 fixed it: a process-global
  futex mutex now serializes every self-contained statement op (`patra_exec` /
  `patra_query` / prepared ops), and result-set accessors operate on
  caller-owned result sets. patra's own roadmap says *"consumers drop their
  external `g_db_lock`"* — so this probe did. `src/main.cyr` no longer takes any
  app-level DB lock; the one thing patra doesn't cover (the app's `g_next_id`
  allocation) is now lock-free via `atomic_fetch_add(&g_next_id, 1)`. The
  `list`/`create` handlers call patra directly.
  - **Re-verified end to end**: clean build (frontend emit + `node --check`,
    backend compile); the patra bound-text invariant test passes; an
    injection+unicode body (`O'Brien'); DROP TABLE notes--  ☃ 日本語`)
    round-trips verbatim and survives a restart; **250 concurrent POSTs → 250
    unique contiguous ids, 0 errors, no lock**; a slow client holding 2 of 4
    workers leaves `/api/health` at ~10 ms.
- 🔵 **patra has no `last_insert_id` / rowid-return.** With P1 done, the natural
  cleanup was to drop the app `g_next_id` entirely and use patra's
  `AUTOINCREMENT` (shipped 1.10.1). But there's no API to read back the
  auto-assigned id after an INSERT, so echoing the created row in the `201`
  response would require a racy `SELECT MAX(id)`. Kept explicit app-assigned ids
  (now lock-free via atomics) instead. A `patra_last_insert_id(db)` would make
  `AUTOINCREMENT` usable for insert-then-echo APIs (the common REST shape).
- 🔵 Both original 🔴 blockers (TS/TSX→JS emit, patra string safety) and the
  6.1.15 `async`+nested-arrow emit fix all **hold on 6.2.18** — no re-breakage
  across the 6.1→6.2 minor.

### Widened the surface: a full single-note REST resource (2026-06-17)

To flush out more SY-shaped surface, extended `/api/notes` from
list+create to a full resource: **`GET` / `PUT` / `DELETE /api/notes/:id`**.
Every SecureYeoman endpoint is a parameterized resource, so this stresses two
areas the earlier probe never touched — path-param routing and patra's
UPDATE/DELETE/WHERE SQL — and is verified end to end (13-case lifecycle:
get-by-id, 404 on missing, 400 on non-numeric id, update w/ injection payload,
idempotent delete, 405 on unmapped method, trailing-slash rejection, restart
persistence) plus a `route_match` unit test in `src/test.cyr`.

- ✅ **patra UPDATE / DELETE / SELECT…WHERE with bound params all work**
  (v1.10.2 bind support, exercised here for the first time). `SELECT … WHERE
  id = ?`, `UPDATE … SET body = ? WHERE id = ?`, and `DELETE … WHERE id = ?`
  via `patra_prepare` + `patra_bind_int`/`patra_bind_text` + `patra_exec_prepared`
  / `patra_query_prepared`. `?` placeholders bind in occurrence order (SET
  before WHERE). The documented *"WHERE on a TEXT column never matches"*
  constraint doesn't bite here — the key (`id`) is INT.
- 🔵 **patra has no rows-affected / `changes()` API.** A bare `UPDATE`/`DELETE`
  on a non-existent id returns `PATRA_OK` with no way to learn that zero rows
  matched, so an endpoint can't tell "updated" from "nothing there." The probe
  works around it for `PUT` with a pre-`SELECT` existence check (an extra
  round-trip); `DELETE` stays idempotent-200 (valid REST). Wanted:
  `patra_rows_affected(db)` after a write. Pairs with the `last_insert_id` gap
  below — both are the "what did that write do?" readback that REST handlers
  need. (Filed to patra's roadmap; another agent owns patra.)
- 🔵 **No `last_insert_id` / rowid-return after INSERT.** (carried from above)
  With P1 done, the natural cleanup was to drop the app `g_next_id` and use
  patra's `AUTOINCREMENT` (1.10.1), but there's no API to read back the
  auto-assigned id for the `201` echo. Kept app-assigned ids (lock-free atomics).
- 🔵 **Cyrius allows forward function references within a file** (DX positive):
  `handle_list_notes` calls `note_row_json` defined later in `main.cyr` and it
  compiles fine — no forward declarations needed, unlike C. Worth knowing for
  the port (don't topologically sort helpers).

### ⚠️ Correction: the HTTP server abstraction exists — it's `sandhi`

**The original Verdict #4 ("No HTTP server abstraction") and the
"stdlib has no `http_serve`/router" notes below are WRONG — they looked at the
wrong layer.** Cyrius's model is: **top-level stdlib = primitives; the fuller
ecosystem libs hold the real functionality.** The services lib is **`sandhi`**
(it's where patra-for-storage's equivalent lives for HTTP). `sandhi/server` —
itself a lift of stdlib `lib/http_server.cyr` — already provides essentially
everything `src/httpd.cyr` hand-rolled, plus security this probe lacks:

- `sandhi_server_run(addr, port, handler, ctx)` (sync) and
  `sandhi_server_run_async(…, opts)` (concurrent via `lib/async.cyr`'s event
  loop, arena-bounded recv buffers) — so concurrency is built in; the
  hand-rolled worker pool isn't needed.
- `sandhi_server_recv_request` (= `httpd_recv_full`), `sandhi_server_get_method`
  / `get_path` / `get_param` (query) / `path_segment`, `sandhi_server_send_response`
  / `send_status` / `send_204` / chunked send (= the `resp_*` framing).
- **Request-smuggling defenses** — `sandhi_server_request_has_cl_te_conflict`
  and `_has_dup_smuggling_header` — which `httpd.cyr` does **not** have. This is
  the strongest reason to sit on `sandhi` for the real SY port.

What `sandhi` does **not** provide yet (its own roadmap: "routing, middleware,
and auth primitives layer on top in later milestones"): a **route table**.
`sandhi_server_run` dispatches to a single handler. So the probe's `route_match`
(method + `:name` path-param dispatch, built on `path_segment`-style splitting)
is exactly the missing layer — **useful feedback for sandhi's routing
milestone**, not a stdlib gap. Known `sandhi` caveat: `run_async` leaks ~32 B
per connection via `lib/async.cyr`'s task structs (filed cyrius-side:
`docs/issues/2026-06-09-async-runtime-no-free-task-leak.md`).

### Ported onto sandhi (2026-06-17)

Done. `src/httpd.cyr` is now a thin shim over `sandhi/server`: each worker calls
`sandhi_server_recv_request` / `get_method` / `get_path` / `path_only` /
`find_header` / `body_offset` / `send_response` / `send_status`, and the
CL-TE / duplicate-header smuggling rejects, instead of the hand-rolled
equivalents. Kept on top (the two things sandhi lacks): the method+path route
table + `:name` matcher (`route_match`), and the worker-thread pool (sandhi's
`run` is single-flight, `run_async` cooperative — neither gives true multi-core
parallelism, which SY's axum backend has). `main.cyr`'s handlers + patra storage
were unchanged (the `resp_*` / `req_*` signatures were preserved). Deps added:
`sandhi` + its transitive modules `tls`, `async`, `random`, `fdlopen`, `dynlib`,
and `json` dropped in favor of `sandhi`'s bundled `bayan`.

Verified end to end on the sandhi-backed server: 13-case CRUD lifecycle, 250
concurrent POSTs → 250 unique contiguous ids, slow client holding 2/4 workers
leaves `/api/health` ~10 ms, **and the new smuggling rejects** — `Content-Length`+
`Transfer-Encoding` coexistence → 400, duplicate `Content-Length` → 400, sane
request → 200. Gains over the hand-rolled server: those smuggling defenses, a
strict RFC-7230 `Content-Length` parser, and a maintained wire layer.

Findings filed to sandhi's roadmap (another session owns sandhi):

- 🔴 **HIGH: the server doesn't guard SIGPIPE** — a client that sends a request
  line then disconnects (or drops mid-response) makes `sock_send` raise SIGPIPE
  and the **default disposition terminates the whole server** (verified: signal
  13, a trivial remote DoS). `net.cyr` `sock_send` uses no `MSG_NOSIGNAL` and
  sandhi installs no `SIG_IGN`. The probe works around it exactly like the patra
  shims: `httpd_ignore_sigpipe()` installs `rt_sigaction(SIGPIPE, SIG_IGN)` at
  `httpd_serve` startup (x86_64: syscall 13). After the fix the server survives
  every partial/empty/disconnect case. (This bug was latent in the old
  hand-rolled server too — same `sock_send` — the port's partial-request tests
  just exposed it.)
- 🟡 **Documentation** (not a bug — libs are opt-in by design): adding `sandhi`
  needs the companion modules `tls`/`async`/`random`/`fdlopen`/`dynlib` opted in
  too (undefined-symbol errors otherwise), and JSON must be `bayan` **not**
  `json` — `bayan` (the `json_v_*` successor) and `json` both define `json_v_*`/
  `_jv_*`/`_jp_*`, so opting into both collides regardless of sandhi. A
  "Requires: …" line in sandhi's docs would close it.
- 🔵 **Server-only use carries the whole client/h2/tls surface** (~400 KB static
  `.bss` of h2/hpack/tls tables `CYRIUS_DCE=1` can't reclaim). Not a new ask —
  a data point for the long-term **bundled-libs → individual-packages split**;
  a plaintext-HTTP server is the consumer that'd benefit from a server-only
  package.
- **Filed a request: thread-pool / true-parallel serve mode.** Both sandhi serve
  loops are single-threaded (`run` single-flight, `run_async` cooperative), so a
  blocking/CPU-bound handler serializes the rest — SY's axum backend is
  multi-threaded, so the port needs real parallelism. Filed on sandhi's roadmap
  (yeo-cy-test as first asker) proposing `sandhi_server_run_pooled`, with this
  probe's `httpd_serve`/`_httpd_worker` thread pool as the reference shape. Until
  then the probe keeps that pool feeding sandhi's (pool-safe) per-request fns.
- 🔵 Also filed: a stale `run_async` leak doc-comment (the header still claims
  ~32 B/conn; the inline 1.5.3 note + code show it was fixed to zero residual).

## Update — re-run on Cyrius 6.1.14 → 6.1.15 (2026-06-08)

Re-ran the slice on **cyrius 6.1.14** then **6.1.15**, **patra 1.10.3**,
**sakshi 2.2.6** (was 6.0.3 / 1.9.5 / 2.2.5). **Both 🔴 blockers from the 6.0.3
verdict are now closed**, verified end to end on this machine; the one emit bug
found along the way was fixed in 6.1.15 (below). Pin is **6.1.15**.

- ✅ **TS→JS / JSX emit — CLOSED** (cyrius 6.1.11+). `cyrius build --target=js
  web/app.tsx web/app.js` (and `cycc --emit-js`) lowers the real `web/app.tsx`
  to browser JS: types stripped, JSX lowered to an `h(tag, props, …children)`
  runtime emitted as a prelude. `web/app.js` is now a **generated artifact**
  (the hand-lowered stopgap is retired) and `build.sh` runs the real emit.
  Verified: `node --check` clean, and the emitted bundle *runs* in a DOM shim —
  `fetch` → JSX render → form submit all work, and a body containing
  `<img onerror=…>` is appended as a **text node** (XSS-safe by construction).
- ✅ **patra string safety — CLOSED** (patra 1.10.3). `?` placeholders +
  `patra_prepare` / `patra_bind_text` / `patra_bind_int` / `patra_exec_prepared`
  replace the base64 stopgap; the `body` column is now `TEXT` (no 256 B cap).
  Verified: `O'Brien'; DROP TABLE notes--` and a 400-byte body round-trip
  verbatim and survive a restart; the table is intact (no injection).

Issues surfaced and resolved along the way:

- ✅ **`--target=js` misplaced `async` with a nested arrow — FIXED in 6.1.15.**
  On 6.1.13/6.1.14, an `async function` whose body contained a nested arrow
  (e.g. `xs.map(x => …)`) emitted with `async` **stripped from the owner** and
  stamped on the inner arrow → a bare `await` → `SyntaxError` under
  `node --check`. Filed with a minimal repro + root cause (now archived at
  `cyrius/docs/development/issues/archived/2026-06-08-yeo-cy-test-emit-js-async-nested-arrow.md`);
  fixed by cyrius 6.1.15 — `async` now binds to the function node it was parsed
  on rather than the first nested arrow. The temporary `noteRows`
  sync-helper workaround in `web/app.tsx` has been **removed** — the idiomatic
  `.map((note) => NoteRow({ note }))` inside async `render()` now emits valid JS
  (re-verified: `node --check` clean + DOM harness passes).
- ✅ **Vendored `./lib/` shadow — RESOLVED.** The probe tracked a full stdlib
  copy under `lib/` (from `cyrius init`, 6.0.3-era) that shadowed the
  version-pinned `~/.cyrius/versions/<ver>/lib/`, compiling against stale
  stdlib. `lib/` is now **untracked + gitignored** and regenerated locally with
  `cyrius lib sync` (stdlib from the pin) + `cyrius deps` (external deps). The
  build is clean — no shadow warning — and reproducible from a fresh checkout.
- 🟡 **`cyrius build` warns on pin drift** — `cyrius.cyml pins X but cycc is Y`.
  Useful (caught the 6.1.13→6.1.14 bump mid-session), but the only remedy is to
  edit the pin by hand; a `cyrius pin --latest` convenience would help.

Note: the 6.0.3 findings below are **historical** — the two blockers are
resolved above; the patra INSERT-column-list / STR-cap / sakshi-transitive
items were tracked separately into patra and are partly addressed (TEXT column,
bind params). Left intact as the original record.

---

## Verdict

A complete, persistent full-stack slice — Cyrius HTTP server + patra SQL storage
+ JSON API + a TS/TSX-validated, browser-served frontend — **stands up today on
Cyrius 6.0.3.** Everything in the thin-slice target works end to end and survives
restarts. Cyrius is viable for the SecureYeoman backend port now; the dashboard
port is gated on one missing capability.

Top things to fix, in priority order for the port:

1. 🔴 **TS→JS / JSX emit** — the parser is excellent but there's no codegen, so
   the frontend can be *validated* by cyrius but not *built* by it. This is the
   single blocker for "build the TS/TSX frontend just by cyrius."
2. 🔴 **patra string safety** — no SQL escaping and no bind parameters, so
   arbitrary user text can't be stored safely (we base64-worked-around it). SY
   stores lots of free text; this needs `patra_bind_*` before the port.
3. 🟡 **Tooling exit codes & stdin** — `cyrius build` and `ts_test_runner`
   return 0 on failure, and `cycc --parse-ts` blocks on stdin; all three break
   scripted/CI use until fixed.
4. 🟡 **No HTTP server abstraction** — everything above the raw socket is
   hand-rolled; a small `httpd.cyr` (router + request parse + response framing
   + a concurrency story) would carry the whole port.

## Toolchain & scaffolding

- 🔵 `cyrius init` emits a stray trailing `---` line at the end of generated
  `cyrius.cyml` (line 16). The build tolerates it, but it reads like an
  accidental YAML doc separator left in the template.
- 🔵 Default `cyrius build` reports `277 unreachable fns (41200 bytes)` from the
  fully-vendored stdlib and only eliminates them when `CYRIUS_DCE=1` is set.
  Dead-code elimination being opt-out-by-default inflates dev binaries; worth
  considering DCE-on for release builds by default.
- 🔵 `cycc` (low-level compiler) writes a stub ELF to stdout for unrecognized
  invocations instead of a usage/error message — confusing when probing flags
  directly. The `cyrius` build tool is the intended interface; `cycc` flags are
  undiscoverable (stripped binary, no `--help`).
- 🟡 With a warm dep cache, `cyrius deps` / `cyrius build` print
  `fatal: destination path '.../deps/<dep>/<tag>' already exists and is not an
  empty directory` for each cached dep, yet still succeed (`N deps resolved`).
  The `fatal:` git noise reads like a failure — should detect the cache hit and
  stay quiet, or print `cached <dep>@<tag>`.
- 🔵 `cyrius build` re-resolves deps on every invocation (re-emits the above per
  build). A lockfile-fast-path / `--offline` would speed the edit-build loop.
- 🟡 **`cyrius test` discovers no `.tcyr` files.** `cyrius init` scaffolds
  `tests/<name>.tcyr`, but `cyrius test` reports `No .tcyr files found in
  tests/tcyr/ or tests/` and exits 0 — for a file sitting in `tests/`, for a
  simply-named `tests/smoke.tcyr`, and for a copy placed in `tests/tcyr/`. So
  the out-of-box test suite never runs and reports green (false pass). The
  `[build].test` entry (`src/test.cyr`) isn't run by `cyrius test` either; it
  works via `cyrius run src/test.cyr`. Scaffold layout and runner discovery are
  out of sync, and "no tests" should not be a silent exit 0.
- 🟡 **`cyrius fmt --check` disagrees with `cyrius fmt`.** `--check` exited 1 on
  `src/main.cyr` while apply-mode `cyrius fmt` produced a byte-identical file
  (empty diff). The trigger was a single function call split across two lines
  (`json_v_obj_set(o, …,\n   json_v_str_new(…))`); `--check` flags it but
  apply-mode won't fix it, and `--check` prints nothing (no file/line/what), so
  you're left guessing. Either apply-mode should reformat what `--check` flags,
  or `--check` shouldn't flag continuations it can't fix — and it should name
  the offending location.

## HTTP / networking

- 🔵 `net.cyr` TCP stack (`tcp_socket`/`sock_reuse`/`sock_bind`/`sock_listen`/
  `sock_accept`/`sock_recv`/`sock_send`/`sock_close`) is clean and complete
  enough to stand up an HTTP/1.1 responder in ~30 lines. `Result` ergonomics
  (`is_ok`/`result_unwrap`) work fine. **No HTTP server abstraction** in stdlib
  though — there is `http.cyr` (client: `http_get`) but no `http_serve`/router.
  Everything above the socket (request parsing, response framing, headers,
  Content-Length) is hand-rolled. For the SY port this is the single biggest
  gap: SY leans on axum. A small `httpd.cyr` server helper would carry a lot.
  **Update (6.1.15):** addressed *in-probe* by extracting `src/httpd.cyr` —
  request parse (method/path/query/headers/body), a function-pointer route
  table with method-aware dispatch (404/405), `resp_*` framing helpers, and an
  `httpd_serve(port, router)` loop. The function-pointer router works cleanly
  (`&handler` + `fncall2`). This is a candidate to upstream into the stdlib as
  an `httpd.cyr`/`http_serve`. Still missing upstream: a stdlib server, a
  concurrency story (below), and per-request arena/free (the bump allocator
  never reclaims per-request `str_builder`/`Req` allocations, so a long-lived
  server grows unboundedly — fine for the probe, not for production).
- 🟡 The accept loop is single-threaded and blocking — one slow client stalls
  all others. `sock_set_recv_timeout` exists (slowloris guard) but real
  concurrency needs `thread.cyr` or an epoll loop, neither wired into a server
  helper. Acceptable for a probe; a real port needs a concurrency story.
  **Update (2026-06-09):** addressed in `httpd.cyr` with a **fixed worker-thread
  pool fed by a bounded channel** (`thread.cyr` `thread_create` + `chan_*`):
  `HTTPD_WORKERS` workers pull accepted connections off the channel, so a slow
  client ties up only its own worker. Verified: `/api/health` returns in ~10ms
  while 2 silent connections hold workers; 250 concurrent POSTs complete with
  0 errors and contiguous unique ids. Two enabling notes:
    - `thread.cyr` is solid (`thread_create`/`mutex_*`/`chan_*`/`atomic_*`) and
      `alloc()` is **thread-safe** (process-wide CAS spinlock, v6.0.64), so
      concurrent JSON/string building across workers is safe out of the box.
      Thread stacks are 64 KB and reclaimed only on `thread_join` — hence a
      fixed pool (not thread-per-connection, which would leak a stack per conn).
    - **patra is not thread-safe** (one shared handle + global parse/bind
      scratch), so every DB call is serialized under one app-level mutex
      (`g_db_lock`). Filed to patra's roadmap as **P1** (make a shared handle
      safe) / **P2** (concurrent readers). This is the real ceiling on DB
      parallelism here.
- 🟡 **A single `sock_recv` is not a full request read.** The original loop
  (and the first worker cut) read once and assumed the whole request arrived —
  fine for curl (coalesces headers+body into one segment), but POST bodies from
  clients that write headers and body separately (e.g. Python `urllib`) landed
  in a later segment and were dropped → spurious `400`. Concurrency surfaced it
  (1/10 POSTs succeeded). Fixed with `httpd_recv_full`: read until `\r\n\r\n`,
  then until `Content-Length` body bytes arrive. A stdlib `http_serve` should do
  this framing (incl. growable buffers — the probe caps requests at 8 KB).
- 🔵 No unary `!` operator — `if (!is_ok(x))` does not parse; use
  `if (is_ok(x) == 0)`. Minor, but a common porting papercut from Rust/TS.
- 🔵 `json.cyr` typed builder (`json_v_obj_new`/`json_v_obj_set`/
  `json_v_str_new`/`json_v_build`) produces clean, correct output and is
  pleasant to use. **Gotcha**: object keys *and* string values must be `Str`,
  not cstring literals — passing a literal compiles but serializes garbage. A
  one-line `str_lit(c) = str_new(c, strlen(c))` wrapper bridges it. Worth either
  a cstring-accepting overload (`json_v_obj_set_c`) or a stdlib `str_lit`.

## patra (SQL persistence)

patra **works** — open, CREATE TABLE, INSERT, SELECT, ORDER BY, aggregates, and
crash-safe persistence across restarts all verified. The `.patra` file survived
a full process restart and `MAX(id)` re-seeding kept ids monotonic. The gaps
below are the consumer feedback patra is waiting on; ordered by impact for the
SecureYeoman port.

- 🔴 **No SQL string escaping.** The tokenizer (`sql_tokenize`,
  `lib/patra.cyr:1089`) opens on `'` and closes at the *first* following `'` —
  no `''` doubling, no backslash escapes. Any user string containing a single
  quote either truncates the literal (→ `PATRA_ERR_SYNTAX`) or, with crafted
  input, **injects SQL**. There is no safe way to store arbitrary text through
  `patra_exec` today. We worked around it by base64-encoding the note body
  before INSERT and decoding on read (base64's alphabet has no quotes). The SY
  port stores lots of free text — this is the #1 thing to fix.
- 🔴 **No bind parameters / placeholders.** `patra_prepare` caches the tokenized
  parse for speed but bakes the literal values in at prepare time; there are no
  `?` placeholders and no `patra_bind_*` functions. So prepared statements do
  not solve the escaping problem either. A `patra_bind_text/int/blob` API would
  fix both #1 and #2 at once and is the standard answer (sqlite3_bind_*).
- 🟡 **INSERT has no column list.** `INSERT INTO t (a, b) VALUES (...)` is a
  syntax error (`_parse_insert` requires `VALUES` immediately after the table
  name). Values must be positional in CREATE TABLE order. Brittle as schemas
  evolve and a porting footgun (axum/SQLx code names columns).
- 🟡 **STR columns are fixed 256 bytes** (`COL_STR_SZ`, incl. NUL) and truncate
  silently past that. base64 inflation (4/3) drops the effective text cap to
  ~189 bytes. There's a `COL_BYTES`/blob-page type for larger payloads but no
  SQL syntax surfaced to write it via `patra_exec` — needs either a TEXT/VARLEN
  column or a documented blob-insert API.
- 🔵 **No AUTOINCREMENT / rowid.** Consumers must allocate ids themselves; we
  seed `g_next_id` from `SELECT id ... ORDER BY id` at boot. An auto rowid or
  `SELECT MAX(id)` convenience would remove boilerplate.
- 🔵 **Undocumented transitive dep on sakshi.** `dist/patra.cyr` calls
  `sakshi_error` / `sakshi_set_level` but doesn't vendor sakshi, so a consumer
  that adds only `[deps.patra]` fails to link until they *also* add
  `[deps.sakshi]`. Either inline sakshi into the dist bundle or document the
  requirement in patra's README/cyrius.cyml.

## TS/TSX frontend build

The headline question — *"can a TS/TSX frontend be built just by cyrius?"*

**Parser: yes, and it's impressively complete.** `cycc --parse-ts` accepted
every real-world fixture thrown at it, including a React component using
`useState<Note[]>`, `useEffect`, JSX with `.map`/`key`/`data-*`, `<K extends
string, V>` generics, default type params (`Result<T, E = Error>`), `?.`/`??`,
async/await, enums, `readonly`/optional members, destructuring, spread, `as`
casts, tuples, `Record<K,V>`, and `// line comments`. This validates the claim
that the TS/TSX front-end (built off SecureYeoman's own TS handling) was
"extended to the full" parser. For the SY port, the dashboard's TSX should
parse-clean as-is.

**Emit: no — this is THE gap.** There is no TS→JS emit anywhere in the
toolchain. `cyrius build web/app.tsx …` does not route through the TS parser at
all — it tries to compile the `.tsx` as *Cyrius source* and dies on the first
`//` (Cyrius comments are `#`). So "built just by cyrius" today means
**parse-validated** by cyrius, not **transpiled** by cyrius. We author the
canonical typed source in `web/app.tsx` (cyrius validates it as a build gate)
and hand-lower the served bundle to `web/app.js`. The missing piece for the
vision is a `cycc --emit-js` / `cyrius build --target=js` codegen stage that
turns the already-parsed AST into browser JS (strip types, lower JSX). The hard
part — a correct full-fidelity parser — already exists.

- 🔴 **No TS→JS / JSX emit.** (above) The one capability that stands between
  "cyrius validates my frontend" and "cyrius builds my frontend."
- 🟡 **`cycc --parse-ts <file>` blocks on stdin even when given a file arg.**
  Cost me the most time here: in a no-tty / backgrounded / scripted context it
  hangs forever (one orphaned invocation sat for 17 min holding things up).
  Always invoke with `</dev/null`. Fix: don't read stdin when a path argument
  is present. This will bite anyone scripting the parser (CI, build tools).
- 🟡 **`cyrius build` exits 0 on compile failure.** `cyrius build web/app.tsx`
  printed `error: … unexpected '/'` and `FAIL` but returned exit code 0. Build
  scripts/CI can't detect failures by exit status — they'd have to scrape
  stderr. Compile errors must yield a non-zero exit.
- 🟡 **`ts_test_runner` looks for the compiler at `~/.cyrius/bin/cyc`** (note:
  `cyc`, not `cycc`) and prints `error: cycc not found at …/cyc` — then *still
  exits 0*. So the official TS harness is currently unusable out of the box and
  silently "passes". Two bugs: wrong binary name + zero exit on error.
- 🔵 Static file serving from the Cyrius side (`io.cyr file_read_all` +
  `fs.cyr`) is fine — served `index.html`/`app.js` came back byte-identical to
  source. No `Content-Type`-by-extension helper though; you set MIME manually.
