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
  is pinned to 1 worker because sigil's crypto scratch crashes on concurrent
  handshakes (see FINDINGS). Routes:
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
**cyrius 6.3.0 / patra 1.12.6 / sandhi 1.6.13 / sakshi 2.4.0**). Both original
blockers — TS/TSX→JS emit and patra SQL string safety — are closed, and **every
finding this probe filed against the ecosystem has shipped upstream and been
adopted** — including, this bite, **sandhi server-side TLS + ALPN** (so the
hand-rolled HTTPS stack is retired): the probe is now a thin sandhi + patra
composition. The bite also surfaced a **new 🔴**: sigil's crypto scratch is
process-global, so concurrent TLS handshakes crash the server (the TLS pool is
pinned to 1 worker until it's thread-safe). Open items + adoption caveats are in
[FINDINGS.md](FINDINGS.md).

## License

AGPL-3.0-only (matches the parent SecureYeoman repository).
