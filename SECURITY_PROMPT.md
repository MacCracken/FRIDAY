# Security Hardening Implementation Prompt (Phase 2 Remaining)

> Implement remaining Phase 2 security items: macOS sandbox, Linux sandbox V2 (kernel-level), mTLS support, and Redis rate limit adapter.

---

## Context

The security layer is already substantial:
- `Sandbox` interface at `packages/core/src/sandbox/types.ts` defines `run()`, `getCapabilities()`, `isAvailable()`
- `LinuxSandbox` at `packages/core/src/sandbox/linux-sandbox.ts` implements V1 soft sandbox (path validation + resource tracking, no kernel enforcement)
- `NoopSandbox` at `packages/core/src/sandbox/noop-sandbox.ts` is the fallback
- `SandboxManager` at `packages/core/src/sandbox/manager.ts` handles platform detection and factory creation
- `RateLimiter` at `packages/core/src/security/rate-limiter.ts` uses in-memory sliding windows
- Gateway server at `packages/core/src/gateway/server.ts` has Fastify with `trustProxy: false`, bodyLimit 1MB, local-IP-only enforcement
- Auth middleware at `packages/core/src/gateway/auth-middleware.ts` handles JWT + API key + RBAC
- 37 sandbox tests + 13 rate limiter tests already passing
- Config schema supports `security.sandbox.technology: auto | seccomp | landlock | none`

---

## Part 1: Linux Sandbox V2 — Kernel-Level Enforcement (P2-008 V2)

### 1.1 Landlock enforcement via child process

**File:** `packages/core/src/sandbox/linux-sandbox.ts`

The current `LinuxSandbox` detects Landlock capability but doesn't enforce it. Implement kernel-level Landlock restrictions:

**Requirements:**
- Create a `packages/core/src/sandbox/landlock-worker.ts` that runs as a child process
- The worker should:
  1. Apply Landlock ruleset restricting filesystem access to configured `readPaths` and `writePaths`
  2. Execute the sandboxed function
  3. Return the result via IPC
- Use `child_process.fork()` with IPC channel for communication
- The Landlock syscalls should be invoked via a minimal native addon or via writing to `/proc/self/attr/apparmor/current` (investigate feasibility)
- **Alternative approach**: Use a helper binary written in C that applies Landlock restrictions, then exec's the Node.js function. Bundle the C source and compile during `npm install` on Linux.
- Fall back to V1 soft sandbox if Landlock is unavailable (kernel < 5.13)

**Key Landlock API (Linux kernel >= 5.13):**
```
landlock_create_ruleset() → fd
landlock_add_rule(fd, LANDLOCK_RULE_PATH_BENEATH, ...)
landlock_restrict_self(fd)
```

### 1.2 seccomp-bpf filter (optional, deferred if too complex)

If Landlock alone isn't sufficient, add seccomp-bpf filtering:
- Create BPF program to allow only safe syscalls (read, write, open, close, mmap, etc.)
- Block dangerous syscalls (execve, ptrace, mount, etc.)
- Apply via `prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, ...)`
- This likely requires a native addon — evaluate `seccomp-tools` npm package or write minimal C binding

### 1.3 Update SandboxManager

In `packages/core/src/sandbox/manager.ts`:
- When `technology === 'landlock'` and kernel supports it, pass `{ enforceLandlock: true }` to LinuxSandbox
- When `technology === 'auto'`, detect and prefer Landlock if available
- Update `getCapabilities()` to return `landlock: true` when enforcement is active (not just detected)

### 1.4 Tests

Create `packages/core/src/sandbox/landlock.test.ts`:
- Test Landlock detection (mock `/proc/sys/kernel/landlock_restrict_self`)
- Test that sandboxed function cannot read outside allowed paths
- Test that sandboxed function cannot write outside allowed paths
- Test fallback to V1 when Landlock unavailable
- Test resource limits still enforced alongside Landlock

---

## Part 2: macOS Sandbox (P2-009)

### 2.1 Create `packages/core/src/sandbox/darwin-sandbox.ts`

Implement the `Sandbox` interface for macOS using `sandbox-exec`:

**Requirements:**
- Use `sandbox-exec -p <profile>` to run sandboxed operations
- Generate a Sandbox profile (.sb format) dynamically based on `SandboxOptions`:
  ```scheme
  (version 1)
  (deny default)
  (allow file-read* (subpath "/path/to/allowed"))
  (allow file-write* (subpath "/path/to/allowed"))
  (allow process-exec (subpath "/usr/bin"))
  (allow network* (local ip))
  ```
- Map `SandboxOptions.filesystem.readPaths` → `file-read*` rules
- Map `SandboxOptions.filesystem.writePaths` → `file-write*` rules
- Map `SandboxOptions.network.allowed` → `network*` rules
- Always allow: sysctl-read, process-fork, mach-lookup (needed for Node.js)
- Execute the sandboxed function in a child process under `sandbox-exec`
- Track resource usage (memory, CPU) via `process.cpuUsage()` and `process.memoryUsage()`

### 2.2 Capability detection

```typescript
isAvailable(): boolean {
  // Check platform === 'darwin'
  // Check sandbox-exec exists: execFileSync('which', ['sandbox-exec'])
  // Note: sandbox-exec is deprecated in newer macOS but still works
}

getCapabilities(): SandboxCapabilities {
  return {
    landlock: false,
    seccomp: false,
    namespaces: false,
    rlimits: true,    // macOS supports ulimit
    platform: 'darwin',
  };
}
```

### 2.3 Update SandboxManager

In `packages/core/src/sandbox/manager.ts`, add Darwin detection:
```typescript
case 'darwin':
  return new DarwinSandbox(this.config, this.logger);
```

### 2.4 Tests

Create `packages/core/src/sandbox/darwin-sandbox.test.ts`:
- Test profile generation from SandboxOptions
- Test filesystem restriction (read/write path enforcement)
- Test network restriction
- Test resource tracking
- Skip tests on non-macOS platforms with `describe.skipIf(process.platform !== 'darwin')`

---

## Part 3: mTLS Support (P2-004)

### 3.1 Update gateway server for TLS

**File:** `packages/core/src/gateway/server.ts`

The gateway config already has a `tls` section (`enabled`, `certPath`, `keyPath`, `caPath`) but it's not wired up.

**Requirements:**
- When `config.tls.enabled === true`:
  1. Read cert, key, and CA files from configured paths
  2. Pass to Fastify via `https` option:
     ```typescript
     const app = Fastify({
       https: {
         cert: fs.readFileSync(config.tls.certPath),
         key: fs.readFileSync(config.tls.keyPath),
         ca: config.tls.caPath ? fs.readFileSync(config.tls.caPath) : undefined,
         requestCert: true,       // Request client certificate
         rejectUnauthorized: true, // Reject if client cert invalid
       },
     });
     ```
  3. Extract client certificate CN from `request.raw.socket.getPeerCertificate()`
  4. Map CN to user identity for RBAC (create `CertificateAuthProvider`)
- When client cert is present AND valid, skip JWT/API key auth (cert takes priority)
- Log certificate validation failures to audit chain

### 3.2 Certificate generation helper

Create `packages/core/src/security/cert-gen.ts`:
- `generateCA()` — self-signed CA for development
- `generateServerCert(ca)` — server certificate signed by CA
- `generateClientCert(ca, cn)` — client certificate with CN = userId
- Use Node.js `crypto` module (no external dependencies)
- Output PEM format files

### 3.3 CLI flag

In `packages/core/src/cli.ts`, add `--tls` flag that enables TLS with auto-generated certs in `dataDir/certs/`.

### 3.4 Tests

Create `packages/core/src/gateway/tls.test.ts`:
- Test TLS server starts with valid certs
- Test client cert authentication
- Test rejection of invalid client certs
- Test fallback to JWT when no client cert
- Test cert generation utility

---

## Part 4: Redis Rate Limit Adapter (P2-014b)

### 4.1 Create `packages/core/src/security/rate-limiter-redis.ts`

**Requirements:**
- Implement the same interface as the in-memory rate limiter
- Use Redis `MULTI`/`EXEC` for atomic sliding window operations:
  ```
  MULTI
  ZADD key timestamp timestamp     # Add current request
  ZREMRANGEBYSCORE key 0 (now - windowMs)  # Remove expired
  ZCARD key                         # Count remaining
  EXPIRE key windowMs               # TTL cleanup
  EXEC
  ```
- Constructor takes `{ redisUrl: string, prefix?: string }`
- Use `ioredis` package (widely used, TypeScript support)
- Expose same `check()`, `checkMultiple()`, `getStats()` interface
- Add `close()` method to disconnect Redis client

### 4.2 Factory pattern

Update `packages/core/src/security/rate-limiter.ts`:
```typescript
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  if (config.redisUrl) {
    return new RedisRateLimiter(config);
  }
  return new InMemoryRateLimiter(config);
}
```

### 4.3 Config update

In `packages/shared/src/types/config.ts`, add to `rateLimiting`:
```typescript
redisUrl?: string  // Optional Redis URL for distributed rate limiting
```

### 4.4 Tests

Create `packages/core/src/security/rate-limiter-redis.test.ts`:
- Mock ioredis for unit tests
- Test sliding window accuracy
- Test atomic operations (concurrent requests)
- Test key expiration
- Test stats reporting
- Integration test with real Redis (skip if not available)

---

## Part 5: Testing & Documentation

### 5.1 Update existing sandbox tests

Add to `packages/core/src/sandbox/sandbox.test.ts`:
- Test SandboxManager selects correct implementation per platform
- Test capability reporting accuracy
- Test violation detection and reporting

### 5.2 Update TODO.md

Mark completed items:
- P2-008 V2: Kernel-level Landlock enforcement
- P2-009: macOS sandbox
- P2-004: mTLS support
- P2-014b: Redis rate limit adapter

### 5.3 Update docs/configuration.md

Add TLS and Redis configuration sections.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/sandbox/landlock-worker.ts` | Create |
| `packages/core/src/sandbox/linux-sandbox.ts` | Modify (add Landlock enforcement) |
| `packages/core/src/sandbox/darwin-sandbox.ts` | Create |
| `packages/core/src/sandbox/manager.ts` | Modify (add Darwin, update Landlock) |
| `packages/core/src/sandbox/landlock.test.ts` | Create |
| `packages/core/src/sandbox/darwin-sandbox.test.ts` | Create |
| `packages/core/src/gateway/server.ts` | Modify (TLS support) |
| `packages/core/src/security/cert-gen.ts` | Create |
| `packages/core/src/gateway/tls.test.ts` | Create |
| `packages/core/src/security/rate-limiter-redis.ts` | Create |
| `packages/core/src/security/rate-limiter.ts` | Modify (factory pattern) |
| `packages/core/src/security/rate-limiter-redis.test.ts` | Create |
| `packages/core/src/cli.ts` | Modify (--tls flag) |
| `docs/configuration.md` | Update |
| `TODO.md` | Update |

---

## Key Design Decisions

1. **Landlock via child process**: Landlock restrictions are irreversible for a process. Using `fork()` lets the main process remain unrestricted while sandboxed code runs in the child.
2. **sandbox-exec for macOS**: While deprecated, it's the only built-in sandboxing mechanism on macOS without App Sandbox entitlements. Document the deprecation and plan for App Sandbox in v2.
3. **Redis sorted sets for rate limiting**: ZRANGEBYSCORE provides true sliding window semantics (more accurate than fixed windows) and is atomic via MULTI/EXEC.
4. **mTLS as optional layer**: Client certs complement (not replace) JWT/API key auth. When present, they take priority.

---

## Acceptance Criteria

- [ ] LinuxSandbox V2 enforces Landlock restrictions on kernel >= 5.13
- [ ] DarwinSandbox restricts filesystem/network access via sandbox-exec
- [ ] SandboxManager auto-selects correct implementation per platform
- [ ] Gateway supports TLS with client certificate authentication
- [ ] Redis rate limiter provides distributed sliding window
- [ ] All existing 589 tests continue to pass
- [ ] New tests pass (~30-40 tests)
- [ ] Configuration docs updated with TLS and Redis options
