# yeo-cy-test

A thin full-stack slice that proves out **[Cyrius](https://github.com/MacCracken/cyrius)**
as the target language for the eventual SecureYeoman port: a Cyrius backend
server with SQL persistence and a TS/TSX frontend, exercising the basic
functionality SecureYeoman relies on.

Purpose: de-risk "rewrite SecureYeoman in Cyrius" by building the smallest
end-to-end thing that touches every layer of the future stack, and recording
where Cyrius needs work. **All findings are in [FINDINGS.md](FINDINGS.md).**

## What it is

- **Backend** — a Cyrius HTTP/1.1 server on `:8080` built directly over the
  `net.cyr` TCP stack (no framework). Routes:
  - `GET  /`            → serves the frontend (`web/index.html`)
  - `GET  /app.js`      → serves the frontend bundle
  - `GET  /api/health`  → `{ "status": "ok", … }`
  - `GET  /api/notes`   → list notes (JSON array)
  - `POST /api/notes`   → create a note from `{ "body": "…" }`
- **Storage** — [patra](https://github.com/MacCracken/patra), the sovereign
  Cyrius SQL database. Notes persist to `yeo.patra` and survive restarts.
- **Frontend** — `web/app.tsx` is the typed source of truth. `web/app.js` is
  **generated** from it by `cyrius build --target=js` (the cyrius 6.1.11+
  TS/TSX→JS + JSX emitter); do not hand-edit `app.js`.

Note bodies are stored in a patra `TEXT` column via a prepared statement with a
bound `?` parameter (`patra_bind_text`, patra 1.10.3), so arbitrary text —
apostrophes, quotes, unicode, any length — round-trips safely with no SQL
injection. (The earlier 6.0.3 probe base64-encoded bodies as a stopgap; see
FINDINGS.md.)

## Build & run

```sh
./build.sh                 # emit web/app.js from app.tsx, build backend
./build/yeo-cy-test        # start the server
# open http://localhost:8080/
```

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

## Layout

```
src/main.cyr     — the whole backend (server loop, routing, JSON, patra CRUD)
web/app.tsx      — typed frontend, single source of truth
web/app.js       — served browser bundle (generated from app.tsx by cyrius)
web/index.html   — page shell
build.sh         — frontend emit + backend build
FINDINGS.md      — Cyrius / patra viability findings (the real deliverable)
```

## Status

Backend, storage, **and frontend build** are viable on Cyrius today (re-run on
cyrius 6.1.14 / patra 1.10.3 / sakshi 2.2.6). Both original blockers — TS/TSX→JS
emit and patra SQL string safety — are now closed; cyrius builds the whole
slice. Remaining items (incl. an `async`+nested-arrow emit bug) are in
[FINDINGS.md](FINDINGS.md).

## License

AGPL-3.0-only (matches the parent SecureYeoman repository).
