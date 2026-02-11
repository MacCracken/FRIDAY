# REST API Reference

> Complete API documentation for F.R.I.D.A.Y. SecureYeoman system

## Base URL

```
Development: http://localhost:18789
Production: https://your-domain.com
```

## Authentication

### JWT Authentication

```bash
# Login
curl -X POST http://localhost:18789/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}'

# Use token in requests
curl -X GET http://localhost:18789/api/v1/tasks \
  -H "Authorization: Bearer <jwt-token>"
```

### API Key Authentication

```bash
curl -X GET http://localhost:18789/api/v1/tasks \
  -H "X-API-Key: <api-key>"
```

---

## Endpoints

### Health

#### GET /health

Health check endpoint - no authentication required.

**Response**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-11T00:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600
}
```

---

### Authentication

#### POST /api/v1/auth/login

Login with admin password to get JWT tokens.

**Request Body**
```json
{
  "password": "your-admin-password"
}
```

**Response**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

#### POST /api/v1/auth/refresh

Refresh JWT access token.

**Headers**
- `Authorization: Bearer <refresh-token>`

**Response**
```json
{
  "access_token": "eyJ...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

#### POST /api/v1/auth/logout

Logout and revoke refresh token.

**Headers**
- `Authorization: Bearer <access-token>`

**Response**
```json
{
  "message": "Logged out successfully"
}
```

#### GET /api/v1/users/me

Get current user information.

**Headers**
- `Authorization: Bearer <access-token>`

**Response**
```json
{
  "id": "user_123",
  "role": "admin",
  "created_at": "2026-02-11T00:00:00.000Z"
}
```

---

### API Keys

#### POST /api/v1/auth/api-keys

Create new API key.

**Required Permissions**: `api_keys.write`

**Request Body**
```json
{
  "name": "My API Key",
  "permissions": ["tasks.read", "tasks.write"]
}
```

**Response**
```json
{
  "id": "key_123",
  "name": "My API Key",
  "api_key": "sk-...",
  "permissions": ["tasks.read", "tasks.write"],
  "created_at": "2026-02-11T00:00:00.000Z"
}
```

#### POST /api/v1/auth/api-keys/{keyId}/revoke

Revoke API key.

**Required Permissions**: `api_keys.write`

**Response**
```json
{
  "message": "API key revoked successfully"
}
```

---

### Tasks

#### GET /api/v1/tasks

List tasks with filtering and pagination.

**Required Permissions**: `tasks.read`

**Query Parameters**
- `status` (optional): Filter by status (`pending`, `running`, `completed`, `failed`)
- `type` (optional): Filter by type
- `limit` (optional): Number of results (default: 50, max: 100)
- `offset` (optional): Pagination offset (default: 0)
- `from` (optional): ISO date string for start time
- `to` (optional): ISO date string for end time

**Response**
```json
{
  "tasks": [
    {
      "id": "task_123",
      "type": "execute",
      "status": "completed",
      "input": { "command": "echo hello" },
      "output": { "result": "hello" },
      "created_at": "2026-02-11T00:00:00.000Z",
      "started_at": "2026-02-11T00:00:01.000Z",
      "completed_at": "2026-02-11T00:00:02.000Z",
      "duration_ms": 1000,
      "resources": {
        "tokens": { "input": 10, "output": 20, "total": 30 },
        "memory_peak_mb": 128,
        "cpu_time_ms": 500
      }
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### POST /api/v1/tasks

Create new task.

**Required Permissions**: `tasks.write`

**Request Body**
```json
{
  "type": "execute",
  "input": {
    "command": "echo hello"
  },
  "timeout": 30000
}
```

**Response**
```json
{
  "id": "task_456",
  "type": "execute",
  "status": "pending",
  "input": { "command": "echo hello" },
  "created_at": "2026-02-11T00:00:00.000Z",
  "timeout": 30000
}
```

#### GET /api/v1/tasks/{taskId}

Get task details.

**Required Permissions**: `tasks.read`

**Response**
```json
{
  "id": "task_123",
  "type": "execute",
  "status": "completed",
  "input": { "command": "echo hello" },
  "output": { "result": "hello" },
  "created_at": "2026-02-11T00:00:00.000Z",
  "started_at": "2026-02-11T00:00:01.000Z",
  "completed_at": "2026-02-11T00:00:02.000Z",
  "duration_ms": 1000,
  "resources": {
    "tokens": { "input": 10, "output": 20, "total": 30 },
    "memory_peak_mb": 128,
    "cpu_time_ms": 500
  }
}
```

#### DELETE /api/v1/tasks/{taskId}

Cancel task.

**Required Permissions**: `tasks.write`

**Response**
```json
{
  "message": "Task cancelled successfully"
}
```

---

### Metrics

#### GET /api/v1/metrics

Get current system metrics.

**Required Permissions**: `metrics.read`

**Query Parameters**
- `category` (optional): `tasks`, `resources`, `security`, `all` (default: `all`)
- `range` (optional): `1h`, `6h`, `24h`, `7d` (default: `1h`)

**Response**
```json
{
  "tasks": {
    "total": 1000,
    "by_status": {
      "completed": 800,
      "failed": 50,
      "running": 10,
      "pending": 140
    },
    "success_rate": 0.94,
    "avg_duration_ms": 1500
  },
  "resources": {
    "cpu_percent": 45,
    "memory_used_mb": 512,
    "memory_limit_mb": 1024,
    "tokens_used": 50000,
    "tokens_limit": 100000
  },
  "security": {
    "auth_attempts_total": 500,
    "blocked_requests_total": 25,
    "rate_limit_hits_total": 10
  },
  "timestamp": "2026-02-11T00:00:00.000Z"
}
```

#### GET /api/v1/metrics/history

Get historical metrics data.

**Required Permissions**: `metrics.read`

**Query Parameters**
- `category`: Required category (`tasks`, `resources`, `security`)
- `range`: Time range (`1h`, `6h`, `24h`, `7d`)
- `interval`: Data points interval (`1m`, `5m`, `1h`)

**Response**
```json
{
  "category": "tasks",
  "data_points": [
    {
      "timestamp": "2026-02-11T00:00:00.000Z",
      "total": 100,
      "completed": 80,
      "failed": 5
    }
  ]
}
```

---

### Audit Logs

#### GET /api/v1/audit

Get audit log entries.

**Required Permissions**: `audit.read`

**Query Parameters**
- `level` (optional): Filter by level (`info`, `warn`, `error`, `security`)
- `event` (optional): Filter by event type
- `from` (optional): ISO date string for start time
- `to` (optional): ISO date string for end time
- `limit` (optional): Number of results (default: 100)
- `offset` (optional): Pagination offset

**Response**
```json
{
  "entries": [
    {
      "id": "audit_123",
      "timestamp": "2026-02-11T00:00:00.000Z",
      "level": "info",
      "event": "task_completed",
      "message": "Task completed successfully",
      "details": {
        "task_id": "task_123",
        "duration_ms": 1000
      },
      "user_id": "user_123"
    }
  ],
  "total": 1000,
  "limit": 100,
  "offset": 0
}
```

#### POST /api/v1/audit/verify

Verify audit chain integrity.

**Required Permissions**: `audit.verify`

**Response**
```json
{
  "valid": true,
  "entries_verified": 1000,
  "last_verification": "2026-02-11T00:00:00.000Z"
}
```

---

### Security Events

#### GET /api/v1/security/events

Get security events.

**Required Permissions**: `security.read`

**Query Parameters**
- `type` (optional): Event type filter
- `severity` (optional): Severity filter (`info`, `warn`, `error`, `critical`)
- `from` (optional): ISO date string for start time
- `to` (optional): ISO date string for end time
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset

**Response**
```json
{
  "events": [
    {
      "id": "event_123",
      "type": "auth_failure",
      "severity": "warn",
      "message": "Authentication failed for user",
      "details": {
        "user_id": "user_123",
        "ip_address": "192.168.1.1",
        "reason": "invalid_password"
      },
      "timestamp": "2026-02-11T00:00:00.000Z",
      "acknowledged": false
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

---

### Sandbox

#### GET /api/v1/sandbox/status

Get sandbox capabilities and status.

**Required Permissions**: `sandbox.read`

**Response**
```json
{
  "available": true,
  "platform": "linux",
  "capabilities": {
    "landlock": true,
    "seccomp": false,
    "namespaces": ["user", "pid"],
    "rlimits": true
  },
  "current_limits": {
    "memory_mb": 512,
    "cpu_percent": 50,
    "max_file_size_mb": 100
  }
}
```

---

### Soul System

#### GET /api/v1/soul/agent-name

Get current agent name.

**Required Permissions**: `soul.read`

**Response**
```json
{
  "name": "FRIDAY"
}
```

#### PUT /api/v1/soul/agent-name

Update agent name.

**Required Permissions**: `soul.write`

**Request Body**
```json
{
  "name": "MyAgent"
}
```

#### GET /api/v1/soul/personality

Get active personality.

**Required Permissions**: `soul.read`

**Response**
```json
{
  "id": "personality_123",
  "name": "FRIDAY",
  "description": "Friendly and helpful assistant",
  "system_prompt": "You are a helpful assistant...",
  "traits": ["friendly", "helpful"],
  "active": true
}
```

#### GET /api/v1/soul/personalities

List all personalities.

**Required Permissions**: `soul.read`

**Response**
```json
{
  "personalities": [
    {
      "id": "personality_123",
      "name": "FRIDAY",
      "description": "Friendly and helpful assistant",
      "active": true
    }
  ]
}
```

#### POST /api/v1/soul/personalities

Create new personality.

**Required Permissions**: `soul.write`

**Request Body**
```json
{
  "name": "NewAssistant",
  "description": "Professional assistant",
  "system_prompt": "You are a professional assistant...",
  "traits": ["professional", "efficient"]
}
```

#### GET /api/v1/soul/skills

List skills with filtering.

**Required Permissions**: `soul.read`

**Query Parameters**
- `status` (optional): Filter by status (`enabled`, `disabled`, `proposed`)
- `source` (optional): Filter by source (`user_authored`, `ai_proposed`, `autonomous`)

**Response**
```json
{
  "skills": [
    {
      "id": "skill_123",
      "name": "File Operations",
      "description": "Read and write files",
      "status": "enabled",
      "source": "user_authored",
      "created_at": "2026-02-11T00:00:00.000Z"
    }
  ]
}
```

---

### Brain System

#### GET /api/v1/brain/memories

List memories with optional filtering.

**Required Permissions**: `brain.read`

**Query Parameters**
- `type` (optional): Filter by memory type (`episodic`, `semantic`, `procedural`, `preference`)
- `search` (optional): Full-text search across memory content
- `minImportance` (optional): Minimum importance score (0-1)
- `limit` (optional): Number of results (default: 50)

**Response**
```json
{
  "memories": [
    {
      "id": "mem_123",
      "type": "semantic",
      "content": "User prefers dark mode interfaces",
      "source": "conversation",
      "importance": 0.8,
      "context": { "topic": "preferences" },
      "accessCount": 5,
      "createdAt": 1700000000000,
      "lastAccessedAt": 1700100000000
    }
  ]
}
```

#### POST /api/v1/brain/memories

Create a new memory.

**Required Permissions**: `brain.write`

**Request Body**
```json
{
  "type": "semantic",
  "content": "User prefers dark mode interfaces",
  "source": "conversation",
  "importance": 0.8,
  "context": { "topic": "preferences" }
}
```

#### DELETE /api/v1/brain/memories/{memoryId}

Delete a memory.

**Required Permissions**: `brain.write`

#### GET /api/v1/brain/knowledge

Query knowledge entries.

**Required Permissions**: `brain.read`

**Query Parameters**
- `topic` (optional): Filter by topic
- `search` (optional): Full-text search
- `minConfidence` (optional): Minimum confidence score (0-1)
- `limit` (optional): Number of results (default: 50)

**Response**
```json
{
  "knowledge": [
    {
      "id": "know_123",
      "topic": "TypeScript",
      "content": "Use strict mode for better type safety",
      "source": "documentation",
      "confidence": 0.95,
      "createdAt": 1700000000000,
      "updatedAt": 1700100000000
    }
  ]
}
```

#### POST /api/v1/brain/knowledge

Create a new knowledge entry.

**Required Permissions**: `brain.write`

**Request Body**
```json
{
  "topic": "TypeScript",
  "content": "Use strict mode for better type safety",
  "source": "documentation",
  "confidence": 0.95
}
```

#### GET /api/v1/brain/stats

Get brain system statistics.

**Required Permissions**: `brain.read`

**Response**
```json
{
  "stats": {
    "totalMemories": 150,
    "totalKnowledge": 45,
    "totalSkills": 12,
    "memoriesByType": {
      "episodic": 50,
      "semantic": 60,
      "procedural": 25,
      "preference": 15
    }
  }
}
```

#### POST /api/v1/brain/maintenance

Run brain maintenance (decay and prune expired memories).

**Required Permissions**: `brain.write`

**Response**
```json
{
  "decayed": 10,
  "pruned": 3
}
```

---

### Agent Communication (Comms)

#### GET /api/v1/comms/identity

Get this agent's communication identity.

**Required Permissions**: `comms.read`

**Response**
```json
{
  "identity": {
    "id": "agent_abc",
    "name": "FRIDAY",
    "publicKey": "base64...",
    "signingKey": "base64...",
    "endpoint": "http://localhost:18789/api/v1/comms",
    "capabilities": ["chat", "task_delegation"]
  }
}
```

#### GET /api/v1/comms/peers

List known peers.

**Required Permissions**: `comms.read`

#### POST /api/v1/comms/peers

Register a new peer agent.

**Required Permissions**: `comms.write`

**Request Body**
```json
{
  "id": "agent_xyz",
  "name": "JARVIS",
  "publicKey": "base64...",
  "signingKey": "base64...",
  "endpoint": "http://other-host:18789/api/v1/comms",
  "capabilities": ["chat"]
}
```

#### DELETE /api/v1/comms/peers/{peerId}

Remove a peer agent.

**Required Permissions**: `comms.write`

#### POST /api/v1/comms/receive

Receive an encrypted message from a peer. Messages are E2E encrypted using ephemeral X25519 key exchange with AES-256-GCM.

**Request Body**
```json
{
  "id": "msg_123",
  "fromAgentId": "agent_xyz",
  "toAgentId": "agent_abc",
  "ephemeralPublicKey": "base64...",
  "nonce": "base64...",
  "ciphertext": "base64...",
  "signature": "base64...",
  "timestamp": 1700000000000
}
```

#### POST /api/v1/comms/send/{peerId}

Send an encrypted message to a peer.

**Required Permissions**: `comms.write`

**Request Body**
```json
{
  "type": "chat",
  "content": "Hello from FRIDAY",
  "metadata": {}
}
```

#### GET /api/v1/comms/messages

Query the local message log.

**Required Permissions**: `comms.read`

**Query Parameters**
- `peerId` (optional): Filter by peer
- `type` (optional): Filter by message type
- `limit` (optional): Number of results (default: 50)

---

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task with ID 'task_123' not found",
    "details": {
      "task_id": "task_123"
    },
    "timestamp": "2026-02-11T00:00:00.000Z",
    "request_id": "req_123"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
| `TASK_TIMEOUT` | 408 | Task execution timeout |
| `SANDBOX_ERROR` | 422 | Sandbox violation |

---

## Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/v1/auth/login | 5 requests | 15 minutes |
| Task execution | 50 requests | 5 minutes |
| Other API calls | 100 requests | 1 minute |

---

## Pagination

List endpoints support pagination:

- `limit`: Maximum number of items to return (default: 50, max: 100)
- `offset`: Number of items to skip (default: 0)

Responses include pagination metadata:

```json
{
  "items": [...],
  "total": 1000,
  "limit": 50,
  "offset": 0,
  "has_more": true
}
```

---

## WebSocket API

See [WebSocket Documentation](websocket-api.md) for real-time updates.

---

## Related Documentation

- [WebSocket API](websocket-api.md)
- [Security Model](../security/security-model.md)
- [Configuration Reference](../configuration.md)