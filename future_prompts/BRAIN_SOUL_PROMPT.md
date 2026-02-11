# Brain/Soul Separation & E2E Agent Communication Prompt

> Separate the Agent Brain (memory/skill store) from the Soul (personality/character), and implement E2E encrypted communication between FRIDAY agents with locally logged, secret-free message traces.

---

## Context

### Current Soul System

The soul system at `packages/core/src/soul/` currently combines everything into one layer:

**SoulStorage** (`storage.ts`): SQLite with `personalities`, `skills`, and `soul_meta` tables
**SoulManager** (`manager.ts`): Prompt composition, onboarding, skill lifecycle, learning modes
**Types** (`packages/shared/src/types/soul.ts`): Personality, Skill, SoulConfig, Tool schemas
**Wiring**: SecureYeoman initializes SoulStorage → SoulManager at step 5.7

### What's Missing

1. **No memory system**: No conversation history, episodic memory, semantic knowledge, or learned facts
2. **No knowledge store**: Skills have instructions/tools but no structured knowledge base
3. **No agent-to-agent communication**: Single-agent architecture only
4. **No communication encryption**: Integration messages stored in plaintext

### Design Principle

**Brain** = cognitive infrastructure (memory, knowledge, skills, learned patterns)
**Soul** = identity layer (personality, character traits, voice, behavioral directives)
**Soul includes Brain** — the Soul composes the final agent prompt from Brain knowledge + Soul personality

---

## Part 1: Agent Brain

### 1.1 Create `packages/core/src/brain/` directory

The Brain is the memory and skill store that persists knowledge across sessions.

### 1.2 Create `packages/core/src/brain/types.ts`

```typescript
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  source: string;             // where this memory came from (user, task, observation)
  context: Record<string, string>; // tags for retrieval (topic, platform, userId)
  importance: number;         // 0-1 score for retrieval priority
  accessCount: number;
  lastAccessedAt: number | null;
  expiresAt: number | null;   // null = permanent
  createdAt: number;
  updatedAt: number;
}

export type MemoryType =
  | 'episodic'     // conversation/event memories ("user asked about X on Tuesday")
  | 'semantic'     // facts and knowledge ("project uses React 18")
  | 'procedural'   // how-to knowledge ("to deploy, run npm build then docker push")
  | 'preference'   // user preferences ("user prefers concise answers")

export interface MemoryQuery {
  type?: MemoryType;
  source?: string;
  context?: Record<string, string>;
  minImportance?: number;
  limit?: number;
  search?: string;  // text search across content
}

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  source: string;
  confidence: number;  // 0-1, how certain this knowledge is
  supersedes?: string; // id of entry this replaces (for updates)
  createdAt: number;
  updatedAt: number;
}

export interface BrainConfig {
  enabled: boolean;               // default: true
  maxMemories: number;            // default: 10000
  maxKnowledge: number;           // default: 5000
  memoryRetentionDays: number;    // default: 90 (for episodic), permanent for semantic
  importanceDecayRate: number;    // default: 0.01 per day for unaccessed memories
  contextWindowMemories: number;  // default: 10, memories injected into prompt
}
```

### 1.3 Create `packages/core/src/brain/storage.ts`

SQLite-backed storage for brain data. New database: `brain.db`

**Tables:**

```sql
-- Long-term memory store
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('episodic','semantic','procedural','preference')),
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',  -- JSON
  importance REAL NOT NULL DEFAULT 0.5,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance DESC);
CREATE INDEX idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;

-- Structured knowledge base
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  supersedes TEXT REFERENCES knowledge(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_knowledge_topic ON knowledge(topic);

-- Brain metadata (similar to soul_meta)
CREATE TABLE brain_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**Methods:**
- `createMemory(data)`, `getMemory(id)`, `updateMemory(id, data)`, `deleteMemory(id)`
- `queryMemories(query: MemoryQuery)`: Full-text search + filters, ordered by importance
- `decayMemories()`: Reduce importance of unaccessed memories (run periodically)
- `pruneExpiredMemories()`: Delete memories past `expiresAt`
- `createKnowledge(data)`, `getKnowledge(id)`, `queryKnowledge(topic, search?)`
- `updateKnowledge(id, data)`: Sets `supersedes` on old entry when updating facts
- `getStats()`: Memory counts by type, knowledge count, storage size

### 1.4 Create `packages/core/src/brain/manager.ts`

```typescript
export class BrainManager {
  constructor(
    private storage: BrainStorage,
    private config: BrainConfig,
    private deps: { logger: Logger; auditChain: AuditChain }
  ) {}

  // Memory operations
  remember(type: MemoryType, content: string, source: string, context?: Record<string, string>): Memory;
  recall(query: MemoryQuery): Memory[];
  forget(id: string): void;

  // Knowledge operations
  learn(topic: string, content: string, source: string, confidence?: number): KnowledgeEntry;
  lookup(topic: string): KnowledgeEntry[];

  // Prompt integration
  getRelevantContext(input: string, limit?: number): string;
  // Searches memories + knowledge relevant to the input
  // Returns formatted context string for injection into prompt

  // Maintenance
  runMaintenance(): { decayed: number; pruned: number };
  // Called periodically (e.g., daily) to decay/prune

  // Skill store (moved from SoulManager)
  // All skill CRUD operations move here since skills are cognitive, not personality
}
```

### 1.5 Move Skills from Soul to Brain

Skills are cognitive tools — they belong in the Brain, not the Soul:

1. Move `skills` table from `soul.db` → `brain.db`
2. Move skill CRUD methods from `SoulStorage` → `BrainStorage`
3. Move skill lifecycle methods from `SoulManager` → `BrainManager`
4. Keep `SoulManager.composeSoulPrompt()` but have it call `BrainManager.getActiveTools()` and `BrainManager.getRelevantContext()`

**Migration path:**
- `BrainStorage` creates `skills` table in `brain.db`
- On first init, if `soul.db` has skills, migrate them to `brain.db`
- `SoulStorage` retains only `personalities` and `soul_meta`

---

## Part 2: Refactored Soul System

### 2.1 Update `packages/core/src/soul/storage.ts`

Remove skills table and methods. Soul storage now only manages:
- `personalities` table (unchanged)
- `soul_meta` table (unchanged)

### 2.2 Update `packages/core/src/soul/manager.ts`

```typescript
export class SoulManager {
  constructor(
    private storage: SoulStorage,
    private brain: BrainManager,  // NEW: Brain dependency
    private config: SoulConfig,
    private deps: { auditChain: AuditChain; logger: Logger }
  ) {}

  // Personality management (unchanged)
  getActivePersonality(): Personality | null;
  createPersonality(data): Personality;
  // ... etc

  // Prompt composition (updated to include Brain)
  composeSoulPrompt(input?: string): string {
    const parts: string[] = [];

    // 1. Agent identity
    const agentName = this.storage.getAgentName();
    const personality = this.getActivePersonality();
    if (personality) {
      parts.push(`You are ${personality.name}. ${personality.systemPrompt}`);
      // ... traits, voice, sex, language (unchanged)
    }

    // 2. Brain context (NEW)
    if (input) {
      const context = this.brain.getRelevantContext(input);
      if (context) {
        parts.push('## Relevant Context\n' + context);
      }
    }

    // 3. Active skills (now from Brain)
    const skills = this.brain.getActiveSkills();
    for (const skill of skills) {
      parts.push(`## Skill: ${skill.name}\n${skill.instructions}`);
    }

    return parts.join('\n\n');
  }

  // Tools (delegated to Brain)
  getActiveTools(): Tool[] {
    return this.brain.getActiveTools();
  }

  // Skill operations (delegated to Brain)
  createSkill(data) { return this.brain.createSkill(data); }
  // ... etc — these become thin wrappers for backward compatibility
}
```

### 2.3 Update `packages/shared/src/types/soul.ts`

Add BrainConfig to the shared types:

```typescript
export const BrainConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxMemories: z.number().min(100).max(100000).default(10000),
  maxKnowledge: z.number().min(100).max(50000).default(5000),
  memoryRetentionDays: z.number().min(1).max(365).default(90),
  importanceDecayRate: z.number().min(0).max(1).default(0.01),
  contextWindowMemories: z.number().min(0).max(50).default(10),
});
```

### 2.4 Update `packages/shared/src/types/config.ts`

Add `brain` section to the main config schema:

```typescript
brain: BrainConfigSchema.default({})
```

---

## Part 3: E2E Encrypted Agent Communication

### 3.1 Design Overview

FRIDAY agents (separate instances) need to communicate securely:
- Messages encrypted end-to-end (only sender/receiver can read)
- Each agent has a keypair (X25519 for key exchange, Ed25519 for signing)
- Messages logged locally in encrypted form (agent can decrypt its own logs)
- No secrets (API keys, tokens, passwords) appear in any message payload
- Communication over the existing gateway (HTTP/WebSocket)

### 3.2 Create `packages/core/src/comms/types.ts`

```typescript
export interface AgentIdentity {
  id: string;                    // unique agent instance ID
  name: string;                  // human-readable name (e.g., "FRIDAY-Alpha")
  publicKey: string;             // X25519 public key (base64)
  signingKey: string;            // Ed25519 public key (base64)
  endpoint: string;              // reachable URL (e.g., "https://agent1.local:18789")
  capabilities: string[];        // what this agent can do
  lastSeenAt: number;
}

export interface EncryptedMessage {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  ephemeralPublicKey: string;    // X25519 ephemeral key for this message
  nonce: string;                 // base64
  ciphertext: string;            // base64 (encrypted payload)
  signature: string;             // Ed25519 signature over (ciphertext + nonce + fromAgentId)
  timestamp: number;
}

export interface MessagePayload {
  type: MessageType;
  content: string;
  metadata: Record<string, string>;
  // NEVER include: apiKeys, tokens, passwords, secrets
}

export type MessageType =
  | 'task_request'       // ask another agent to perform a task
  | 'task_response'      // response to a task request
  | 'knowledge_share'    // share learned knowledge
  | 'status_update'      // broadcast health/status
  | 'coordination'       // multi-agent coordination signals
```

### 3.3 Create `packages/core/src/comms/crypto.ts`

Agent-to-agent encryption using Node.js crypto:

```typescript
import { createDiffieHellmanGroup, generateKeyPairSync, createCipheriv, createDecipheriv, sign, verify, randomBytes } from 'crypto';

export class AgentCrypto {
  private privateKey: Buffer;     // X25519 private key
  private signingKey: Buffer;     // Ed25519 private key
  public publicKey: string;       // X25519 public key (base64)
  public signingPublicKey: string; // Ed25519 public key (base64)

  constructor(keyStorePath: string) {
    // Load or generate keypair
    // Keys stored encrypted at rest using the existing SecretStore
  }

  // Encrypt message for a specific recipient
  encrypt(payload: MessagePayload, recipientPublicKey: string): {
    ephemeralPublicKey: string;
    nonce: string;
    ciphertext: string;
  };
  // 1. Generate ephemeral X25519 keypair
  // 2. Derive shared secret via ECDH (ephemeral private + recipient public)
  // 3. Derive encryption key via HKDF(shared_secret, nonce)
  // 4. Encrypt payload with AES-256-GCM
  // 5. Return ephemeral public key + nonce + ciphertext

  // Decrypt message from a sender
  decrypt(encrypted: { ephemeralPublicKey: string; nonce: string; ciphertext: string }): MessagePayload;
  // 1. Derive shared secret via ECDH (own private + ephemeral public)
  // 2. Derive decryption key via HKDF
  // 3. Decrypt with AES-256-GCM

  // Sign a message
  sign(data: Buffer): string;

  // Verify a signature
  verify(data: Buffer, signature: string, signingPublicKey: string): boolean;
}

// Secret sanitization — strip any detected secrets from payloads
export function sanitizePayload(payload: MessagePayload): MessagePayload {
  const sensitivePatterns = [
    /sk-[a-zA-Z0-9]{20,}/,       // API keys
    /Bearer\s+[a-zA-Z0-9._-]+/,  // Bearer tokens
    /-----BEGIN\s+\w+\s+KEY-----/, // PEM keys
    /password\s*[:=]\s*\S+/i,     // password assignments
    /secret\s*[:=]\s*\S+/i,       // secret assignments
    /token\s*[:=]\s*\S+/i,        // token assignments
  ];

  let sanitized = payload.content;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  const sanitizedMeta = { ...payload.metadata };
  for (const [key, value] of Object.entries(sanitizedMeta)) {
    if (/key|token|secret|password|credential/i.test(key)) {
      sanitizedMeta[key] = '[REDACTED]';
    }
  }

  return { ...payload, content: sanitized, metadata: sanitizedMeta };
}
```

### 3.4 Create `packages/core/src/comms/agent-comms.ts`

```typescript
export class AgentComms {
  private crypto: AgentCrypto;
  private peers: Map<string, AgentIdentity>;
  private messageLog: CommsStorage;

  constructor(
    private config: CommsConfig,
    private deps: { logger: Logger; auditChain: AuditChain; secretStore: SecretStore }
  ) {}

  // Initialize keypair and load known peers
  async init(): Promise<void>;

  // Register this agent's identity (broadcast to known peers)
  async announce(): Promise<void>;

  // Add a peer agent
  addPeer(identity: AgentIdentity): void;

  // Send encrypted message to a peer
  async send(toAgentId: string, payload: MessagePayload): Promise<string>;
  // 1. Sanitize payload (strip secrets)
  // 2. Encrypt for recipient
  // 3. Sign the ciphertext
  // 4. Log locally (encrypted — only this agent can read its own logs)
  // 5. POST to recipient's endpoint

  // Receive and decrypt a message
  async receive(encrypted: EncryptedMessage): Promise<MessagePayload>;
  // 1. Verify signature against sender's signing key
  // 2. Decrypt payload
  // 3. Log locally (plaintext stored encrypted at rest via CommsStorage)
  // 4. Return decrypted payload

  // Get local message log (decrypted for this agent)
  getMessageLog(query?: { peerId?: string; type?: MessageType; limit?: number }): DecryptedLogEntry[];
}
```

### 3.5 Create `packages/core/src/comms/storage.ts`

Local message log storage. Database: `comms.db`

```sql
-- Known peer agents
CREATE TABLE peers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  signing_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Encrypted message log (local to this agent)
CREATE TABLE message_log (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL CHECK(direction IN ('sent','received')),
  peer_agent_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,  -- agent's own copy, encrypted with own key
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (peer_agent_id) REFERENCES peers(id)
);

CREATE INDEX idx_message_log_peer ON message_log(peer_agent_id);
CREATE INDEX idx_message_log_time ON message_log(timestamp DESC);
```

### 3.6 Register comms routes in gateway

```typescript
// POST /api/v1/comms/message — receive encrypted message from peer
app.post('/api/v1/comms/message', async (request, reply) => {
  const encrypted = request.body as EncryptedMessage;
  // Verify sender is known peer
  // Decrypt and process
  // Return acknowledgment
});

// GET /api/v1/comms/identity — return this agent's public identity
app.get('/api/v1/comms/identity', async (request, reply) => {
  return agentComms.getIdentity();
});

// POST /api/v1/comms/peers — register a new peer (admin only)
app.post('/api/v1/comms/peers', async (request, reply) => {
  // Admin adds a peer agent's identity
});
```

### 3.7 Config expansion

Add to `packages/shared/src/types/config.ts`:

```typescript
comms: {
  enabled: boolean;         // default: false
  agentName: string;        // default: from soul agent name
  listenForPeers: boolean;  // default: true
  maxPeers: number;         // default: 10
  messageRetentionDays: number; // default: 30
}
```

---

## Part 4: Wiring in SecureYeoman

### 4.1 Update initialization sequence

```typescript
// Step 5.7: Initialize Brain
this.brainStorage = new BrainStorage({
  dbPath: `${this.config.core.dataDir}/brain.db`,
});
this.brainManager = new BrainManager(
  this.brainStorage,
  this.config.brain,
  { auditChain: this.auditChain, logger: this.logger.child({ component: 'BrainManager' }) }
);

// Step 5.8: Initialize Soul (now depends on Brain)
this.soulStorage = new SoulStorage({
  dbPath: `${this.config.core.dataDir}/soul.db`,
});
this.soulManager = new SoulManager(
  this.soulStorage,
  this.brainManager,  // NEW: Brain dependency
  this.config.soul,
  { auditChain: this.auditChain, logger: this.logger.child({ component: 'SoulManager' }) }
);

// Step 5.9: Initialize Agent Comms (if enabled)
if (this.config.comms?.enabled) {
  this.agentComms = new AgentComms(
    this.config.comms,
    {
      logger: this.logger.child({ component: 'AgentComms' }),
      auditChain: this.auditChain,
      secretStore: this.secretStore,
    }
  );
  await this.agentComms.init();
}
```

### 4.2 Skill migration on first run

```typescript
// In BrainManager.init() or BrainStorage constructor:
// Check if soul.db has skills that haven't been migrated
// If so, copy them to brain.db and mark as migrated in soul_meta
```

---

## Part 5: REST API Updates

### 5.1 Brain endpoints

```
GET    /api/v1/brain/memories          — query memories (type, search, limit)
POST   /api/v1/brain/memories          — create memory
DELETE /api/v1/brain/memories/:id      — forget a memory
GET    /api/v1/brain/knowledge         — query knowledge (topic, search)
POST   /api/v1/brain/knowledge         — add knowledge entry
GET    /api/v1/brain/stats             — brain statistics
POST   /api/v1/brain/maintenance       — trigger decay/prune (admin)
```

### 5.2 Comms endpoints

```
GET    /api/v1/comms/identity          — this agent's public identity
GET    /api/v1/comms/peers             — list known peers
POST   /api/v1/comms/peers             — add peer (admin)
DELETE /api/v1/comms/peers/:id         — remove peer (admin)
POST   /api/v1/comms/message           — receive encrypted message
GET    /api/v1/comms/log               — view local message log
POST   /api/v1/comms/send              — send message to peer (admin/operator)
```

### 5.3 Backward-compatible soul endpoints

Existing `/api/v1/soul/skills/*` endpoints continue to work but delegate to BrainManager internally.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/brain/types.ts` | Create |
| `packages/core/src/brain/storage.ts` | Create |
| `packages/core/src/brain/manager.ts` | Create |
| `packages/core/src/brain/brain-routes.ts` | Create |
| `packages/core/src/brain/index.ts` | Create |
| `packages/core/src/brain/brain.test.ts` | Create |
| `packages/core/src/comms/types.ts` | Create |
| `packages/core/src/comms/crypto.ts` | Create |
| `packages/core/src/comms/agent-comms.ts` | Create |
| `packages/core/src/comms/storage.ts` | Create |
| `packages/core/src/comms/comms-routes.ts` | Create |
| `packages/core/src/comms/index.ts` | Create |
| `packages/core/src/comms/comms.test.ts` | Create |
| `packages/core/src/soul/storage.ts` | Modify (remove skills) |
| `packages/core/src/soul/manager.ts` | Modify (add Brain dependency, delegate skills) |
| `packages/core/src/soul/soul-routes.ts` | Modify (delegate skill routes to Brain) |
| `packages/core/src/secureyeoman.ts` | Modify (wire Brain + Comms) |
| `packages/core/src/gateway/server.ts` | Modify (register brain + comms routes) |
| `packages/shared/src/types/soul.ts` | Modify (add Brain types) |
| `packages/shared/src/types/config.ts` | Modify (add brain + comms config) |
| `TODO.md` | Update with new phase items |

---

## Acceptance Criteria

- [ ] Brain system stores and retrieves memories (episodic, semantic, procedural, preference)
- [ ] Knowledge base supports topic-based storage with confidence scores
- [ ] Skills migrated from Soul to Brain without data loss
- [ ] Existing `/api/v1/soul/skills/*` endpoints continue to work (backward compat)
- [ ] `composeSoulPrompt()` injects relevant Brain context based on input
- [ ] Memory decay and pruning run correctly on schedule
- [ ] Agent keypair generated and stored securely (encrypted at rest)
- [ ] Messages encrypted end-to-end with X25519 + AES-256-GCM
- [ ] Message signatures verified with Ed25519
- [ ] Secret sanitization strips API keys, tokens, passwords from all payloads
- [ ] Local message log stores agent's own messages (encrypted at rest)
- [ ] Comms routes registered and functional (send, receive, peer management)
- [ ] No secrets appear in any inter-agent message (verified by tests)
- [ ] All existing tests continue to pass
- [ ] At least 80 new tests for Brain + Comms
