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
  ALPN `http/1.1`) — the probe's hand-rolled HTTPS stack is retired. sandhi is now
  pulled as the thin `server` **profile bundle** (`dist/sandhi-server.cyr`, ~76 %
  smaller than the full folded bundle). The TLS pool runs **4 workers**
  (`max_conns=4`, matching plaintext): the multi-worker-TLS blocker — a sigil⇄patra
  thread-local slot-0 collision that corrupted handshakes (`RECORD_LAYER_FAILURE`) —
  was fixed in sigil 3.9.9 (cyrius 6.3.25); see FINDINGS.
  Routes:
  - `GET  /`                → serves the frontend (`web/index.html`)
  - `GET  /app.js`          → serves the frontend bundle
  - `GET  /api/health`      → `{ "status": "ok", … }`
  - `GET  /api/audit`       → audit-chain status `{ entries, verified, head }`
  - `GET  /api/hwinfo`      → hardware-accelerator summary `{ device_count, gpu_count, … }`
  - `GET  /api/pubkey`      → server Ed25519 identity public key `{ alg, pubkey }`
  - `GET  /api/tee`         → key-sealing status `{ algorithm, sealed, key_source }`
  - `POST /api/login`       → issue an HS256 JWT for `{ "password": "…" }`
  - `GET  /api/me`          → Bearer-protected; returns the authenticated `{ sub, role }`
  - `GET  /api/admin`       → RBAC-gated (`role=admin`); 200 / 403 / 401
  - `GET  /api/notes`       → list notes (JSON array) — **public**
  - `POST /api/notes`       → create a note from `{ "body": "…" }` — **auth required**
  - `GET|PUT|DELETE /api/notes/:id` → fetch (public) / replace (auth) / delete (**admin**) one note
- **Storage** — [patra](https://github.com/MacCracken/patra), the sovereign
  Cyrius SQL database. Notes persist to `yeo.patra` (ids via patra
  `AUTOINCREMENT`) and survive restarts.
- **Audit** — [libro](https://github.com/MacCracken/libro), a SHA-256 hash-linked,
  tamper-evident audit chain, **persisted via libro's patra-backed `patrastore`**
  (`yeo-audit.patra`). The **first `sy-core` module ported into the probe**
  (sy-core's `audit`): every note mutation appends a linked entry, `GET /api/audit`
  reports the on-disk chain's live `verified` status, and **the log survives a
  restart** (the head is reconstructed so the chain stays linked across the boundary).
  Now stores arbitrary content safely — the single-quote corruption that gated this
  was fixed upstream (patra 1.12.10 + libro 2.8.1) after the probe filed it.
- **Hardware probe** — [ai-hwaccel](https://github.com/MacCracken/ai-hwaccel),
  accelerator detection. The **second `sy-core` module ported** (sy-core's `hwprobe`,
  itself a thin wrapper over ai_hwaccel): detected once at startup with **no
  subprocess spawning** (`registry_detect_no_exec`), served at `GET /api/hwinfo`.
- **Crypto** — [sigil](https://github.com/MacCracken/sigil) server-side (beyond TLS).
  The **third `sy-core` module ported** (sy-core's `crypto`): a server Ed25519
  identity keypair (**persisted** as a 0600 seed, stable across restarts) published at
  `GET /api/pubkey`, used to **sign the audit chain head** (`head_sig` on
  `GET /api/audit`) — server authenticity on top of libro's tamper-evidence,
  independently verified against OpenSSL Ed25519.
- **Auth** — JWT sessions + RBAC (sy-core's `auth`). **The fourth module ported.**
  `POST /api/login` issues a signed **HS256 JWT** with `sub`/`role` claims (HMAC-SHA256
  via sigil, building on crypto); `GET /api/me` is **Bearer-protected** (signature +
  `exp` enforced); `GET /api/admin` is **role-gated** (`role=admin`), separating **401**
  (unauthenticated) from **403** (wrong role). The token is a standard RFC 7519 JWT,
  independently decoded/validated in the tests. The HMAC secret and the Ed25519
  identity are **persisted at rest (0600)**, so tokens and the server identity survive
  a restart. (bote — the mapped JWT lib — is verify-only, so issuance is built from
  primitives; see FINDINGS.) **The RBAC is now enforced on the note resource** (below),
  not just the demo `/api/admin` route.
- **RBAC-enforced writes** — the `auth` gate applied to `/api/notes`: **reads are
  public**, but `POST`/`PUT` require an authenticated session and **`DELETE` requires
  `role=admin`** (401 unauthenticated vs 403 wrong-role, on the real mutation). The
  frontend gained a **sign-in flow** (`#/login`, in-memory JWT) and is **RBAC-aware**
  (the add form shows only when signed in, the delete control only for admins) — with the
  backend as the authority. Used only existing auth primitives, so **no new lib gap**.
- **Key sealing** — [sigil](https://github.com/MacCracken/sigil) AES-256-GCM. **The
  fifth `sy-core` module ported** (sy-core's `tee`): the persisted key files are
  **AES-256-GCM sealed** at rest (60-byte `[IV|ct|tag]` blobs, not raw keys), under an
  HKDF KEK from `SY_SEAL_KEY`. `GET /api/tee` reports the status. (Porting it surfaced a
  sigil DX finding — inconsistent success-return conventions across its crypto fns; see
  FINDINGS.)
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
curl -s localhost:8080/api/notes                                    # reads are public
# writes are RBAC-gated — sign in for a JWT, then send it as a Bearer token:
TOKEN=$(curl -s -X POST localhost:8080/api/login -d '{"password":"changeme"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST localhost:8080/api/notes -H "Authorization: Bearer $TOKEN" -d '{"body":"hello cyrius"}'
```

## Test

```sh
tests/run.sh        # build + unit invariants + 46 backend e2e + 13 full-stack UI e2e
```

`tests/verify.py` (backend, HTTP+HTTPS) and `tests/ui_check.mjs` (drives the
emitted frontend against the backend) each start/stop their own server.

## Layout

```
src/main.cyr     — handlers, route registration, patra CRUD, tee+crypto+auth+audit+hwprobe wiring, dual HTTP+HTTPS serve
src/httpd.cyr    — JSON/file response helpers + body accessors over sandhi's server
src/audit.cyr    — sy-core `audit` module → libro patrastore (persistent hash-linked audit chain; GET /api/audit)
src/hwprobe.cyr  — sy-core `hwprobe` module → ai-hwaccel (accelerator detection; GET /api/hwinfo)
src/crypto.cyr   — sy-core `crypto` module → sigil (Ed25519 keypair/sign; GET /api/pubkey + audit head_sig)
src/tee.cyr      — sy-core `tee` module → sigil AES-256-GCM key sealing (GET /api/tee; seals the *.key files)
src/auth.cyr     — sy-core `auth` module → JWT sessions + RBAC (HS256 login; /api/me, /api/admin; gates /api/notes writes)
src/test.cyr     — Cyrius unit invariants (patra bound-text, sandhi route_match, libro audit, ai-hwaccel, sigil crypto, auth JWT)
tests/verify.py  — 46-scenario backend e2e harness (HTTP + HTTPS; run vs a built binary)
tests/ui_check.mjs — headless full-stack UI e2e (13 scenarios; drives the emitted app.js incl. sign-in vs the backend)
tests/run.sh     — one command: build + unit + 46 backend + 13 UI
gen-certs.sh     — mint the self-signed Ed25519 cert+key for HTTPS (gitignored)
web/app.tsx      — typed frontend, single source of truth
web/app.js       — served browser bundle (generated from app.tsx by cyrius)
web/index.html   — page shell
build.sh         — frontend emit + backend build
FINDINGS.md      — Cyrius / patra / sandhi viability findings (the real deliverable)
```

## Status

Backend, storage, **and frontend build** are viable on Cyrius today (re-run on
**cyrius 6.4.62 / patra 1.12.10 / libro 2.8.1 / sandhi 1.8.2 (thin `server` profile
bundle) / sigil 3.11.1 / sakshi 2.4.6**; regenerate `lib/` with `cyrius lib sync
--full` + `cyrius deps`). Both original blockers — TS/TSX→JS emit and patra SQL string safety — are
closed, and the probe is a thin sandhi + patra composition (server-side TLS + ALPN,
retired hand-rolled HTTPS stack).

**Zero residual workarounds — the probe now runs fully lock-free.** `g_db_lock` is
gone: patra **1.12.8**'s `_rs_materialize` snapshots TEXT/BLOB payloads into owned
heap *under the query's shared flock*, so `patra_result_read_text` is a pure memcpy
safe against concurrent writers — closing the last race that required a lock (folded
into patra **1.12.9**, adopted here). Handlers call `db()` (each worker's own patra
handle) directly; reads run fully in parallel — new scenario 11 proves it (310 reads
under concurrent writes → 0 torn). sandhi is now consumed as its thin `server`
**profile bundle** (the "bundled-libs → individual-packages split" this probe filed,
dogfooded as its first consumer). (Earlier bumps resolved: the `DB_PATH` enum-shadow
collision → `g_dbpath` rename; the multi-worker-TLS slot-0 collision → `max_conns` 4;
`str_builder`/array-local codegen; patra's table-cache race; both sandhi findings;
sigil's concurrent-handshake crash.) No new findings this cycle.

**Now growing into the real port. Five `sy-core` modules are ported in:** **`audit` →
[libro](https://github.com/MacCracken/libro)** (a **persistent** hash-linked audit
chain via libro's `patrastore` — survives a restart, holds under full concurrency),
**`hwprobe` → [ai-hwaccel](https://github.com/MacCracken/ai-hwaccel)** (accelerator
detection at `GET /api/hwinfo`, no subprocess spawning), **`crypto` →
[sigil](https://github.com/MacCracken/sigil)** (server Ed25519 identity at
`GET /api/pubkey`, signing the audit head — verified against OpenSSL Ed25519),
**`auth`** (JWT sessions + RBAC — `POST /api/login` issues an HS256 JWT via sigil HMAC,
`GET /api/me` is Bearer-protected, `GET /api/admin` is role-gated; standard RFC 7519
token), and **`tee`** (AES-256-GCM sealing of the persisted key files — surfacing a
sigil DX finding on inconsistent return conventions). **The `auth` RBAC is now enforced
on the note resource** — reads public, `POST`/`PUT` require a session, `DELETE` requires
admin — with a sign-in flow + RBAC-aware controls in the frontend. Making audit durable
meant closing a real corruption the probe hit three times — a single quote in a value
silently dropped the audit record — **fixed upstream and adopted here: patra 1.12.10**
(standard `''` escaping + `patra_quote_str`) **and libro 2.8.1** (bound INSERT in
`patrastore_append`), both driven by this probe. The suite is **green + stable** (8
unit + **46 backend** + 13 UI, max_conns=4). Details in [FINDINGS.md](FINDINGS.md);
each finding is filed in its repo's `docs/development/issues/`.

## License

AGPL-3.0-only (matches the parent SecureYeoman repository).
