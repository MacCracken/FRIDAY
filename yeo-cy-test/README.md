# yeo-cy-test

A thin full-stack slice that proves out **[Cyrius](https://github.com/MacCracken/cyrius)**
as the target language for the eventual SecureYeoman port: a Cyrius backend
server with SQL persistence and a TS/TSX frontend, exercising the basic
functionality SecureYeoman relies on.

Purpose: de-risk "rewrite SecureYeoman in Cyrius" by building the smallest
end-to-end thing that touches every layer of the future stack, and recording
where Cyrius needs work. **All findings are in [FINDINGS.md](FINDINGS.md).**

## What it is

- **Backend** — a Cyrius HTTP/1.1 server on `:8080` (plaintext) **and `:8443`
  (HTTPS / TLS 1.3)**, both serving the same routes off one
  [sandhi](https://github.com/MacCracken/sandhi) router. sandhi (the Cyrius HTTP
  services lib) now provides server-side TLS too: HTTP runs on
  `sandhi_server_run_pooled` and HTTPS on `sandhi_server_run_pooled_tls` (TLS 1.3
  via `tls_native` + [sigil](https://github.com/MacCracken/sigil), Ed25519 cert,
  ALPN `http/1.1`) — the probe's hand-rolled HTTPS stack is retired. The TLS pool
  runs **4 workers** (`max_conns=4`, matching plaintext): the last blocker — a
  sigil⇄patra thread-local slot-0 collision that corrupted handshakes
  (`RECORD_LAYER_FAILURE`) — was fixed in sigil 3.9.9 (cyrius 6.3.25); see FINDINGS.
  Routes:
  - `GET  /`                → serves the frontend (`web/index.html`)
  - `GET  /app.js`          → serves the frontend bundle
  - `GET  /api/health`      → `{ "status": "ok", … }`
  - `GET  /api/notes`       → list notes (JSON array)
  - `POST /api/notes`       → create a note from `{ "body": "…" }`
  - `GET|PUT|DELETE /api/notes/:id` → fetch / replace / delete one note
- **Storage** — [patra](https://github.com/MacCracken/patra), the sovereign
  Cyrius SQL database. Notes persist to `yeo.patra` (ids via patra
  `AUTOINCREMENT`) and survive restarts.
- **Frontend** — `web/app.tsx` is the typed source of truth: a notes dashboard
  (Home status, list+add, and a `#/notes/:id` detail/edit view) that drives the
  full CRUD API from the browser. `web/app.js` is **generated** from it by
  `cyrius build --target=js` (the cyrius 6.1.11+ TS/TSX→JS + JSX emitter); do not
  hand-edit `app.js`. JSX lowers to an `h()` runtime that renders user content as
  text nodes (XSS-safe).

Note bodies are stored in a patra `TEXT` column via a prepared statement with a
bound `?` parameter (`patra_bind_text`, patra 1.10.3), so arbitrary text —
apostrophes, quotes, unicode, any length — round-trips safely with no SQL
injection. (The earlier 6.0.3 probe base64-encoded bodies as a stopgap; see
FINDINGS.md.)

## Build & run

```sh
./build.sh                 # mint TLS cert (if absent), emit web/app.js, build backend
./build/yeo-cy-test        # start the server (HTTP :8080 + HTTPS :8443)
# open http://localhost:8080/   (or  https://localhost:8443/  — self-signed cert)
```

The HTTPS listener needs an Ed25519 cert+key (`cert.pem`/`key.pem`); `build.sh`
mints them via `./gen-certs.sh` if missing (both are gitignored).

Or step by step:

```sh
cyrius deps                                     # resolve patra + sakshi + stdlib
cyrius build --target=js web/app.tsx web/app.js # emit the frontend bundle
cyrius build src/main.cyr build/yeo-cy-test     # build the backend
```

```sh
# API smoke test
curl -s localhost:8080/api/health
curl -s -X POST localhost:8080/api/notes -d '{"body":"hello cyrius"}'
curl -s localhost:8080/api/notes
```

## Test

```sh
tests/run.sh        # build + unit invariants + 34 backend e2e + 10 full-stack UI e2e
```

`tests/verify.py` (backend, HTTP+HTTPS) and `tests/ui_check.mjs` (drives the
emitted frontend against the backend) each start/stop their own server.

## Layout

```
src/main.cyr     — handlers, route registration, patra CRUD, dual HTTP+HTTPS serve
src/httpd.cyr    — JSON/file response helpers + body accessors over sandhi's server
src/test.cyr     — Cyrius unit invariants (patra bound-text, sandhi route_match)
tests/verify.py  — 34-scenario backend e2e harness (HTTP + HTTPS; run vs a built binary)
tests/ui_check.mjs — headless full-stack UI e2e (drives the emitted app.js vs the backend)
tests/run.sh     — one command: build + unit + 34 backend + 10 UI
gen-certs.sh     — mint the self-signed Ed25519 cert+key for HTTPS (gitignored)
web/app.tsx      — typed frontend, single source of truth
web/app.js       — served browser bundle (generated from app.tsx by cyrius)
web/index.html   — page shell
build.sh         — frontend emit + backend build
FINDINGS.md      — Cyrius / patra / sandhi viability findings (the real deliverable)
```

## Status

Backend, storage, **and frontend build** are viable on Cyrius today (re-run on
**cyrius 6.3.42 / patra 1.12.7 / sandhi 1.7.0 / sigil 3.9.9 / sakshi 2.4.3**;
regenerate `lib/` with `cyrius lib sync --full`). Both original blockers — TS/TSX→JS
emit and patra SQL string safety — are closed, and the probe is a thin sandhi +
patra composition (server-side TLS + ALPN, retired hand-rolled HTTPS stack).

**Both residuals shipped — and both were consumer MISDIAGNOSES, which is the point
of the probe.** The "string-literal-global-at-scale" crash was really a **symbol
collision** (`var DB_PATH` shadowed patra's `enum DbOff { DB_PATH }`) — fixed in
cyrius 6.3.24 (now a hard error); the fix here is just renaming the global, so the
`db_path()` fn workaround is gone. The multi-worker-TLS `RECORD_LAYER_FAILURE` was a
**thread-local slot-0 collision** between sigil's crypto banks and patra's parse
scratch — fixed in sigil 3.9.9 (slot 0→8, cyrius 6.3.25); the TLS pool is now
`max_conns=4` (verify.py 5/5, amplified stress 0-error). (Earlier bumps resolved
`str_builder` array-local codegen, patra's table-cache race, both sandhi findings,
and sigil's concurrent-handshake crash.) **One lock stays, now correctly
attributed:** 🔴 patra's TEXT/BLOB readback reads pages *after* the query drops its
flock, so `g_db_lock` is kept to hold SELECT+readback atomic (filed to patra). The
suite is **green + stable** (34 backend + 10 UI, max_conns=4). Details in
[FINDINGS.md](FINDINGS.md); each finding is filed in its repo's
`docs/development/issues/`.

## License

AGPL-3.0-only (matches the parent SecureYeoman repository).
