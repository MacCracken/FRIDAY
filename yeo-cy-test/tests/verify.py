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
  9. HTTPS on :8443 (TLS 1.3 via tls_native + Ed25519): CRUD over TLS, real cert
     verification (untrusted cert rejected), shared patra backend with HTTP
Requires cert.pem/key.pem (./gen-certs.sh — build.sh mints them if absent).
"""
import socket, subprocess, sys, time, json, os, threading, ssl, urllib.request, urllib.error

HOST, PORT = "127.0.0.1", 8080
HTTPS_HOST, HTTPS_PORT = "localhost", 8443   # cert SAN: DNS:localhost, IP:127.0.0.1
BIN = "./build/yeo-cy-test"
DB = "yeo.patra"
passes, fails = [], []

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

def start_server():
    p = subprocess.Popen([BIN], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not wait_ready():
        p.kill(); raise SystemExit("server failed to become ready")
    return p

def stop_server(p):
    p.terminate()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill()

def req(method, path, body=None, timeout=5):
    data = body.encode() if isinstance(body, str) else body
    r = urllib.request.Request(f"http://{HOST}:{PORT}{path}", data=data, method=method)
    if data is not None: r.add_header("Content-Type", "application/json")
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

def https_req(method, path, body=None, ctx=None, timeout=5):
    data = body.encode() if isinstance(body, str) else body
    r = urllib.request.Request(f"https://{HTTPS_HOST}:{HTTPS_PORT}{path}", data=data, method=method)
    if data is not None: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=ctx or _https_ctx()) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

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
for f in (DB,):
    try: os.remove(f)
    except FileNotFoundError: pass

print("=== build/ present ===", os.path.exists(BIN))
srv = start_server()

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

sane = 'POST /api/notes HTTP/1.1\r\nHost: x\r\nContent-Length: 14\r\n\r\n{"body":"sane"}'
# (Content-Length 14 vs 15-byte body; send exactly 14 of body to be precise)
sane_body = '{"body":"ok"}'
sane = f"POST /api/notes HTTP/1.1\r\nHost: x\r\nContent-Length: {len(sane_body)}\r\n\r\n{sane_body}"
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

# 8. rows_affected concurrency probe (bite 1): concurrent PUTs to EXISTING and
#    MISSING ids. patra_rows_affected reads a shared-handle field, so if a write
#    interleaves between the UPDATE and the readback, an existing id can be
#    misread as 0 (false 404) or a missing id as >0 (false 200). Mix them under
#    load and count misclassifications — >0 means the shared-handle race fired.
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

stop_server(srv)

# ── summary ──
print(f"\n=== {len(passes)} passed, {len(fails)} failed ===")
for n, why in fails: print(f"  FAILED: {n} {why}")
sys.exit(1 if fails else 0)
