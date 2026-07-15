#!/usr/bin/env python3
"""End-to-end verification harness for yeo-cy-test.

Usage (from the project root, after `./build.sh`):
    python3 tests/verify.py
Exits 0 if all scenarios pass, 1 otherwise. Starts/stops its own server on
:8080 and uses a throwaway yeo.patra (gitignored).

Covers every probe-tested scenario:
  1. health
  2. 13-case CRUD lifecycle (get/404/400/update/404-on-missing-delete/405/trailing-slash)
  3. injection + unicode round-trip + restart persistence
  4. 250 concurrent POSTs -> 250 unique ids (echoed via last_insert_id ⊆ stored)
  5. slow-client isolation (2 of 4 workers held; /api/health stays fast)
  6. request-smuggling rejects (CL+TE conflict, duplicate CL -> 400; sane -> 200)
  7. SIGPIPE survival (client disconnects mid-exchange; server stays up)
  8. rows_affected concurrency probe (concurrent PUTs to existing + missing ids)
  9. HTTPS on :8443 (TLS 1.3 via sandhi run_pooled_tls + Ed25519): CRUD over TLS,
     real cert verification (untrusted cert rejected), shared patra backend with
     HTTP, ALPN negotiation (http/1.1 — server-side ALPN now implemented)
 10. concurrent HTTPS POSTs -> all succeed, server stays up (TLS pool at 4 workers;
     sigil 3.11.1 banking + the slot-0 fix made concurrent handshakes safe)
 11. concurrent read-during-write correctness (lock-free TEXT readback: patra 1.12.8
     materializes payloads under the query flock, so reads never tear vs a writer)
 12. persistent libro audit chain (create/update/delete → hash-linked entries; survives restart)
 13. hwprobe → ai-hwaccel accelerator summary; 14. crypto → sigil Ed25519 (independent verify)
 15. auth → HS256 JWT sessions; 16. RBAC role claims + role-gated /api/admin (401 vs 403)
 17. persistent keys across restart; 18. tee → AES-256-GCM key sealing at rest
 19. RBAC ENFORCEMENT on note writes (create/update=authed, delete=admin, reads public)
Note writes are RBAC-gated, so req()/https_req() auto-attach an admin Bearer token (see
scenario 0); pass token=None for the unauthenticated negative cases.
Requires cert.pem/key.pem (./gen-certs.sh — build.sh mints them if absent).
"""
import socket, subprocess, sys, time, json, os, threading, ssl, random, urllib.request, urllib.error, http.client

HOST, PORT = "127.0.0.1", 8080
HTTPS_HOST, HTTPS_PORT = "localhost", 8443   # cert SAN: DNS:localhost, IP:127.0.0.1
BIN = "./build/yeo-cy-test"
DB = "yeo.patra"
AUDIT_DB = "yeo-audit.patra"   # libro patrastore-backed audit chain (persistent)
AUTH_KEY = "yeo-auth.key"      # persisted HS256 secret (0600)
IDENTITY_KEY = "yeo-identity.key"  # persisted Ed25519 seed (0600)
ADMIN_PW, USER_PW = "changeme", "user1234"   # demo credentials → admin / user roles
passes, fails = [], []

# Note mutations (POST/PUT/DELETE /api/notes) are RBAC-gated (scenario 19): create/update
# need any authenticated session, DELETE needs admin. So req()/https_req() auto-attach a
# Bearer token on mutating methods — AUTH_TOKEN (an admin token) is set once after startup,
# so every existing CRUD scenario authenticates transparently. Pass token=None to send a
# request with NO Authorization header (the unauthenticated negative cases in scenario 19).
_USE_GLOBAL = object()   # sentinel: "use the module-global AUTH_TOKEN"
AUTH_TOKEN = None
_MUTATION_METHODS = ("POST", "PUT", "DELETE")

def ok(name):   passes.append(name); print(f"  \033[32mPASS\033[0m {name}")
def bad(name, why=""): fails.append((name, why)); print(f"  \033[31mFAIL\033[0m {name}  {why}")

def wait_ready(timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/health", timeout=1) as r:
                if r.status == 200: return True
        except Exception:
            time.sleep(0.05)
    return False

def start_server(login_burst=1000, refill_ms=None):
    # /api/login is per-IP rate limited (scenario 21). The whole suite drives ~50 logins
    # from one source (127.0.0.1), so it would rate-limit ITSELF at the production default
    # (5/min). Start with a permissive burst; scenario 21 restarts with a tiny one to prove
    # the limiter actually limits.
    env = dict(os.environ, SY_LOGIN_BURST=str(login_burst))
    if refill_ms is not None: env["SY_LOGIN_REFILL_MS"] = str(refill_ms)
    p = subprocess.Popen([BIN], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    if not wait_ready():
        p.kill(); raise SystemExit("server failed to become ready")
    return p

def stop_server(p):
    p.terminate()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill()

def req(method, path, body=None, timeout=5, token=_USE_GLOBAL):
    data = body.encode() if isinstance(body, str) else body
    r = urllib.request.Request(f"http://{HOST}:{PORT}{path}", data=data, method=method)
    if data is not None: r.add_header("Content-Type", "application/json")
    tok = AUTH_TOKEN if token is _USE_GLOBAL else token
    if tok and method in _MUTATION_METHODS:
        r.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def raw(payload, read=True, close_early=False, timeout=5):
    s = socket.create_connection((HOST, PORT), timeout=timeout)
    s.sendall(payload if isinstance(payload, bytes) else payload.encode())
    if close_early:
        s.close(); return b""
    if not read:
        return s
    s.settimeout(timeout); buf = b""
    try:
        while True:
            chunk = s.recv(4096)
            if not chunk: break
            buf += chunk
    except socket.timeout:
        pass
    s.close(); return buf

def status_of(raw_resp):
    try: return int(raw_resp.split()[1])
    except Exception: return -1

def _https_ctx():
    return ssl.create_default_context(cafile="cert.pem")   # trust the probe's self-signed CA

def https_req(method, path, body=None, ctx=None, timeout=5, token=_USE_GLOBAL):
    data = body.encode() if isinstance(body, str) else body
    r = urllib.request.Request(f"https://{HTTPS_HOST}:{HTTPS_PORT}{path}", data=data, method=method)
    if data is not None: r.add_header("Content-Type", "application/json")
    tok = AUTH_TOKEN if token is _USE_GLOBAL else token
    if tok and method in _MUTATION_METHODS:
        r.add_header("Authorization", "Bearer " + tok)
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=ctx or _https_ctx()) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def alpn_selected(protos=("http/1.1",), timeout=5):
    """TLS-handshake with ALPN offered; return the server-selected protocol (or
    None if the server negotiated none). Pre-sandhi-1.6.10 / cyrius 6.2.22 this
    was always None — server-side ALPN was unimplemented."""
    ctx = _https_ctx()
    ctx.set_alpn_protocols(list(protos))
    with socket.create_connection((HTTPS_HOST, HTTPS_PORT), timeout=timeout) as rs:
        with ctx.wrap_socket(rs, server_hostname=HTTPS_HOST) as ss:
            return ss.selected_alpn_protocol()

def wait_https(timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            st, _ = https_req("GET", "/api/health", timeout=1)
            if st == 200: return True
        except Exception:
            time.sleep(0.05)
    return False

# ── cleanup ──
for f in (DB, AUDIT_DB, AUTH_KEY, IDENTITY_KEY):
    try: os.remove(f)
    except FileNotFoundError: pass

print("=== build/ present ===", os.path.exists(BIN))
srv = start_server()

# 0. Log in as admin and register the token so req()/https_req() authenticate every
#    mutating scenario below (note writes are RBAC-gated — see scenario 19). The persisted
#    HS256 secret keeps this token valid across the server restarts later in the suite.
_st_boot, _lb_boot = req("POST", "/api/login", json.dumps({"password": ADMIN_PW}), token=None)
AUTH_TOKEN = json.loads(_lb_boot).get("token", "") if _st_boot == 200 else None
(ok if AUTH_TOKEN else bad)(f"0. admin login for authenticated mutations -> {_st_boot}")

# 1. health
st, b = req("GET", "/api/health")
j = json.loads(b)
(ok if st == 200 and j.get("status") == "ok" else bad)("1. health -> 200 {status:ok}")

# 2. CRUD lifecycle
st, b = req("POST", "/api/notes", '{"body":"first note"}')
n1 = json.loads(b); id1 = n1.get("id")
(ok if st == 201 and id1 and n1.get("body") == "first note" else bad)(f"2a. POST create -> 201 id={id1}")

st, b = req("GET", f"/api/notes/{id1}")
(ok if st == 200 and json.loads(b).get("body") == "first note" else bad)("2b. GET by id -> 200 verbatim")

st, _ = req("GET", "/api/notes/999999")
(ok if st == 404 else bad)(f"2c. GET missing id -> 404 (got {st})")

st, _ = req("GET", "/api/notes/abc")
(ok if st == 400 else bad)(f"2d. GET non-numeric id -> 400 (got {st})")

inj = "updated O'Brien'; DROP TABLE notes-- \"x\""
st, b = req("PUT", f"/api/notes/{id1}", json.dumps({"body": inj}))
(ok if st == 200 and json.loads(b).get("body") == inj else bad)("2e. PUT update (injection payload) -> 200")

st, b = req("GET", f"/api/notes/{id1}")
(ok if st == 200 and json.loads(b).get("body") == inj else bad)("2f. GET after update -> verbatim injection text")

st, _ = req("PUT", "/api/notes/999999", '{"body":"x"}')
(ok if st == 404 else bad)(f"2g. PUT missing id -> 404 (got {st})")

st, _ = req("DELETE", f"/api/notes/{id1}")
(ok if st == 200 else bad)(f"2h. DELETE -> 200 (got {st})")

st, _ = req("GET", f"/api/notes/{id1}")
(ok if st == 404 else bad)(f"2i. GET after delete -> 404 (got {st})")

st, _ = req("DELETE", f"/api/notes/{id1}")
(ok if st == 404 else bad)(f"2j. DELETE again (404-on-missing via rows_affected) -> 404 (got {st})")

st = status_of(raw(f"PATCH /api/notes/{id1} HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\n\r\n"))
(ok if st == 405 else bad)(f"2k. PATCH (unmapped method) -> 405 (got {st})")

st = status_of(raw("GET /api/notes/ HTTP/1.1\r\nHost: x\r\n\r\n"))
(ok if st == 404 else bad)(f"2l. GET /api/notes/ (trailing slash) -> 404 (got {st})")

st, b = req("GET", "/api/notes")
(ok if st == 200 and isinstance(json.loads(b), list) else bad)("2m. GET list -> 200 array")

# 3. injection + unicode round-trip + restart persistence
body3 = "O'Brien'; DROP TABLE notes--  ☃ 日本語 \U0001f512"
st, b = req("POST", "/api/notes", json.dumps({"body": body3}))
n3 = json.loads(b); id3 = n3.get("id")
(ok if st == 201 and n3.get("body") == body3 else bad)("3a. POST unicode+injection -> 201 verbatim")
stop_server(srv)
srv = start_server()  # restart: must reload from yeo.patra
st, b = req("GET", f"/api/notes/{id3}")
(ok if st == 200 and json.loads(b).get("body") == body3 else bad)("3b. survives restart, byte-identical")
# table intact: injection did not execute (list still works, contains the row)
st, b = req("GET", "/api/notes")
rows = json.loads(b)
(ok if st == 200 and any(r.get("id") == id3 for r in rows) else bad)("3c. notes table intact after injection payload")

# 4. 250 concurrent POSTs -> unique ids
N = 250
ids, errs, lock = [], [], threading.Lock()
def worker(i):
    try:
        st, b = req("POST", "/api/notes", json.dumps({"body": f"c{i}"}))
        if st == 201:
            with lock: ids.append(json.loads(b)["id"])
        else:
            with lock: errs.append(st)
    except Exception as e:
        with lock: errs.append(str(e))
ts = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
for t in ts: t.start()
for t in ts: t.join()
uniq = len(set(ids))
# Cross-check: every ECHOED id (via last_insert_id) must be a real STORED id
# (subset, since the table may hold pre-existing rows from earlier scenarios). A
# shared-handle last_insert_id race echoes another worker's id -> a duplicate
# echo or an echoed id absent from storage. Subset + full uniqueness catches it.
st, b = req("GET", "/api/notes")
stored = set(r["id"] for r in json.loads(b))
sub = set(ids).issubset(stored)
(ok if uniq == N and len(ids) == N and not errs and sub else bad)(
    f"4. {N} concurrent POSTs -> {len(ids)} ok, {uniq} unique, {len(errs)} errs, echoed⊆stored:{sub}")

# 5. slow-client isolation: hold 2 of 4 workers with partial requests, time health
holders = []
for _ in range(2):
    s = socket.create_connection((HOST, PORT), timeout=5)
    s.sendall(b"GET /api/health HTTP/1.1\r\nHost: x\r\n")  # headers incomplete -> worker blocks in recv
    holders.append(s)
time.sleep(0.2)
t0 = time.time(); st, _ = req("GET", "/api/health", timeout=3); dt = (time.time() - t0) * 1000
(ok if st == 200 and dt < 500 else bad)(f"5. health served while 2/4 workers held ({dt:.0f}ms)")
for s in holders:
    try: s.close()
    except Exception: pass

# 6. request-smuggling rejects
clte = ("POST /api/notes HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n"
        "Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n")
st = status_of(raw(clte))
(ok if st == 400 else bad)(f"6a. CL+TE conflict -> 400 (got {st})")

dupcl = "POST /api/notes HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello"
st = status_of(raw(dupcl))
(ok if st == 400 else bad)(f"6b. duplicate Content-Length -> 400 (got {st})")

# A well-formed POST must now carry auth (note writes are RBAC-gated — scenario 19);
# include the admin Bearer token so this exercises the sane-framing path, not a 401.
sane_body = '{"body":"ok"}'
sane = (f"POST /api/notes HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {AUTH_TOKEN}\r\n"
        f"Content-Length: {len(sane_body)}\r\n\r\n{sane_body}")
st = status_of(raw(sane))
(ok if st in (200, 201) else bad)(f"6c. sane request -> 2xx (got {st})")

# 7. SIGPIPE survival: send a request that elicits a body, then close before reading
for i in range(10):
    raw(f"GET /api/notes HTTP/1.1\r\nHost: x\r\n\r\n", close_early=True)
    time.sleep(0.01)
time.sleep(0.2)
alive = wait_ready(timeout=3)
st, _ = (req("GET", "/api/health") if alive else (-1, ""))
(ok if alive and st == 200 else bad)("7. server survives 10 mid-exchange client disconnects (no SIGPIPE death)")

# 8. rows_affected concurrency probe: concurrent PUTs to EXISTING and MISSING ids.
#    Under connection-per-thread each worker reads patra_rows_affected on its OWN
#    handle, so the UPDATE + readback can't be split by another worker's write.
#    Mix existing/missing under load and count misclassifications — an existing id
#    misread as 404, or a missing id as 200, would mean the per-handle model broke.
K = 60
ex_ids = []
for i in range(K):
    st, b = req("POST", "/api/notes", json.dumps({"body": f"e{i}"}))
    ex_ids.append(json.loads(b)["id"])
miss_ids = [10_000_000 + i for i in range(K)]
res8 = {"existing": [], "missing": []}
lock8 = threading.Lock()
def put_probe(idv, kind):
    st, _ = req("PUT", f"/api/notes/{idv}", '{"body":"probe"}')
    with lock8: res8[kind].append(st)
th8 = ([threading.Thread(target=put_probe, args=(i, "existing")) for i in ex_ids] +
       [threading.Thread(target=put_probe, args=(i, "missing")) for i in miss_ids])
for t in th8: t.start()
for t in th8: t.join()
false_404 = sum(1 for s in res8["existing"] if s != 200)
false_200 = sum(1 for s in res8["missing"] if s != 404)
(ok if false_404 == 0 and false_200 == 0 else bad)(
    f"8. rows_affected concurrency: existing->!200={false_404}, missing->!404={false_200} (race if >0)")

# 9. HTTPS (TLS 1.3 via tls_native + Ed25519 cert) on :8443, alongside HTTP.
if not wait_https():
    bad("9. HTTPS listener not ready on :8443")
else:
    st, b = https_req("GET", "/api/health")
    (ok if st == 200 and json.loads(b).get("status") == "ok" else bad)("9a. HTTPS GET /api/health -> 200 (TLS 1.3, cert verified)")

    # full CRUD over TLS (body + path params + patra, all over the encrypted conn)
    st, b = https_req("POST", "/api/notes", json.dumps({"body": "tls O'Brien'; DROP-- ☃"}))
    nid = json.loads(b).get("id") if st == 201 else None
    (ok if st == 201 and nid else bad)(f"9b. HTTPS POST create -> 201 id={nid}")
    st, b = https_req("GET", f"/api/notes/{nid}")
    (ok if st == 200 and json.loads(b).get("body") == "tls O'Brien'; DROP-- ☃" else bad)("9c. HTTPS GET by id -> verbatim (injection/unicode safe over TLS)")
    st, _ = https_req("PUT", f"/api/notes/{nid}", json.dumps({"body": "tls upd"}))
    (ok if st == 200 else bad)(f"9d. HTTPS PUT -> 200 (got {st})")
    st, _ = https_req("DELETE", f"/api/notes/{nid}")
    (ok if st == 200 else bad)(f"9e. HTTPS DELETE -> 200 (got {st})")
    st, _ = https_req("GET", f"/api/notes/{nid}")
    (ok if st == 404 else bad)(f"9f. HTTPS GET after delete -> 404 (got {st})")

    # cert verification is REAL: a default context (no probe CA) must reject the
    # self-signed cert, not silently trust it.
    try:
        https_req("GET", "/api/health", ctx=ssl.create_default_context(), timeout=3)
        bad("9g. HTTPS rejects untrusted cert (default CA store)")
    except (ssl.SSLError, urllib.error.URLError):
        ok("9g. HTTPS rejects untrusted cert (default CA store) — verification is real")

    # shared backend: a note created over HTTP is visible over HTTPS (same patra).
    st, b = req("POST", "/api/notes", json.dumps({"body": "via-http"}))
    hid = json.loads(b).get("id")
    st, b = https_req("GET", f"/api/notes/{hid}")
    (ok if st == 200 and json.loads(b).get("body") == "via-http" else bad)("9h. HTTP-created note readable over HTTPS (shared patra backend)")

    # 9i. ALPN: the server now SELECTS http/1.1 (sandhi 1.6.10 server-TLS rides
    #     the shared ALPN hook; cyrius 6.2.22 implemented tls_native server-side
    #     ALPN). This was "No ALPN negotiated" before — a probe-filed finding,
    #     now shipped + adopted. Regression guard on the negotiation.
    try:
        sel = alpn_selected(("http/1.1",))
        (ok if sel == "http/1.1" else bad)(f"9i. ALPN negotiates http/1.1 (got {sel!r})")
    except Exception as e:
        bad("9i. ALPN negotiates http/1.1", str(e))

    # 10. Concurrent HTTPS: N simultaneous HTTPS POSTs must ALL succeed with unique
    #     ids and the server must stay up. The TLS pool runs 4 workers (max_conns=4):
    #     sigil 3.11.1's per-thread crypto banking + the sigil/patra thread-local
    #     slot-0 fix (cyrius 6.3.25, sigil 3.9.9) made concurrent TLS handshakes
    #     safe. This scenario is the regression tripwire — if the crypto thread
    #     safety ever regresses, concurrent handshakes crash here and it fails loudly.
    M = 60
    hids, herrs, hlock = [], [], threading.Lock()
    def https_worker(i):
        try:
            st, b = https_req("POST", "/api/notes", json.dumps({"body": f"tlsc{i}"}))
            if st == 201:
                with hlock: hids.append(json.loads(b)["id"])
            else:
                with hlock: herrs.append(st)
        except Exception as e:
            with hlock: herrs.append(str(e))
    hts = [threading.Thread(target=https_worker, args=(i,)) for i in range(M)]
    for t in hts: t.start()
    for t in hts: t.join()
    huniq = len(set(hids))
    (ok if huniq == M and len(hids) == M and not herrs else bad)(
        f"10. {M} concurrent HTTPS POSTs -> {len(hids)} ok, {huniq} unique, {len(herrs)} errs")

# 11. Concurrent read-during-write correctness — the regression guard for the
#     DROPPED g_db_lock. patra 1.12.8's _rs_materialize snapshots every TEXT/BYTES
#     payload into an owned heap buffer WHILE the query's shared flock is held, so
#     patra_result_read_text is a pure memcpy safe against a concurrent writer
#     freeing/overwriting those pages. Before 1.12.8 (and now with no lock) a torn
#     or stale body would come back. Hammer GET on a set of multi-page unicode
#     TEXT rows while writers PUT other valid bodies to the SAME ids; every 200
#     body MUST be a COMPLETE, accepted value (never a torn splice / bad UTF-8 /
#     JSON parse failure). This scenario used to be disabled because the cyrius
#     str_builder array-local race corrupted ~3% of responses under load; that was
#     fixed in cyrius 6.3.15 (array locals per-thread), so it is a gate again.
r11_bodies = ["rw-" + str(i) + "-" + (chr(0x4e00 + i) * 1200) for i in range(6)]  # ~3.6KB, multi-page
r11_ids = []
for _b in r11_bodies:
    _st, _r = req("POST", "/api/notes", json.dumps({"body": _b}))
    r11_ids.append(json.loads(_r)["id"])
r11_valid = set(r11_bodies)
r11_viol, r11_reads, r11_lock, r11_stop = [], [0], threading.Lock(), {"s": False}
def r11_reader():
    while not r11_stop["s"]:
        idv = random.choice(r11_ids)
        try:
            st, b = req("GET", f"/api/notes/{idv}")
            if st == 200:
                body = json.loads(b).get("body")
                with r11_lock:
                    r11_reads[0] += 1
                    if body not in r11_valid: r11_viol.append(("torn", repr(body)[:48]))
        except Exception as e:
            with r11_lock: r11_viol.append(("exc", str(e)[:48]))
def r11_writer():
    for _ in range(50):
        try: req("PUT", f"/api/notes/{random.choice(r11_ids)}", json.dumps({"body": random.choice(r11_bodies)}))
        except Exception: pass
r11_rt = [threading.Thread(target=r11_reader) for _ in range(6)]
r11_wt = [threading.Thread(target=r11_writer) for _ in range(4)]
for t in r11_rt + r11_wt: t.start()
for t in r11_wt: t.join()
r11_stop["s"] = True
for t in r11_rt: t.join()
(ok if not r11_viol else bad)(
    f"11. read-during-write: {r11_reads[0]} reads, {len(r11_viol)} torn/garbled (lock-free TEXT readback)")

# 12. Audit chain (libro, PERSISTENT via patrastore) — the first sy-core module
#     ported into the probe. Every note mutation (create/update/delete) appends a
#     SHA-256 hash-linked entry to a patra-backed libro store, serialized by
#     g_audit_lock (a hash chain is inherently serial — one writer at a time is
#     correct, not a workaround). GET /api/audit returns {entries, verified, head,
#     persistent}. After ALL prior scenarios — including 250 + 60 CONCURRENT
#     mutations — the chain must still verify: a torn concurrent append would break
#     the hash links and flip verified to false. Then a controlled
#     create+update+delete must add EXACTLY 3 entries (no other thread is mutating at
#     this point) and advance the head. 12c proves DURABILITY: the on-disk chain
#     survives a full server restart, entries intact and still verified (the head is
#     reconstructed so new entries link across the restart boundary).
st, b = req("GET", "/api/audit")
a0 = json.loads(b) if st == 200 else {}
(ok if st == 200 and a0.get("verified") is True and a0.get("entries", 0) > 0
    and a0.get("head") and a0.get("persistent") is True
    else bad)(f"12a. audit chain intact + persistent after all mutations (entries={a0.get('entries')}, verified={a0.get('verified')})")
e0, h0 = a0.get("entries", 0), a0.get("head", "")
_st, _r = req("POST", "/api/notes", json.dumps({"body": "audit-delta"}))
_aid = json.loads(_r)["id"]
req("PUT", f"/api/notes/{_aid}", json.dumps({"body": "audit-delta-2"}))
req("DELETE", f"/api/notes/{_aid}")
st, b = req("GET", "/api/audit")
a1 = json.loads(b) if st == 200 else {}
(ok if st == 200 and a1.get("entries", 0) == e0 + 3 and a1.get("verified") is True and a1.get("head") != h0
    else bad)(f"12b. create+update+delete -> +{a1.get('entries',0)-e0} entries (want 3), verified={a1.get('verified')}, head advanced")
# 12c. Durability: the audit chain survives a server restart (patrastore persists
#      to yeo-audit.patra; the head is reconstructed on reopen). Entries and head
#      must be identical after the restart, and the chain still verifies.
e2, h2 = a1.get("entries", 0), a1.get("head", "")
stop_server(srv)
srv = start_server()  # reloads yeo.patra AND yeo-audit.patra
st, b = req("GET", "/api/audit")
a2 = json.loads(b) if st == 200 else {}
(ok if st == 200 and a2.get("entries", 0) == e2 and a2.get("head") == h2 and a2.get("verified") is True
    else bad)(f"12c. audit chain survives restart (entries {a2.get('entries')}=={e2}, verified={a2.get('verified')})")

# 13. hwprobe → ai-hwaccel — the second sy-core module ported in. GET /api/hwinfo
#     serves the host's accelerator summary, detected ONCE at startup via
#     registry_detect_no_exec() (no subprocess spawning) and cached. Assert 200 +
#     valid JSON + the expected summary keys with sane types. Hardware-agnostic (no
#     specific device asserted) so it passes on any host, incl. accelerator-less CI.
st, b = req("GET", "/api/hwinfo")
try: hw = json.loads(b) if st == 200 else {}
except Exception: hw = {}
_hwkeys = ("device_count", "has_accelerator", "total_memory_bytes",
           "accelerator_memory_bytes", "gpu_count", "tpu_count", "npu_count", "warnings")
_hwok = (st == 200 and all(k in hw for k in _hwkeys)
         and isinstance(hw.get("device_count"), int)
         and isinstance(hw.get("has_accelerator"), bool)
         and isinstance(hw.get("total_memory_bytes"), int))
(ok if _hwok else bad)(
    f"13. /api/hwinfo -> hw summary (devices={hw.get('device_count')}, gpu={hw.get('gpu_count')}, mem={hw.get('total_memory_bytes')})")

# 14. crypto → sigil — the third sy-core module, and the first server-side use of
#     sigil beyond TLS. The server holds an Ed25519 identity key: GET /api/pubkey
#     publishes it, and GET /api/audit signs the chain head (head_sig). INDEPENDENT
#     cross-check: verify head_sig against the pubkey with Python's cryptography
#     (OpenSSL Ed25519) — proving sigil's server signature interoperates with a
#     standard implementation, not just itself. Falls back to a structural check if
#     `cryptography` isn't installed (so CI without it still passes).
st, pb = req("GET", "/api/pubkey")
pub = json.loads(pb) if st == 200 else {}
st2, ab = req("GET", "/api/audit")
aud = json.loads(ab) if st2 == 200 else {}
c14_wellformed = (pub.get("alg") == "ed25519" and len(pub.get("pubkey", "")) == 64
                  and len(aud.get("head_sig", "")) == 128)
c14_verified = None  # None = cryptography unavailable (structural check only)
try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    _pk = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub["pubkey"]))
    _pk.verify(bytes.fromhex(aud["head_sig"]), aud["head"].encode())  # raises if invalid
    c14_verified = True
except ImportError:
    c14_verified = None
except Exception:
    c14_verified = False
(ok if c14_wellformed and c14_verified is not False else bad)(
    f"14. /api/pubkey Ed25519 + audit head_sig "
    f"{'verifies independently (OpenSSL)' if c14_verified else 'well-formed'} (alg={pub.get('alg')})")

# 15. auth → JWT sessions (sy-core's `auth`, first bite). POST /api/login issues an
#     HS256 JWT (sigil HMAC); GET /api/me is Bearer-protected. Wrong password → 401;
#     a valid token → 200 with the subject; no token / a tampered token → 401. The
#     issued token is independently decoded as a standard RFC 7519 JWT (alg/typ +
#     sub/iat/exp claims) — interop, not just self-consistency.
st_login, lb = req("POST", "/api/login", json.dumps({"password": "changeme"}))
login = json.loads(lb) if st_login == 200 else {}
tok = login.get("token", "")
st_bad, _bb = req("POST", "/api/login", json.dumps({"password": "nope"}))

def _me(token):
    r = urllib.request.Request(f"http://{HOST}:{PORT}/api/me", method="GET")
    if token is not None:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

st_ok, meb = _me(tok)
me = json.loads(meb) if st_ok == 200 else {}
st_noauth, _ = _me(None)
st_tamper, _ = _me(tok + "x")

# Independent standard-JWT structure/claims decode (base64url segments).
def _b64u_dec(s):
    import base64
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
jwt_ok = False
try:
    _pt = tok.split(".")
    _h = json.loads(_b64u_dec(_pt[0])); _p = json.loads(_b64u_dec(_pt[1]))
    jwt_ok = (_h.get("alg") == "HS256" and _h.get("typ") == "JWT"
              and _p.get("sub") == "admin" and "iat" in _p and _p.get("exp", 0) > _p.get("iat", 0))
except Exception:
    jwt_ok = False

_c15 = (st_login == 200 and tok and st_bad == 401 and st_ok == 200
        and me.get("sub") == "admin" and me.get("authenticated") is True
        and st_noauth == 401 and st_tamper == 401 and jwt_ok)
(ok if _c15 else bad)(
    f"15. JWT auth: login {st_login}/bad-pw {st_bad}/me {st_ok} sub={me.get('sub')}/"
    f"no-auth {st_noauth}/tampered {st_tamper}/std-JWT {jwt_ok}")

# 16. auth RBAC — role claims + a role-gated route. Two credentials map to roles
#     (admin / user). GET /api/admin requires role=admin: an admin token → 200, a user
#     token → 403 (authenticated but unauthorized), no token → 401. The 401-vs-403
#     split is the authentication/authorization distinction. /api/me carries the role.
def _auth_get(path, token):
    r = urllib.request.Request(f"http://{HOST}:{PORT}{path}", method="GET")
    if token is not None:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

_sa, _ab = req("POST", "/api/login", json.dumps({"password": "changeme"}))
_su, _ub = req("POST", "/api/login", json.dumps({"password": "user1234"}))
_ta = json.loads(_ab).get("token", "") if _sa == 200 else ""
_tu = json.loads(_ub).get("token", "") if _su == 200 else ""
_adm_a, _aab = _auth_get("/api/admin", _ta)
_adm_u, _ = _auth_get("/api/admin", _tu)
_adm_n, _ = _auth_get("/api/admin", None)
_admj = json.loads(_aab) if _adm_a == 200 else {}
_meu, _meub = _auth_get("/api/me", _tu)
_meuj = json.loads(_meub) if _meu == 200 else {}
_c16 = (_su == 200 and _tu and _adm_a == 200 and _admj.get("role") == "admin"
        and _adm_u == 403 and _adm_n == 401 and _meuj.get("role") == "user")
(ok if _c16 else bad)(
    f"16. RBAC: /api/admin admin {_adm_a}/user {_adm_u}/none {_adm_n}; user-role={_meuj.get('role')}")

# 17. persistent keys — the HS256 secret and Ed25519 identity SEED are stored at rest
#     (0600, yeo-auth.key / yeo-identity.key), so a restart does NOT invalidate issued
#     tokens or rotate the server identity. Capture a token + pubkey, RESTART the
#     server, then assert the pre-restart token still verifies (/api/me 200) and the
#     pubkey is unchanged — proving the keys were reloaded, not regenerated.
_s17, _l17 = req("POST", "/api/login", json.dumps({"password": "changeme"}))
tok_before = json.loads(_l17).get("token", "") if _s17 == 200 else ""
_, _pk17a = req("GET", "/api/pubkey")
pk_before = json.loads(_pk17a).get("pubkey", "")
stop_server(srv)
srv = start_server()  # fresh process — reloads yeo-auth.key + yeo-identity.key
me17, _ = _auth_get("/api/me", tok_before)
_, _pk17b = req("GET", "/api/pubkey")
pk_after = json.loads(_pk17b).get("pubkey", "")
_c17 = (tok_before and me17 == 200 and pk_before and pk_before == pk_after)
(ok if _c17 else bad)(
    f"17. persistent keys across restart: pre-restart token valid={me17 == 200}, pubkey stable={pk_before == pk_after}")

# 18. tee → AES-256-GCM key sealing (sy-core's `tee`). The persisted key files are
#     CIPHERTEXT at rest, not raw keys: GET /api/tee reports the algorithm, and the
#     on-disk yeo-auth.key is a sealed blob (12 IV + 32 key + 16 tag = 60 bytes), not
#     the 32-byte raw secret. (Persistence *through* sealing is covered by scenario 17.)
_st18, _tb = req("GET", "/api/tee")
tee = json.loads(_tb) if _st18 == 200 else {}
key_size = os.path.getsize(AUTH_KEY) if os.path.exists(AUTH_KEY) else 0
_c18 = (_st18 == 200 and tee.get("algorithm") == "AES-256-GCM"
        and tee.get("sealed") is True and key_size == 60)
(ok if _c18 else bad)(
    f"18. tee sealing: /api/tee alg={tee.get('algorithm')} sealed={tee.get('sealed')}; "
    f"yeo-auth.key={key_size}B (sealed=60, raw would be 32)")

# 19. RBAC ENFORCEMENT on note mutations (sy-core's auth, applied to the resource). The
#     write endpoints are gated: create/update require ANY authenticated session, DELETE
#     requires role=admin. Reads stay PUBLIC. Verifies the 401 (unauthenticated) vs 403
#     (authenticated-but-unauthorized) split on the actual notes resource — not just the
#     demo /api/admin probe route. This is the full-stack "secured writes" guarantee.
_su19, _ub19 = req("POST", "/api/login", json.dumps({"password": USER_PW}), token=None)
utok = json.loads(_ub19).get("token", "") if _su19 == 200 else ""

_r_pub, _   = req("GET", "/api/notes", token=None)                                    # reads: public
_c_noauth,_ = req("POST", "/api/notes", json.dumps({"body": "nope"}), token=None)     # write w/o token → 401
_sc, _cb    = req("POST", "/api/notes", json.dumps({"body": "rbac-seed"}))            # seed (admin token)
rid = json.loads(_cb).get("id") if _sc == 201 else None
_u_noauth,_ = req("PUT", f"/api/notes/{rid}", json.dumps({"body": "x"}), token=None)  # → 401
_d_noauth,_ = req("DELETE", f"/api/notes/{rid}", token=None)                          # → 401

# A user-role session may create/update (any authenticated role) ...
_u_create, _uc = req("POST", "/api/notes", json.dumps({"body": "by-user"}), token=utok)
uid = json.loads(_uc).get("id") if _u_create == 201 else None
_u_update, _   = req("PUT", f"/api/notes/{uid}", json.dumps({"body": "by-user-2"}), token=utok)
# ... but DELETE is admin-only: a user token is authenticated yet unauthorized → 403.
_u_delete, _ = req("DELETE", f"/api/notes/{uid}", token=utok)
_a_delete, _ = req("DELETE", f"/api/notes/{uid}", token=AUTH_TOKEN)                   # admin → 200

_c19 = (utok and rid and uid and _r_pub == 200
        and _c_noauth == 401 and _u_noauth == 401 and _d_noauth == 401
        and _u_create == 201 and _u_update == 200
        and _u_delete == 403 and _a_delete == 200)
(ok if _c19 else bad)(
    f"19. RBAC writes: public-read {_r_pub}; unauth create/update/delete "
    f"{_c_noauth}/{_u_noauth}/{_d_noauth} (want 401); user create/update {_u_create}/{_u_update} "
    f"(want 201/200); user-delete {_u_delete} (want 403) / admin-delete {_a_delete} (want 200)")

# 20. login admission control — the guard on a DoS this probe INTRODUCED. Argon2id makes
#     /api/login cost ~244 ms of CPU, so an unauthenticated attacker gets huge request
#     amplification against a 4-worker pool: measured, 8 concurrent attempts pushed
#     GET /api/health from 6 ms to 942 ms, and ~40 wedged the server. auth.cyr now caps
#     CONCURRENT derivations (LOGIN_MAX_INFLIGHT=2 of 4 workers) and sheds the excess with
#     429 *before* any Argon2 work, so a rejected attempt is ~free. Assert: under a burst
#     (a) most attempts are shed 429, (b) at most LOGIN_MAX_INFLIGHT do real work,
#     (c) unrelated traffic stays fast, and (d) a legitimate login still succeeds after.
N20 = 40
r20, lock20 = [], threading.Lock()
def login_burst():
    st, _ = req("POST", "/api/login", json.dumps({"password": "wrong"}), token=None, timeout=25)
    with lock20: r20.append(st)
th20 = [threading.Thread(target=login_burst) for _ in range(N20)]
for t in th20: t.start()
time.sleep(0.10)                      # let the burst occupy the pool
t0 = time.time()
h20, _ = req("GET", "/api/health", timeout=25)
h20_ms = (time.time() - t0) * 1000
for t in th20: t.join()
shed = sum(1 for s in r20 if s == 429)
worked = sum(1 for s in r20 if s == 401)   # reached Argon2 and was correctly rejected
st20_ok, _ = req("POST", "/api/login", json.dumps({"password": ADMIN_PW}), token=None)
_c20 = (h20 == 200 and h20_ms < 500 and shed > 0 and worked <= 2 and st20_ok == 200
        and (shed + worked) == N20)
(ok if _c20 else bad)(
    f"20. login admission control: {N20} concurrent -> {shed} shed 429 / {worked} hashed "
    f"(cap 2); /api/health {h20_ms:.0f}ms during burst (was 942ms, then wedged); "
    f"legit login after -> {st20_ok}")

# 21. per-IP login rate limiting — the OTHER half of the DoS this probe introduced, and the
#     payoff of a finding that went all the way around the ecosystem: the concurrency cap
#     (scenario 20) stops a burst from starving the pool, but one source could still grind
#     2 workers forever. Bounding SUSTAINED attempts needs to attribute them to a source,
#     which sandhi could not expose — filed -> **sandhi 1.9.0** `sandhi_server_conn_peer_ip`
#     -> folded in cyrius 6.4.64 -> adopted here as a per-IP token bucket.
#     The decisive assertion is ISOLATION: a *different* source IP must have its own bucket.
#     127.0.0.0/8 is all loopback, so 127.0.0.2 is a genuinely different peer address to the
#     server while still being this machine.
stop_server(srv)
srv = start_server(login_burst=3, refill_ms=60000)   # 3 attempts, ~no refill during the test

def _login_from(src, pw="wrong"):
    kw = {"source_address": (src, 0)} if src else {}
    try:
        c = http.client.HTTPConnection(HOST, PORT, timeout=20, **kw)
        c.request("POST", "/api/login", json.dumps({"password": pw}), {"Content-Type": "application/json"})
        r = c.getresponse(); r.read(); c.close(); return r.status
    except Exception as e:
        return str(e)[:24]

burst_codes = [_login_from(None) for _ in range(6)]
allowed = burst_codes.count(401)
limited = burst_codes.count(429)
# A different source address gets its own budget (not starved by 127.0.0.1's).
other_codes = [_login_from("127.0.0.2") for _ in range(3)]
other_ok = all(c == 401 for c in other_codes)
h21, _ = req("GET", "/api/health")                    # unrelated traffic unaffected
still, _ = req("POST", "/api/login", json.dumps({"password": "wrong"}), token=None)

_c21 = (allowed == 3 and limited == 3 and other_ok and h21 == 200 and still == 429)
(ok if _c21 else bad)(
    f"21. per-IP login rate limit (burst 3): 127.0.0.1 6 attempts -> {allowed} allowed/{limited} 429; "
    f"127.0.0.2 -> {other_codes} (own bucket = per-IP isolation); /api/health {h21}; .1 still {still}")

stop_server(srv)
srv = start_server()                                   # back to the permissive suite default

stop_server(srv)

# ── summary ──
print(f"\n=== {len(passes)} passed, {len(fails)} failed ===")
for n, why in fails: print(f"  FAILED: {n} {why}")
sys.exit(1 if fails else 0)
