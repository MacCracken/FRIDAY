# yeo-cy-test — Current State

> Refreshed every release. CLAUDE.md is preferences/process/procedures
> (durable); this file is **state** (volatile).

## Version

**0.1.0** — full-stack slice working end to end. Re-run on **cyrius 6.4.64 /
patra 1.12.10 / libro 2.8.1 / sandhi 1.9.0 (thin `server` profile bundle) / sigil
3.12.0 (via cyrius) / sakshi 2.4.6** (2026-07-14; regenerate `lib/` with `cyrius lib sync
--full` + `cyrius deps` — see Toolchain note). Serves **HTTP (:8080) and HTTPS
(:8443, TLS 1.3 + Ed25519)** off one sandhi router + handler set over the patra
backend, both at **`max_conns=4`**. Both original 🔴 blockers (TS/TSX→JS emit,
patra string safety) stay closed.

## Where the port actually stands (measured 2026-07-14)

> Read this before the module narratives below. They describe *seams exercised*, not
> progress toward a finished port, and the wording used to imply otherwise.

| | measured |
|---|---|
| Probe module code | **879 LOC** (8 `.cyr`, incl. tests/demo) |
| Real target — `sy-core` | **60,425 LOC**, 243 `.rs`, 22 module dirs |
| **Port written** | **~1.5%** |
| Routes mapping to real sy-core endpoints | **2 of the probe's 15**; 15 of sy-core's 540 = **2.8%** |
| TypeScript still to be superseded | 745,584 LOC (dashboard stays React behind the API — roadmap Phase 8) |

**The five "ported" modules are thin slices, not ports (16–23% fidelity).**
- **`tee` ≈ 0%** — sy-core seals under `KeySource{Tpm,Sgx,Keyring}`; the probe has one HKDF
  KEK from an env var, falling back to `INSECURE-DEV-KEY…`, which is how the tests run.
- **`auth`** — 541 LOC / 3 routes vs **3,396 LOC / 40 routes**; RBAC is `_role_is()` string
  equality against a 5-role wildcard matrix; one hardcoded credential, no user store.
- **`crypto`** — ~4 of 13 public fns; X25519/DH absent entirely.
- **`audit`** — the only fair 1:1, at ~20%.
- **`notes` is invented scaffolding**: it appears in 2 of 243 `.rs` files as a
  `notes: Option<String>` *column*, yet owns 5 routes and the whole frontend.

**What breaks first in a real port — the schema.** Zero `.sql` and no `sqlx::migrate!` in
`crates/`; the authoritative **208 `CREATE TABLE` / 7,845 LOC** migration set lives in
`packages/core/src/storage/migrations/` — the package the roadmap deletes *in the same
clause as the Cyrius port*. Day one you cannot create the database. Behind it, patra has
**3 column types**, no `ON CONFLICT` (sy-core uses 14) and no parsed `RETURNING`
(sy-core: 157). *(Non-issue, checked: "patra has no JOIN" — sy-core's db layer has 2 JOINs
and 1 GROUP BY. Not a blocker.)*

**`brain` — the actual product — has no target.** `mneme` / `hoosh` / `daimon` ship **0**
dist bundles: they are applications, not libs, so the `modules=["dist/*.cyr"]` pattern every
ported module relied on does not exist for them. WebAuthn / OIDC / PKCE have **zero**
implementations ecosystem-wide (only roadmap comments).

**Effort shape:** ~6% mechanical (sandbox→kavach, privacy, types, ecosystem, finishing the
four in flight); **~88% blocked on ecosystem construction, not porting**; the rest out of
scope. Blocked ≠ unsolved: `majra/src/postgres_backend.cyr` is a real Postgres wire client
(300 LOC, ~5% of sqlx — cleartext auth, no bound params, no TLS, no pooling). Extending it
is known-shape protocol work — engineering, not research.

**What is genuinely proven** (and is what a probe is for): the stack carries a real HTTPS
service with sealed keys at rest, Argon2id at sy-core's exact params, a hash-linked audit
chain, 401/403 separation and per-IP rate limiting — 70 tests, zero residual workarounds.
And the **feedback loop works**: ~29 findings filed → shipped → adopted (patra 1.12.10,
libro 2.8.1, sigil 3.9.9/3.12.0, sandhi 1.9.0, cyrius 6.4.63/6.4.64), all three original
🔴 blockers closed, gaps closing in one cycle.

**Highest-leverage next moves** (not the auth thread this cycle followed):
1. **Land the Postgres client** (SCRAM + extended query protocol + TLS + pooling in majra)
   and give the 208-table schema a Rust home — unblocks ~69%.
2. **`[lib]` surfaces on mneme/hoosh/daimon** — until then `brain`/`orchestration` have
   nothing to port onto.
3. Keep filing gaps **from the source, not the docs** — three filings this cycle
   ("no Argon2", "memory-amplifying DoS", "no TEE/TPM API") all read worse than reality.

**Caveat on this file's own history:** an earlier revision of README/state claimed the probe
was "growing into the real port"; the module narratives below were written in that register.
The numbers above supersede them.

**Zero residual workarounds — the probe now runs lock-free:**

- ✅ **`g_db_lock` REMOVED (patra 1.12.9).** Its last remaining job was holding each
  SELECT + its TEXT readback atomic against a concurrent writer: `patra_query` used
  to release its shared flock before `patra_result_read_text` lazily read the payload
  pages, so a writer on another handle could free/overwrite them mid-read (torn body
  returned as `PATRA_OK`). patra **1.12.8**'s `_rs_materialize` snapshots every
  TEXT/BYTES payload into an owned heap buffer *while the query's shared flock is
  held*, so `read_text`/`read_bytes` are pure memcpys — safe against any later
  writer. Folded into patra **1.12.9** and adopted here: handlers call `db()` (this
  worker's own handle) directly, no mutex. patra's connection-per-thread "lock-free
  parallel reads" promise is finally delivered for **TEXT** columns too (was
  fixed-width only). New scenario 11 proves it: 310 reads during concurrent writes,
  **0 torn/garbled**.
- ✅ **Adopted sandhi's thin `server` profile bundle (sandhi 1.8.0 → 1.8.2).** sandhi
  is no longer the folded-stdlib monolith; it's pulled as `dist/sandhi-server.cyr`
  (**141 KB vs the full 590 KB folded bundle, ~76 % smaller**) via `[deps.sandhi]` —
  the **"bundled-libs → individual-packages split" this probe filed**, now shipped
  and **dogfooded here as sandhi's first profile-bundle consumer**. sandhi 1.8.1 made
  `run_pooled_tls` safe at `max_conns>1`; the TLS pool stays at 4.
- (Prior cycles resolved: the enum-shadow `DB_PATH` collision → `g_dbpath` rename
  (cyrius 6.3.24); the sigil⇄patra slot-0 collision → TLS `max_conns` 1→4 (sigil
  3.9.9 / cyrius 6.3.25); `str_builder`/array-local codegen (6.3.15); patra
  table-cache (1.12.7); both sandhi findings; sigil's concurrent-handshake crash.)

One new finding this cycle, **filed and already shipped**: 🟠 a stale `lib/` silently
shadowed the pinned snapshot, hiding sigil's 3.9.9 slot-0 fix for three minor versions.
Filed to cyrius → **fixed in 6.4.63**, which now emits a *warning* naming the exact skew
(`sigil 3.11.1 (pinned: 3.12.0), mabda 4.0.2 (pinned: 4.0.5)`) instead of a silent note —
and that immediately caught a second stale bundle (mabda) the probe had not noticed.
`lib/` is re-synced to sigil **3.12.0**. Every previously-filed ecosystem finding is
shipped and adopted. See [`../../FINDINGS.md`](../../FINDINGS.md) and each repo's
`docs/development/issues/`.

**First `sy-core` module grown into the probe: `audit` → libro (PERSISTENT).** The
probe is now evolving from a pure viability slice toward the real SecureYeoman →
Cyrius port. The first module ported is `sy-core`'s **audit** (an append-only,
hash-linked crypto audit log) onto **libro** (v2.8.1) — a near-exact lib match. Every
note mutation (create/update/delete) appends a SHA-256 hash-linked entry to a
**patra-backed store** (libro `patrastore`, file `yeo-audit.patra`, separate from the
notes DB); `GET /api/audit` returns `{entries, verified, head, persistent}` and
re-verifies the **on-disk** chain each call. Appends serialize under `g_audit_lock`
— a hash chain is inherently serial, so one writer at a time is correct, not a
workaround. **Durable:** the log survives a restart — `audit_init` reconstructs the
head hash from the on-disk entries so appends after a restart link onto the existing
chain and the whole chain still verifies (scenario 12c). **Connection-per-thread**
(TLS slot 14, like the notes `db()`): patra handles must be used on the thread that
opened them, so each worker opens its own audit handle. Verified under full
concurrency (250 + 60 concurrent appends → chain verifies) and across a restart.
Now safe to store **arbitrary content** (quotes/injection/unicode) — the underlying
libro `patrastore_append` uses a bound INSERT (libro 2.8.1) and patra escapes `''`
(1.12.10); see the quote-corruption fix note below and FINDINGS.

**Second module: `hwprobe` → ai-hwaccel.** sy-core's `hwprobe` is "a thin wrapper
around `ai_hwaccel`" (hardware-accelerator detection); its Cyrius target,
**ai-hwaccel** (v2.3.14), is *already* Cyrius, so the port is thin. `src/hwprobe.cyr`
runs `registry_detect_no_exec()` **once at startup** (detection via /sys + /proc, no
subprocess spawning — no per-request fork/exec, no command-injection surface) and
caches the summary JSON; **`GET /api/hwinfo`** serves it. On this host it reports
`{device_count, has_accelerator, total_memory_bytes, accelerator_memory_bytes,
gpu_count, tpu_count, npu_count, warnings}` — e.g. 2 devices / 1 GPU / ~64 GB. The
cached string is immutable, so all workers serve it lock-free.

**Third module: `crypto` → sigil (first server-side sigil use beyond TLS).** sy-core's
`crypto` is the primitive layer (AES-GCM/X25519/Ed25519/SHA-2/HMAC/HKDF) audit/auth/tee
lean on; its Cyrius target is **sigil** (already linked here for TLS). `src/crypto.cyr`
generates a server **Ed25519 identity keypair** at startup (`ed25519_generate_keypair`,
read-only after → signing is thread-safe), exposes it at **`GET /api/pubkey`**
(`{alg, pubkey}`), and **signs the audit chain head** (`head_sig` on `GET /api/audit`)
so a client can verify the log is authentically from this server — authenticity on top
of libro's tamper-evidence. **Independently cross-checked:** Python's `cryptography`
(OpenSSL Ed25519) verifies `head_sig` against `/api/pubkey` (scenario 14) — sigil's
server signature interoperates with a standard impl. Unit invariant adds a SHA-256
known-answer (RFC 6234) for impl-independent correctness. The identity key is now
**persistent**: `crypto_init` loads a 32-byte Ed25519 **seed** from `yeo-identity.key`
and re-derives the keypair, so the pubkey + signed audit head stay stable across
restarts. The seed is **AES-256-GCM sealed** at rest (the `tee` module — see below);
the remaining hardening is a hardware-backed KEK — sigil DOES ship TPM/SGX sealing, but
via tpm2-tools exec, the surface this probe avoids (corrected filing; see FINDINGS).

**Fourth module: `auth` → JWT sessions + RBAC.** sy-core's `auth` is the defining
SecureYeoman capability (JWT + API keys + RBAC + OIDC/PKCE + WebAuthn). Landed so far:
**`POST /api/login`** checks a credential and **issues a signed HS256 JWT** (HS256 =
HMAC-SHA256 via sigil — building on the crypto module) with `sub`/`role` claims (two
demo credentials → `admin` / `user`); **`GET /api/me`** is **Bearer-protected** — it
recomputes + constant-time compares the signature, decodes the payload, enforces
`exp`, and returns `{sub, role}`; **`GET /api/admin`** is **RBAC-gated** (`role=admin`
required) — cleanly distinguishing **401** (no/invalid token) from **403** (valid
token, wrong role): authentication vs authorization. `src/auth.cyr` is stateless
(read-only HMAC secret → thread-safe, no lock). **Independently cross-checked:** the
issued token decodes as a standard RFC 7519 JWT (alg/typ + sub/role/iat/exp) in Python
(scenario 15). **Findings:** the mapping's target **bote** is JWT **verify-only** (an
MCP resource server — no issue path) with no thin jwt profile, so issuance is built
from primitives (to file); password hashing was a gap (a plaintext compare) — **now
CLOSED**: **sigil 3.12.0 ships native Argon2id** (RFC 9106) — driven by this probe — and
`_auth_pw_ok` re-derives Argon2id at sy-core's m=19456/t=2/p=1 and constant-time compares
the tag (~244 ms, ~19 MiB per login; per-thread arena via `argon2id_into`); and
**bayan's `base64url_decode` returned null** on a valid
no-pad round-trip in-probe (worked around with an in-probe decoder — root cause
unconfirmed, flagged). The HMAC secret is now **persistent** (`yeo-auth.key`, 0600) so
tokens survive a restart. The RBAC is now **enforced on the note resource** (below).
`/api/login` has **two layers of abuse control**, both shedding 429 *before* any Argon2
work. (1) A **per-IP token bucket** (5/min, burst 5; `SY_LOGIN_BURST` /
`SY_LOGIN_REFILL_MS`), on a fixed 64-slot LRU table so the limiter can't itself be turned
into a memory vector by address spraying. (2) An **admission cap** of 2 concurrent
derivations, bounding the 4-worker pool even across many sources. Argon2id's ~244 ms had
made login a request-amplification lever (measured: `/api/health` 6 ms → 942 ms at 8
concurrent; ~40 wedged the server); now 40 concurrent settle in 0.5 s with `/api/health` at
1 ms (scenario 20), and one source is capped at its bucket (scenario 21: at burst=3,
127.0.0.1 gets 3 then 429 while **127.0.0.2 keeps its own budget** — the per-IP proof). The
per-IP half exists because the probe filed the gap: **sandhi 1.9.0**'s
`sandhi_server_conn_peer_ip` (folded in cyrius 6.4.64). Unknown peers (ip==0, e.g. AGNOS)
**fail open** by design — keying them all to one bucket would let one client lock out
everyone — and still face the concurrency cap. Limitations (future bites): no per-*subject*
lockout/backoff (keyed by address only); PKCE/OIDC/WebAuthn.

**Persistent keys (both crypto + auth), SEALED at rest.** `crypto_key_load`/
`crypto_key_save` (`src/crypto.cyr`) seal 32-byte key material with **AES-256-GCM**
(via the `tee` module) and write it owner-only (0600) — on disk each `*.key` is a
60-byte `[12 IV | 32 key | 16 tag]` blob, never the raw key. The auth HS256 secret
(`yeo-auth.key`) and the crypto Ed25519 seed (`yeo-identity.key`) load-or-generate at
init, so a restart keeps issued JWTs valid and the server identity stable (scenario 17:
pre-restart token still verifies, pubkey unchanged; scenario 18: files are sealed). Both
`*.key` gitignored.

**Fifth module: `tee` → AES-256-GCM key sealing.** sy-core's `tee` seals secrets with
AES-256-GCM under a hardware-backed key. `src/tee.cyr` ports the sealing onto **sigil**
(AES-256-GCM + HKDF): `tee_seal(pt, n)` → `[12 random IV | ct | 16 tag]` under a KEK
derived by HKDF from **`SY_SEAL_KEY`** (fixed insecure **dev key** fallback + warning if
unset/empty); `tee_unseal` decrypt-verifies and returns the plaintext or 0. `GET
/api/tee` reports `{algorithm, sealed, key_source, dev_key}`. Sealing works cleanly on
the bundled sigil (3.9.8 at the time; now 3.11.1 — encrypt is NIST-correct, decrypt
authenticates). **🟡
Finding (DX): sigil's return conventions are inconsistent** — `aes_gcm_decrypt` returns
`SIGIL_ERR_NONE == 0` on **success**, but `ed25519_verify` returns `1` on success. That
footgun briefly made me mis-record a "sigil bug" + build an unnecessary workaround; an
adversarial review + re-measurement corrected it (no bug — `rc==0` is success). Gap: no
hardware-backed KEK (sigil has TPM/SGX sealing but shells out to tpm2-tools — an exec
  surface the probe avoids; the original "no TEE API" filing was too strong). See FINDINGS.

**RBAC enforcement on note writes.** The `auth` module's JWT/RBAC is now applied to the
live `/api/notes` resource, not just the demo `/api/admin` route: `POST`/`PUT` require an
authenticated session (any role), `DELETE` requires **`role=admin`**, and `GET`
list/detail stay **public** (reads open, writes gated). A small guard
(`auth_req_claims`/`auth_req_role` in `src/auth.cyr`) verifies the Bearer token at the top
of each mutation handler — 401 (unauthenticated) vs 403 (authenticated, non-admin) split,
mirroring `handle_admin`. The **frontend** (`web/app.tsx`) gained a real sign-in flow
(`#/login` → `/api/login`, in-memory JWT, role via `/api/me`, `Authorization: Bearer` on
writes) and is **RBAC-aware** (add form only when signed in; delete control only for
admins) — the backend stays the authority. Scenario 19 asserts the full write matrix;
scenario 0 bootstraps an admin token so `req`/`https_req` authenticate transparently. **No
new lib gap** — used only existing auth primitives (the stack was already sufficient).

**9 unit invariants** + **48 backend scenarios** + **13 UI** pass — **green + stable** at
`max_conns=4`. `tests/concurrency_repro.sh` is a 0/300 regression guard.

## Toolchain

- **Cyrius pin**: `6.4.64` (in `cyrius.cyml [package].cyrius`); folds sigil **3.12.0**
  (the native Argon2id this probe drove). NB `lib/` had silently drifted to sigil 3.9.8
  (pre the 3.9.9 slot-0 fix, colliding with patra's thread-local slot 0) until re-synced
  2026-07-14; 6.4.63's shadow-lib **warning** now names any such skew — see FINDINGS.
  patra `1.12.9`, **sandhi `1.8.2`** (the thin `dist/sandhi-server.cyr` **profile
  bundle**, no longer the folded stdlib), and sakshi `2.4.6` pinned via `[deps.*]`.
  Because the thin bundle carries only session_cache + conn + server/mod, the deps it
  used to pull transitively are now **declared explicitly** in `[deps].stdlib`:
  **`bayan`** (the probe's `json_v_*` build/parse — NOT `json`, which collides with
  bayan on `json_v_*`/`_jv_*`/`_jp_*`) and **`hashmap`** (`map_*`, used by sandhi's
  TLS session cache). `tls` still pulls sigil transitively (→ `pem_decode_certs`,
  crypto), independent of sandhi. (Keep the pin matched to the installed cycc to
  silence the toolchain-drift warning; cycc auto-drifts same-day.)
- `lib/` is untracked + gitignored; regenerate with **`cyrius lib sync --full`** +
  `cyrius deps`. **Use `--full`, not bare `cyrius lib sync`** — the bare form only
  refreshes the *declared* `[deps].stdlib` subset, so transitively-pulled deps like
  **sigil** (via `tls`/sandhi) are NOT updated and can silently stay stale. This
  bit the probe: a bare sync left `lib/sigil.cyr` at 3.9.4 (the pre-fix opt-in
  banking) while cyrius 6.3.12 actually bundles sigil 3.9.7 — so the probe built
  against the old crypto race and the TLS pool appeared to still crash. `--full`
  pulls the whole snapshot (current sigil 3.12.0). See FINDINGS.

## Source

- `src/httpd.cyr` — **thin response helpers + body accessors over sandhi**
  (~95 lines; the hand-rolled Conn seam / TLS accept loop / route table are
  retired now that sandhi ships server-side TLS). `resp_*(conn, …)` build a JSON/
  file response and delegate framing + transport to `sandhi_server_send_response_c`
  (sandhi's Conn seam handles plaintext `sock_send` vs chunked `tls_write`); the
  CORS header rides `extra_headers`. `_status_code`/`_status_msg` split the probe's
  "CODE Msg" status cstr for sandhi's separate code+msg params. `http_body_*`
  accessors read the body via `sandhi_server_body_offset`.
- `src/main.cyr` — handlers + route registration + patra persistence + dual serve.
  `include "src/httpd.cyr"`. Handlers take a **SandhiConn** (`fn(app_ctx, conn,
  req_buf, req_len, params)`): write via `resp_*(conn,…)`, body via `http_body_*`,
  path params via `sandhi_route_param_int`. Routes on **sandhi's router**
  (`sandhi_router_new`/`sandhi_router_add`). `main` loads the cert (DER leaf via
  `pem_decode_certs`) + key (PEM) into `sandhi_server_options_tls`, starts
  **plaintext `run_pooled` (4 workers, :8080) in a worker thread** via
  `sandhi_server_router_handler_cp` and the **HTTPS `run_pooled_tls` (:8443) in
  main** via `sandhi_server_router_handler_c`, sharing the read-only router.
  **The TLS pool runs 4 workers** (`max_conns=4`, matching plaintext) — the
  sigil⇄patra thread-local slot-0 collision that caused `RECORD_LAYER_FAILURE` was
  fixed in sigil 3.9.9 (slot 0→8, cyrius 6.3.25); verify.py is 5/5 clean at 4 and an
  amplified stress is 0-error at 4 and 8 (see FINDINGS).
  Endpoints: `GET /`, `GET /app.js`, `GET /api/health`, `GET /api/audit`,
  `GET /api/hwinfo`, `GET /api/pubkey`, `GET /api/tee`, `POST /api/login`, `GET /api/me`,
  `GET /api/admin` (RBAC), `GET|POST /api/notes`, `GET|PUT|DELETE /api/notes/:id`. Persistence: `TEXT` bodies via bound `?` params
  (injection-safe). Ids are patra `AUTOINCREMENT` (column-list `INSERT`, echoed via
  `last_insert_id`); `PUT`/`DELETE` 404 via `rows_affected`. Caveat (FINDINGS):
  AUTOINCREMENT reuses ids.
  - **Persistence model: connection-per-thread, lock-free.** `db()` opens one patra
    handle per worker, cached in a thread-local slot (TLS slot 15), so each worker
    reads/writes on a per-thread fd — patra's parallel-read model. The DB path is a
    plain global `var g_dbpath = "yeo.patra"` (renamed from the enum-colliding
    `DB_PATH` — see FINDINGS). **No `g_db_lock`.** patra 1.12.7 moved the table-lookup
    cache into the handle, and patra **1.12.9** (via 1.12.8's `_rs_materialize`)
    snapshots TEXT/BLOB payloads into owned heap under the query's shared flock, so
    `patra_result_read_text` is a pure memcpy — the last reason to hold a lock is
    gone. Writers serialize via patra's per-fd exclusive flock; reads run fully in
    parallel; `last_insert_id`/`rows_affected` are per-handle.
- `src/audit.cyr` — **the `sy-core` `audit` module, ported onto libro's persistent
  patrastore.** A SHA-256 hash-linked audit chain persisted to `yeo-audit.patra`
  (separate from the notes DB) via `patrastore_open`/`patrastore_append`/
  `patrastore_load_all` + `entry_new(…, prev_hash)` + `verify_chain`. `audit_init()`
  (main-thread) `ed25519_init`s, ensures the store, and reconstructs the head hash
  from the on-disk entries (restart continuity); `audit_store()` opens a **per-thread**
  handle (TLS slot 14 — patra is connection-per-thread, like `db()`); `audit_log(source,
  action, details)` links + persists one SEV_INFO entry under `g_audit_lock` (serial by
  nature) and advances the shared head; `audit_json()` re-verifies the on-disk chain
  and returns `{entries, verified, head, persistent}`. Wired into `handle_create/update/
  delete_note`, so every note mutation is durably recorded — surviving a restart
  (scenario 12c) and safe for arbitrary content (libro 2.8.1 bound INSERT / patra
  1.12.10 `''`).
- `src/crypto.cyr` — **the `sy-core` `crypto` module, ported onto sigil** (first
  server-side sigil use beyond TLS). `crypto_init()` (main-thread) generates a server
  Ed25519 keypair — `crypto_init` loads a persisted 32-byte **seed** (`yeo-identity.key`,
  0600) via `crypto_key_load`/`crypto_key_save` and `ed25519_keypair(seed, …)`, else
  generates + persists one (read-only after → sign is thread-safe).
  `crypto_pubkey_hex()`/`crypto_sign_hex()` wrap sigil's `hex_encode` (which returns a
  cstr) in `str_from`; `crypto_verify()` → `ed25519_verify` (1=ok). `handle_pubkey`
  serves `GET /api/pubkey` `{alg, pubkey}`; `audit_json` adds `head_sig` (Ed25519 over
  the head, under `g_audit_lock`). `crypto_key_load`/`crypto_key_save` are the shared
  0600 key-file I/O (also used by `auth`).
- `src/tee.cyr` — **the `sy-core` `tee` module: AES-256-GCM key sealing.** `tee_init`
  derives the KEK (HKDF from `SY_SEAL_KEY`, dev-key fallback). `tee_seal(pt, n)` →
  `[12 IV | ct | 16 tag]` (fresh random IV); `tee_unseal` decrypt-verifies (checking
  `aes_gcm_decrypt`'s `SIGIL_ERR_NONE == 0` = success convention — FINDINGS).
  `handle_tee` serves `GET /api/tee`. Included before `crypto` (which seals through it).
- `src/auth.cyr` — **the `sy-core` `auth` module (first bite: JWT sessions).**
  `auth_init()` makes a random HS256 HMAC secret. `auth_issue(sub, ttl)` builds a
  standard JWT — `base64url(header)."."base64url(payload)."."base64url(HMAC-SHA256(...))`
  via sigil `hmac_sha256` + bayan `base64url_encode` + `json_v_build`.
  `auth_verify_claims(token)` recomputes the HMAC, constant-time compares, decodes the
  payload (an in-probe `_b64u_decode` — bayan's `base64url_decode` misbehaved),
  enforces `exp`, and returns the claims obj (`auth_verify_sub` wraps it). Endpoints:
  `handle_login` (credential → `sub`/`role`), `handle_me`, and `handle_admin` (RBAC:
  `_role_is(role, "admin")` → 200 / 403). `_bearer_token` reads the token via
  `sandhi_server_find_header(…, "Authorization")`. A reusable request guard
  `auth_req_claims`/`auth_req_role` verifies the Bearer token for protected handlers; the
  `/api/notes` mutation handlers in `main.cyr` gate on it (POST/PUT → any authed role,
  DELETE → admin, reads public). Stateless → no lock. `auth_init` loads/persists the HMAC
  secret (`yeo-auth.key`, 0600) via `crypto_key_*` so tokens survive a restart.
- `src/hwprobe.cyr` — **the `sy-core` `hwprobe` module, ported onto ai-hwaccel.**
  `hwprobe_init()` (main-thread) calls `hwlog_init()` then
  `registry_detect_no_exec()` (no subprocess spawning) once, caching
  `registry_to_summary_json(r)` in `g_hwinfo` (an immutable `str`, served lock-free).
  `handle_hwinfo` serves it raw at `GET /api/hwinfo` via `resp_raw`.
- `web/app.tsx` — typed frontend, single source of truth: a SecureYeoman notes
  dashboard with a hash router exercising the **full** `/api/notes` resource —
  `#/` Home (live status + count + session), `#/notes` (list [public] + add [auth] +
  per-row delete [admin]), `#/notes/:id` (detail: GET by id, edit→PUT [auth],
  delete→DELETE [admin]), `#/login` (POST `/api/login` → in-memory JWT, role via
  `/api/me`), `#/logout`. Writes attach `Authorization: Bearer`; the UI is **RBAC-aware**
  (gates the add form / delete control to what the session may do) but the backend is the
  authority. JSX lowers to the emitter's `h()` runtime (text children → text nodes →
  XSS-safe; null/false children skipped, so the conditional controls render nothing).
- `web/app.js` — **generated** from `web/app.tsx` by `cyrius build --target=js`
  (do not hand-edit); `web/index.html` is a minimal mount + dashboard CSS.
- `build.sh` — emits `web/app.js` from the TSX (`--target=js` + `node --check`),
  then builds the backend.

## Tests

- `src/test.cyr` — eight invariants: (1) **patra bound-text** — a
  quote/injection/unicode body bound via `patra_bind_text` round-trips
  byte-for-byte through a `TEXT` column and leaves the table intact; (2)
  **sandhi `route_match`** — `:name` path-param capture, segment-count rules,
  and `sandhi_route_param_int` numeric parsing (a consumer-side regression guard
  on sandhi's matcher, which the `/api/notes/:id` resource depends on); (3)
  **libro audit chain** — `chain_append` builds a chain that `chain_verify`s and
  whose `chain_head_hash` advances per entry (the hash-linking the `audit` module
  relies on); (4) **ai-hwaccel hwprobe** — `registry_detect_no_exec()` →
  `registry_to_summary_json` yields a non-empty JSON summary (the detect→serialize
  path `/api/hwinfo` relies on; hardware-agnostic); (5) **sigil crypto** — a server
  Ed25519 sign→verify round-trip (tamper rejected) + a SHA-256 known-answer (RFC
  6234, impl-independent), the `crypto` module's primitives; (6) **auth JWT** — an
  HS256 issue→verify round-trip returns the subject and the `role` claim, and a
  tampered token + an expired token are both rejected (the `auth` module); (7) **key
  persistence** — `crypto_key_save`→`crypto_key_load` round-trips 32 bytes at rest and
  a missing file loads as absent (the at-rest key I/O); (8) **tee sealing** — an
  AES-256-GCM `tee_seal`→`tee_unseal` round-trips and a tampered ciphertext/tag is
  rejected. Passes via `cyrius run src/test.cyr` (idempotent).
  (`cyrius test` still does not discover the scaffolded `.tcyr` — see FINDINGS.md.)
- `tests/verify.py` — **48-scenario** end-to-end harness (CRUD lifecycle,
  injection/unicode round-trip + restart persistence, 250-concurrent unique ids,
  slow-client isolation, request-smuggling rejects, SIGPIPE survival,
  rows_affected concurrency, **HTTPS: CRUD over TLS 1.3, real cert verification,
  HTTP↔HTTPS shared backend, ALPN negotiates `http/1.1` (9i), 60-concurrent-HTTPS
  served without crashing (10), read-during-write: 310 reads under concurrent
  writes → 0 torn/garbled (11) proving lock-free TEXT readback, the audit
  chain (12a/b): `/api/audit` stays `verified` + `persistent` after all mutations
  incl. the concurrent ones + a controlled create+update+delete adds exactly 3
  linked entries, audit durability (12c): the on-disk chain survives a full server
  restart with entries + head intact and still verified, hwprobe (13):
  `/api/hwinfo` returns a valid ai-hwaccel summary, and crypto (14): `/api/pubkey`
  Ed25519 + the audit `head_sig` verifies INDEPENDENTLY via OpenSSL Ed25519
  (Python cryptography), and auth (15): `POST /api/login` → HS256 JWT, `GET /api/me`
  Bearer-protected (valid→200 sub, wrong-pw/no-token/tampered→401), token decodes as
  a standard RFC 7519 JWT, RBAC (16): `/api/admin` role-gated — admin→200, user→403,
  none→401 (the 401-vs-403 authn/authz split), persistent keys (17): after a full
  restart a pre-restart JWT still verifies and the pubkey is unchanged, tee sealing (18):
  `/api/tee` reports AES-256-GCM + the on-disk key file is a 60-byte sealed blob, and
  RBAC enforcement (19): note writes gated — public read 200, unauth create/update/delete
  →401, user create/update →201/200, user DELETE →403, admin DELETE →200 (scenario 0
  bootstraps an admin token so all mutating scenarios authenticate transparently)**).
  **All scenarios are stable** (the cyrius 6.3.15
  str_builder fix removed the concurrency flakiness). Run against a
  built `build/yeo-cy-test` (needs `cert.pem`/`key.pem` — `./gen-certs.sh`, or
  `build.sh` auto-mints).
- `tests/ui_check.mjs` — **headless full-stack proof**: loads the real
  cyrius-emitted `web/app.js` into a DOM+fetch shim against a running server and
  drives the rendered UI (sign in via the login form → add → detail → edit → delete),
  cross-checking the DOM vs the patra backend (**13 scenarios**: public read with the
  add form gated pre-login, admin CRUD, a user-role session that can add but whose
  admin-only delete control is hidden, XSS-safe text-node rendering).
- `tests/run.sh` — one command: build + unit + 48 backend e2e + 13 UI e2e.
- `tests/concurrency_repro.sh` — standalone diagnostic for the upstream cyrius
  `str_builder` race: curl-hammers static `/api/health` and reports the ~3%
  corrupt-response rate. Exits 0 (documents a filed upstream bug, not a gate).
- `gen-certs.sh` — mints the self-signed Ed25519 cert+key for HTTPS (gitignored).
- `tests/yeo-cy-test.{tcyr,bcyr,fcyr}` — scaffold stubs.

## Dependencies

Direct (declared in `cyrius.cyml`):

- **stdlib** — string, fmt, alloc, io, vec, str, syscalls, assert, bench, net,
  result, tagged, freelist, chrono, thread, atomic, tls, async, random, fdlopen,
  dynlib, **hashmap**, **bayan**. `bayan` is the probe's JSON build/parse
  (`json_v_*`); `json` is dropped — it collides with bayan on `json_v_*`/`_jv_*`/
  `_jp_*`. `hashmap` (`map_*`) is used by sandhi's TLS session cache.
  `tls`/`async`/`random`/`fdlopen`/`dynlib` were sandhi's transitive modules when it
  was folded; with the thin `server` profile bundle they (and `bayan`/`hashmap`) are
  now declared explicitly. `thread`/`atomic` back sandhi's `run_pooled` /
  `run_pooled_tls`. `tls` pulls **sigil** transitively — now used **directly
  server-side** by `src/crypto.cyr` (Ed25519 keygen/sign/verify, SHA-256), not just
  for TLS. **`fs`, `process`, `ct`,
  `keccak`, `thread_local`, `slice`** were added for **libro** (its `dist/libro.deps`
  sidecar lists them); **`args`** (argc/argv) for **ai-hwaccel** (its CLI helpers
  reference them; unused on the probe's no-exec detection path).
- **sandhi** `1.8.2` — the HTTP services lib, pulled as the thin `server` **profile
  bundle** (`[deps.sandhi]`, `modules = ["dist/sandhi-server.cyr"]`; 141 KB vs the
  590 KB full folded bundle). Server-side TLS + Conn-aware router + `run_pooled`/
  `run_pooled_tls`.
- **libro** `2.8.1` — cryptographic audit chain (SHA-256 hash-linked, tamper-
  evident) + patra-backed `patrastore`; the Cyrius target for `sy-core`'s `audit`
  module (`[deps.libro]`). GPL-3.0-only (compatible with this project's AGPL-3.0-only).
  2.8.1 fixed the raw-SQL quote-drop in `patrastore_append` (bound INSERT) — the P1
  this probe filed.
- **ai-hwaccel** `2.3.14` — hardware-accelerator detection (GPU/TPU/NPU/AI-ASIC);
  the Cyrius target for `sy-core`'s `hwprobe` module (`[deps.ai-hwaccel]`). Already
  a Cyrius lib. Detection is read-only (`registry_detect_no_exec`, no subprocess).
- **patra** `1.12.10` — SQL persistence (`[deps.patra]`). 1.12.10 added standard
  `''` escaping + `patra_quote_str` (the P1 quote fix this probe drove).
- **sakshi** `2.4.6` — required transitively by patra (`[deps.sakshi]`)

## Consumers

_None — this is a probe, not a library._

## Next

The probe is now **growing toward the real SecureYeoman → Cyrius port** (see
[`roadmap.md`](roadmap.md)). **Four `sy-core` modules are in:** **`audit` → libro**
(durable via patrastore, Ed25519-signed head), **`hwprobe` → ai-hwaccel**, **`crypto`
→ sigil** (server-side Ed25519 + SHA-256, OpenSSL-interop verified), and **`auth`**
(JWT sessions — HS256 login + Bearer-protected route, sigil HMAC, standard-JWT interop).
The auth/crypto keys are now **AES-256-GCM sealed at rest** (via the `tee` module).
Next bite candidates: **enforce RBAC on the note mutations** (+ a frontend login flow —
the full-stack secured-app push), **`sandbox` → kavach** (v3.7.1), a **hardware-backed
KEK** for `tee` (needs a Cyrius TEE/TPM binding), Argon2 password hashing (once a Cyrius
Argon2 exists), or PKCE/OIDC/WebAuthn. (A briefly-mis-recorded "sigil aes_gcm_decrypt
bug" was retracted — it was a return-convention misread I caught via adversarial review;
the real finding is sigil's inconsistent success conventions.) The viability findings
remain a first-class output — see [`../../FINDINGS.md`](../../FINDINGS.md).
