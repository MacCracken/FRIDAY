# Cyrius Viability Findings — yeo-cy-test

Running log of rough edges, gaps, and DX notes hit while building a thin
full-stack slice (Cyrius backend + patra persistence + TS/TSX frontend).
Purpose: de-risk the eventual SecureYeoman → Cyrius port. The original probe
was on **Cyrius 6.0.3**; see the dated re-run sections below for newer toolchains.

Severity: 🔴 blocker · 🟡 friction · 🔵 note/nice-to-have

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
