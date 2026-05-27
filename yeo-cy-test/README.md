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
- **Frontend** — `web/app.tsx` is the typed source of truth (validated by
  `cycc --parse-ts`). `web/app.js` is the browser-runnable bundle served to
  clients. See FINDINGS.md for why these are currently two files.

Note bodies are base64-encoded before storage to sidestep patra's lack of SQL
string escaping (FINDINGS.md §patra), so arbitrary text — apostrophes, unicode —
round-trips correctly.

## Build & run

```sh
./build.sh                 # validate frontend TS/TSX with cyrius, build backend
./build/yeo-cy-test        # start the server
# open http://localhost:8080/
```

Or step by step:

```sh
cyrius deps                                     # resolve patra + sakshi + stdlib
cycc --parse-ts web/app.tsx </dev/null          # validate the frontend (build gate)
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
web/app.tsx      — typed frontend source (cyrius-validated)
web/app.js       — served browser bundle (hand-lowered from app.tsx)
web/index.html   — page shell
build.sh         — frontend validate + backend build
FINDINGS.md      — Cyrius / patra viability findings (the real deliverable)
```

## Status

Backend + storage are viable on Cyrius today. The frontend can be **validated**
by cyrius but not yet **emitted** to JS — that codegen stage is the one blocker
for "build the TS/TSX frontend just by cyrius." Details and priorities in
[FINDINGS.md](FINDINGS.md).

## License

AGPL-3.0-only (matches the parent SecureYeoman repository).
