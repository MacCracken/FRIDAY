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
  "version": "1.3.1",
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
  "systemPrompt": "You are a professional assistant...",
  "traits": { "formality": "formal", "humor": "none" },
  "sex": "unspecified",
  "voice": "professional, clear",
  "preferredLanguage": "English",
  "defaultModel": { "provider": "anthropic", "model": "claude-sonnet-4-20250514" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name (1-100 chars) |
| `description` | string | No | Short description (max 1000 chars) |
| `systemPrompt` | string | No | Custom system prompt (max 8000 chars) |
| `traits` | object | No | Key-value trait pairs (e.g. formality, humor) |
| `sex` | string | No | `male`, `female`, `non-binary`, `unspecified` |
| `voice` | string | No | Voice style description |
| `preferredLanguage` | string | No | Preferred language for responses |
| `defaultModel` | object\|null | No | Default model `{ provider, model }` for this personality |

#### GET /api/v1/soul/prompt/preview

Preview the composed system prompt. By default uses the active personality; pass `personalityId` to preview a specific personality's prompt.

**Required Permissions**: `soul.read`

**Query Parameters**
- `personalityId` (optional): ID of the personality to preview. Falls back to the active personality if omitted.

**Response**
```json
{
  "prompt": "## Soul\nYour Soul is your identity...",
  "tools": [],
  "charCount": 1234,
  "estimatedTokens": 309
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

#### GET /api/v1/soul/users

List all registered users.

**Response**
```json
{
  "users": [
    {
      "id": "user_abc",
      "name": "Alice",
      "nickname": "Al",
      "relationship": "owner",
      "preferences": { "theme": "dark" },
      "notes": "Primary operator",
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

#### GET /api/v1/soul/owner

Get the user with `relationship: "owner"`.

**Response**
```json
{
  "owner": { "id": "user_abc", "name": "Alice", "relationship": "owner", "..." : "..." }
}
```

#### GET /api/v1/soul/users/:id

Get a specific user by ID.

#### POST /api/v1/soul/users

Create a new user.

**Request Body**
```json
{
  "name": "Alice",
  "nickname": "Al",
  "relationship": "owner",
  "preferences": { "theme": "dark" },
  "notes": "Primary operator"
}
```

Allowed `relationship` values: `owner`, `collaborator`, `user`, `guest`.

#### PUT /api/v1/soul/users/:id

Update an existing user.

#### DELETE /api/v1/soul/users/:id

Delete a user.

---

### Spirit System

#### GET /api/v1/spirit/passions

List all passions.

**Required Permissions**: `spirit.read`

**Response**
```json
{
  "passions": [
    {
      "id": "passion_123",
      "name": "Open Source",
      "description": "Building and contributing to open source software",
      "intensity": 0.9,
      "isActive": true,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ]
}
```

#### POST /api/v1/spirit/passions

Create a new passion.

**Required Permissions**: `spirit.write`

**Request Body**
```json
{
  "name": "Open Source",
  "description": "Building and contributing to open source software",
  "intensity": 0.9,
  "isActive": true
}
```

#### PUT /api/v1/spirit/passions/{id}

Update a passion.

**Required Permissions**: `spirit.write`

#### DELETE /api/v1/spirit/passions/{id}

Delete a passion.

**Required Permissions**: `spirit.write`

#### GET /api/v1/spirit/inspirations

List all inspirations.

**Required Permissions**: `spirit.read`

#### POST /api/v1/spirit/inspirations

Create a new inspiration.

**Required Permissions**: `spirit.write`

**Request Body**
```json
{
  "source": "Alan Turing",
  "description": "Pioneer of computational theory and AI",
  "impact": 0.95,
  "isActive": true
}
```

#### PUT /api/v1/spirit/inspirations/{id}

Update an inspiration.

**Required Permissions**: `spirit.write`

#### DELETE /api/v1/spirit/inspirations/{id}

Delete an inspiration.

**Required Permissions**: `spirit.write`

#### GET /api/v1/spirit/pains

List all pain points.

**Required Permissions**: `spirit.read`

#### POST /api/v1/spirit/pains

Create a new pain point.

**Required Permissions**: `spirit.write`

**Request Body**
```json
{
  "trigger": "Data Loss",
  "description": "Losing user data due to system failure",
  "severity": 0.8,
  "isActive": true
}
```

#### PUT /api/v1/spirit/pains/{id}

Update a pain point.

**Required Permissions**: `spirit.write`

#### DELETE /api/v1/spirit/pains/{id}

Delete a pain point.

**Required Permissions**: `spirit.write`

#### GET /api/v1/spirit/stats

Get spirit system statistics.

**Required Permissions**: `spirit.read`

**Response**
```json
{
  "passions": { "total": 5, "active": 3 },
  "inspirations": { "total": 4, "active": 4 },
  "pains": { "total": 3, "active": 2 }
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

#### GET /api/v1/brain/heartbeat/status

Get heartbeat system status.

**Response**
```json
{
  "running": true,
  "enabled": true,
  "intervalMs": 60000,
  "beatCount": 42,
  "lastBeat": {
    "timestamp": 1700100000000,
    "durationMs": 15,
    "checks": [
      { "name": "system_health", "type": "system_health", "status": "ok", "message": "Memories: 150, Knowledge: 45, Heap: 64/128MB" },
      { "name": "memory_status", "type": "memory_status", "status": "ok", "message": "Maintenance: 2 decayed, 0 pruned" }
    ]
  }
}
```

#### POST /api/v1/brain/heartbeat/beat

Trigger a manual heartbeat check.

**Response**
```json
{
  "result": {
    "timestamp": 1700100000000,
    "durationMs": 15,
    "checks": [ "..." ]
  }
}
```

#### GET /api/v1/brain/heartbeat/history

Get recent heartbeat results (stored as episodic memories with `source: "heartbeat"`).

**Query Parameters**
- `limit` (optional): Number of results (default: 10)

#### GET /api/v1/brain/logs

Query audit logs through the Brain memory-logs bridge.

**Query Parameters**
- `level` (optional): Comma-separated levels (e.g. `error,warn`)
- `event` (optional): Comma-separated event types
- `from` (optional): Start timestamp (Unix ms)
- `to` (optional): End timestamp (Unix ms)
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset
- `order` (optional): `asc` or `desc`

#### GET /api/v1/brain/logs/search

Full-text search audit logs through the Brain.

**Query Parameters**
- `q` (required): FTS5 search query (e.g. `"error OR warning"`, `deploy*`)
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset

#### GET /api/v1/brain/sync/status

Get external brain sync status (Obsidian/git repo/filesystem).

**Response**
```json
{
  "enabled": true,
  "provider": "obsidian",
  "path": "/Users/me/Repos/second-brain",
  "autoSync": false,
  "lastSync": { "memoriesWritten": 10, "knowledgeWritten": 5, "durationMs": 200, "..." : "..." }
}
```

#### POST /api/v1/brain/sync

Trigger a manual sync of memories and knowledge to the external provider.

**Response**
```json
{
  "result": {
    "memoriesWritten": 10,
    "memoriesRemoved": 2,
    "knowledgeWritten": 5,
    "knowledgeRemoved": 0,
    "timestamp": 1700100000000,
    "durationMs": 200
  }
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

### Chat

#### POST /api/v1/chat

Send a message to a personality and receive an AI response. When `personalityId` is provided, the system prompt is composed for that personality; otherwise the active personality is used.

**Required Permissions**: Authenticated

**Request Body**
```json
{
  "message": "Hello, what can you help me with?",
  "personalityId": "p-custom-id",
  "history": [
    { "role": "user", "content": "Previous message" },
    { "role": "assistant", "content": "Previous response" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | The user message |
| `personalityId` | string | No | Target personality ID (falls back to active) |
| `history` | array | No | Previous conversation messages |

**Response**
```json
{
  "role": "assistant",
  "content": "I'm FRIDAY, your AI assistant. I can help with...",
  "model": "claude-sonnet-4-20250514",
  "provider": "anthropic",
  "tokensUsed": 256
}
```

---

### Model Management

#### GET /api/v1/model/info

Get current model configuration and list of all available models. Models are dynamically discovered from each provider's API when the provider's API key is configured. Results are cached for 10 minutes.

**Required Permissions**: Authenticated

**Response**
```json
{
  "current": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "maxTokens": 16384,
    "temperature": 0.7
  },
  "available": {
    "anthropic": [
      {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "inputPer1M": 3,
        "outputPer1M": 15,
        "cachedInputPer1M": 0.3
      }
    ],
    "openai": [
      {
        "provider": "openai",
        "model": "gpt-4o",
        "inputPer1M": 2.5,
        "outputPer1M": 10
      }
    ]
  }
}
```

#### POST /api/v1/model/switch

Switch the AI model at runtime. The switch is not persisted across restarts.

**Required Permissions**: Authenticated

**Request Body**
```json
{
  "provider": "openai",
  "model": "gpt-4o"
}
```

**Response**
```json
{
  "success": true,
  "model": "openai/gpt-4o"
}
```

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

### Integrations

#### GET /api/v1/integrations/platforms

List registered platform adapters.

**Required Permissions**: `integrations.read`

#### GET /api/v1/integrations

List all configured integrations.

**Required Permissions**: `integrations.read`

#### POST /api/v1/integrations

Create a new integration.

**Required Permissions**: `integrations.write`

**Request Body**
```json
{
  "platform": "telegram",
  "displayName": "My Bot",
  "enabled": true,
  "config": { "botToken": "..." }
}
```

#### POST /api/v1/integrations/{id}/start

Start an integration.

**Required Permissions**: `integrations.write`

#### POST /api/v1/integrations/{id}/stop

Stop an integration.

**Required Permissions**: `integrations.write`

#### GET /api/v1/integrations/{id}/messages

List messages for an integration.

**Required Permissions**: `integrations.read`

#### POST /api/v1/integrations/{id}/messages

Send a message via an integration.

**Required Permissions**: `integrations.write`

---

### Webhooks

#### POST /api/v1/webhooks/github/{id}

Receive GitHub webhook events. Verifies HMAC-SHA256 signature against the integration's webhook secret.

**Authentication**: None (verified via webhook signature)

**Headers**
- `X-Hub-Signature-256`: HMAC-SHA256 signature
- `X-GitHub-Event`: Event type (push, pull_request, issues, issue_comment)

---

### Prometheus Metrics

#### GET /metrics

Prometheus text exposition format metrics.

**Authentication**: None

**Response**: Prometheus text format with task, resource, and security metrics.

---

## WebSocket API

See [WebSocket Documentation](websocket-api.md) for real-time updates.

---

## Related Documentation

- [WebSocket API](websocket-api.md)
- [Security Model](../security/security-model.md)
- [Configuration Reference](../configuration.md)