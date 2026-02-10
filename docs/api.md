# API Reference

> Complete REST and WebSocket API documentation for F.R.I.D.A.Y.

---

## Base URL

```
http://localhost:18789
```

The gateway binds to `127.0.0.1:18789` by default (local network only).

---

## Authentication

### Login Flow

1. `POST /api/v1/auth/login` with `{ password }` to get tokens
2. Include `Authorization: Bearer <accessToken>` on all subsequent requests
3. When the access token expires, call `POST /api/v1/auth/refresh` with `{ refreshToken }`
4. Call `POST /api/v1/auth/logout` to revoke the session

### API Key Authentication

As an alternative to JWT, you can create API keys and authenticate with:

```
X-API-Key: sck_...
```

---

## Public Endpoints

These do not require authentication.

### GET /health

Health check.

**Response**
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": true,
    "auditChain": true
  }
}
```

### POST /api/v1/auth/login

Login with the admin password.

**Request**
```json
{
  "password": "your-admin-password"
}
```

**Response**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**Errors**
- `400` — Password is required
- `401` — Invalid password
- `429` — Rate limited (5 attempts per 15 minutes)

---

## Token Management

### POST /api/v1/auth/refresh

Refresh an expired access token. Refresh tokens are single-use (rotation).

**Request**
```json
{
  "refreshToken": "eyJ..."
}
```

**Response**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

### POST /api/v1/auth/logout

Revoke the current session. Requires Bearer token.

**Response**
```json
{
  "message": "Logged out"
}
```

---

## API Keys

### POST /api/v1/auth/api-keys

Create a new API key.

**Request**
```json
{
  "name": "CI Pipeline",
  "role": "operator",
  "expiresInDays": 90
}
```

**Response** `201`
```json
{
  "id": "key_...",
  "name": "CI Pipeline",
  "rawKey": "sck_...",
  "role": "operator",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### GET /api/v1/auth/api-keys

List all API keys for the current user.

**Response**
```json
{
  "keys": [
    {
      "id": "key_...",
      "name": "CI Pipeline",
      "role": "operator",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### DELETE /api/v1/auth/api-keys/:id

Revoke an API key.

**Response**
```json
{
  "message": "API key revoked"
}
```

---

## Metrics

### GET /api/v1/metrics

Current system metrics snapshot.

**Response**
```json
{
  "timestamp": 1706745600000,
  "tasks": {
    "total": 42,
    "byStatus": { "completed": 38, "failed": 2, "running": 1, "pending": 1 },
    "byType": { "execute": 30, "query": 12 },
    "successRate": 0.95,
    "failureRate": 0.05,
    "avgDurationMs": 1500,
    "queueDepth": 1,
    "inProgress": 1
  },
  "resources": {
    "cpuPercent": 12.5,
    "memoryUsedMb": 256.4,
    "memoryLimitMb": 1024,
    "memoryPercent": 25.0,
    "tokensUsedToday": 50000,
    "costUsdToday": 2.34,
    "costUsdMonth": 45.60
  },
  "security": {
    "authAttemptsTotal": 15,
    "authSuccessTotal": 14,
    "authFailuresTotal": 1,
    "activeSessions": 2,
    "blockedRequestsTotal": 3,
    "rateLimitHitsTotal": 1,
    "injectionAttemptsTotal": 0,
    "auditEntriesTotal": 1200,
    "auditChainValid": true
  }
}
```

---

## Tasks

### GET /api/v1/tasks

List tasks with filtering and pagination.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | — | Filter: `pending`, `running`, `completed`, `failed`, `cancelled`, `timeout` |
| `type` | string | — | Filter by task type |
| `limit` | number | 50 | Results per page (max 100) |
| `offset` | number | 0 | Pagination offset |

**Response**
```json
{
  "tasks": [
    {
      "id": "01234567-...",
      "type": "execute",
      "name": "Echo test",
      "status": "completed",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "startedAt": "2026-01-01T00:00:01.000Z",
      "completedAt": "2026-01-01T00:00:02.000Z",
      "durationMs": 1000,
      "result": {
        "success": true
      }
    }
  ],
  "total": 42
}
```

### GET /api/v1/tasks/:id

Get a single task by ID.

**Response** — Same task object as above, or `404`.

---

## Security Events

### GET /api/v1/security/events

Query security-relevant audit entries.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `severity` | string | — | `info`, `warn`, `error`, `critical` |
| `type` | string | — | Event type filter |
| `from` | number | — | Start timestamp (ms) |
| `to` | number | — | End timestamp (ms) |
| `limit` | number | 50 | Results per page |
| `offset` | number | 0 | Pagination offset |

**Security event types:** `auth_success`, `auth_failure`, `rate_limit`, `injection_attempt`, `permission_denied`, `anomaly`, `sandbox_violation`, `config_change`, `secret_access`

**Response**
```json
{
  "events": [
    {
      "id": "evt_...",
      "type": "auth_failure",
      "severity": "warn",
      "message": "Authentication failed",
      "userId": "unknown",
      "ipAddress": "127.0.0.1",
      "timestamp": "2026-01-01T00:00:00.000Z",
      "acknowledged": false
    }
  ],
  "total": 5
}
```

---

## Audit

### GET /api/v1/audit

Query the full audit log.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `from` | number | Start timestamp (ms) |
| `to` | number | End timestamp (ms) |
| `level` | string | `info`, `warn`, `error` |
| `event` | string | Event type filter |
| `userId` | string | Filter by user |
| `taskId` | string | Filter by task |
| `limit` | number | Results per page |
| `offset` | number | Pagination offset |

### POST /api/v1/audit/verify

Verify cryptographic integrity of the audit chain.

**Response**
```json
{
  "valid": true,
  "entriesChecked": 1200
}
```

---

## Sandbox

### GET /api/v1/sandbox/status

Get sandbox capabilities.

**Response**
```json
{
  "enabled": true,
  "technology": "linux-soft",
  "capabilities": {
    "landlock": true,
    "seccomp": false,
    "namespaces": false,
    "rlimits": true,
    "platform": "linux"
  },
  "sandboxType": "LinuxSandbox"
}
```

---

## Soul System

### GET /api/v1/soul/onboarding/status

Check if onboarding is needed.

**Response**
```json
{
  "needed": true,
  "hasPersonality": false,
  "hasAgentName": false
}
```

### POST /api/v1/soul/onboarding/complete

Complete initial setup.

**Request**
```json
{
  "agentName": "FRIDAY",
  "name": "FRIDAY",
  "description": "Helpful AI assistant",
  "systemPrompt": "You are FRIDAY, a helpful assistant.",
  "traits": { "formality": "casual", "humor": "moderate", "verbosity": "concise" }
}
```

### GET /api/v1/soul/agent-name

```json
{ "agentName": "FRIDAY" }
```

### PUT /api/v1/soul/agent-name

```json
{ "agentName": "NewName" }
```

### GET /api/v1/soul/personality

Get the active personality.

### GET /api/v1/soul/personalities

List all personalities.

### POST /api/v1/soul/personalities

Create a new personality.

**Request**
```json
{
  "name": "Professional",
  "description": "Formal and efficient",
  "systemPrompt": "You are a professional assistant.",
  "traits": { "formality": "formal", "humor": "minimal", "verbosity": "concise" },
  "sex": "unspecified",
  "voice": "neutral",
  "preferredLanguage": "en"
}
```

### PUT /api/v1/soul/personalities/:id

Update a personality (partial update supported).

### DELETE /api/v1/soul/personalities/:id

Delete a personality (cannot delete the active one).

### POST /api/v1/soul/personalities/:id/activate

Set a personality as active.

### GET /api/v1/soul/skills

List skills. Query params: `status`, `source`.

### POST /api/v1/soul/skills

Create a skill.

**Request**
```json
{
  "name": "File Search",
  "description": "Search for files by pattern",
  "instructions": "Use glob patterns to find files.",
  "triggerPatterns": ["find files", "search for"],
  "tools": []
}
```

### PUT /api/v1/soul/skills/:id

Update a skill.

### DELETE /api/v1/soul/skills/:id

Delete a skill.

### POST /api/v1/soul/skills/:id/enable

### POST /api/v1/soul/skills/:id/disable

### POST /api/v1/soul/skills/:id/approve

Approve an AI-proposed skill.

### POST /api/v1/soul/skills/:id/reject

Reject an AI-proposed skill.

### GET /api/v1/soul/prompt/preview

Preview the composed system prompt with token count.

### GET /api/v1/soul/config

Get soul system configuration.

---

## Integrations

### GET /api/v1/integrations/platforms

List registered platform adapters.

**Response**
```json
{
  "platforms": ["telegram", "discord"]
}
```

### GET /api/v1/integrations

List configured integrations.

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `platform` | string | Filter by platform |
| `enabled` | string | `true` or `false` |

**Response**
```json
{
  "integrations": [
    {
      "id": "01234567-...",
      "platform": "telegram",
      "displayName": "My Telegram Bot",
      "enabled": true,
      "status": "connected",
      "config": {},
      "connectedAt": 1706745600000,
      "lastMessageAt": 1706746000000,
      "messageCount": 42,
      "createdAt": 1706745600000,
      "updatedAt": 1706745600000
    }
  ],
  "total": 1,
  "running": 1
}
```

### GET /api/v1/integrations/:id

Get a single integration with runtime status.

### POST /api/v1/integrations

Create a new integration.

**Request**
```json
{
  "platform": "telegram",
  "displayName": "My Telegram Bot",
  "enabled": true,
  "config": {
    "botToken": "123456:ABC-DEF..."
  }
}
```

### PUT /api/v1/integrations/:id

Update an integration (partial update supported).

### DELETE /api/v1/integrations/:id

Delete an integration. Stops it if running.

### POST /api/v1/integrations/:id/start

Start an integration (must be enabled).

### POST /api/v1/integrations/:id/stop

Stop a running integration.

### GET /api/v1/integrations/:id/messages

List messages for an integration.

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Results per page |
| `offset` | number | 0 | Pagination offset |

### POST /api/v1/integrations/:id/messages

Send a message through an integration.

**Request**
```json
{
  "chatId": "123456",
  "text": "Hello from FRIDAY!"
}
```

---

## WebSocket

### Connection

```
ws://localhost:18789/ws/metrics
```

The WebSocket endpoint does not currently require authentication (local-network-only restriction applies).

### Message Format

**Subscribe to channels:**
```json
{
  "type": "subscribe",
  "payload": {
    "channels": ["metrics", "tasks", "security"]
  }
}
```

**Server update:**
```json
{
  "type": "update",
  "channel": "metrics",
  "payload": { ... },
  "timestamp": 1706745600000,
  "sequence": 42
}
```

### Channels

| Channel | Description | Events |
|---------|-------------|--------|
| `metrics` | Real-time resource metrics | `update` |
| `tasks` | Task lifecycle events | `created`, `started`, `completed`, `failed` |
| `security` | Security events | `auth`, `rate_limit`, `injection`, `anomaly` |

---

## Error Format

All error responses use this format:

```json
{
  "error": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `400` | Bad request / validation error |
| `401` | Missing or invalid authentication |
| `403` | Insufficient permissions (RBAC) |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Internal server error |

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /api/v1/auth/login` | 5 requests | 15 minutes |
| All other endpoints | 100 requests | 1 minute |

Rate limit headers are included in responses when limits are approached.

---

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all resources |
| `operator` | Read/write access to tasks, soul, integrations, metrics |
| `auditor` | Read access to audit logs, security events, metrics |
| `viewer` | Read-only access to metrics and tasks |

---

## Related Documentation

- [Installation Guide](installation.md)
- [Configuration Reference](configuration.md)
- [Security Model](security/security-model.md)
- [WebSocket API](api/websocket-api.md)
