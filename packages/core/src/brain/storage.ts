/**
 * Brain Storage — SQLite-backed storage for memories, knowledge, and skills.
 *
 * Follows the same patterns as SoulStorage and AuthStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Memory,
  MemoryCreate,
  MemoryQuery,
  MemoryType,
  KnowledgeEntry,
  KnowledgeCreate,
  KnowledgeQuery,
  SkillFilter,
  BrainStats,
} from './types.js';
import type { Skill, SkillCreate, SkillUpdate } from '@friday/shared';
import { uuidv7 } from '../utils/crypto.js';

// ── Row Types ────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  source: string;
  context: string;
  importance: number;
  access_count: number;
  last_accessed_at: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

interface KnowledgeRow {
  id: string;
  topic: string;
  content: string;
  source: string;
  confidence: number;
  supersedes: string | null;
  created_at: number;
  updated_at: number;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string;
  trigger_patterns: string;
  enabled: number;
  source: string;
  status: string;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

// ── Helpers ──────────────────────────────────────────────────

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    source: row.source,
    context: safeJsonParse<Record<string, string>>(row.context, {}),
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToKnowledge(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    topic: row.topic,
    content: row.content,
    source: row.source,
    confidence: row.confidence,
    supersedes: row.supersedes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    tools: safeJsonParse<Skill['tools']>(row.tools, []),
    triggerPatterns: safeJsonParse<string[]>(row.trigger_patterns, []),
    // ADR 021: Skill Actions
    actions: [],
    // ADR 022: Skill Triggers
    triggers: [],
    // Dependencies
    dependencies: [],
    provides: [],
    // Security
    requireApproval: false,
    allowedPermissions: [],
    enabled: row.enabled === 1,
    source: row.source as Skill['source'],
    status: row.status as Skill['status'],
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── BrainStorage ─────────────────────────────────────────────

export class BrainStorage {
  private db: Database.Database;

  constructor(opts: { dbPath?: string } = {}) {
    const dbPath = opts.dbPath ?? ':memory:';

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN ('episodic','semantic','procedural','preference')),
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        context TEXT NOT NULL DEFAULT '{}',
        importance REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_type_importance ON memories(type, importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_expires ON memories(expires_at) WHERE expires_at IS NOT NULL;

      CREATE TABLE IF NOT EXISTS knowledge (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.8,
        supersedes TEXT REFERENCES knowledge(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_topic ON knowledge(topic);

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        tools TEXT NOT NULL DEFAULT '[]',
        trigger_patterns TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        source TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS brain_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // ── Memories ─────────────────────────────────────────────────

  createMemory(data: MemoryCreate): Memory {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO memories (id, type, content, source, context, importance, access_count, last_accessed_at, expires_at, created_at, updated_at)
         VALUES (@id, @type, @content, @source, @context, @importance, 0, NULL, @expires_at, @created_at, @updated_at)`
      )
      .run({
        id,
        type: data.type,
        content: data.content,
        source: data.source,
        context: JSON.stringify(data.context ?? {}),
        importance: data.importance ?? 0.5,
        expires_at: data.expiresAt ?? null,
        created_at: now,
        updated_at: now,
      });

    const result = this.getMemory(id);
    if (!result) throw new Error(`Failed to retrieve memory after insert: ${id}`);
    return result;
  }

  getMemory(id: string): Memory | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as
      | MemoryRow
      | undefined;
    return row ? rowToMemory(row) : null;
  }

  deleteMemory(id: string): boolean {
    const info = this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return info.changes > 0;
  }

  queryMemories(query: MemoryQuery = {}): Memory[] {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (query.type) {
      sql += ' AND type = @type';
      params.type = query.type;
    }
    if (query.source) {
      sql += ' AND source = @source';
      params.source = query.source;
    }
    if (query.minImportance !== undefined) {
      sql += ' AND importance >= @minImportance';
      params.minImportance = query.minImportance;
    }
    if (query.search) {
      // Split into keywords (3+ chars) for better matching than full-string LIKE
      const keywords = query.search
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter(w => w.length >= 3);
      if (keywords.length > 0) {
        const clauses = keywords.map((kw, idx) => {
          const key = `search_kw_${idx}`;
          params[key] = `%${kw}%`;
          return `content LIKE @${key}`;
        });
        sql += ` AND (${clauses.join(' OR ')})`;
      } else {
        sql += ' AND content LIKE @search';
        params.search = `%${query.search}%`;
      }
    }
    if (query.context) {
      for (const [key, value] of Object.entries(query.context)) {
        const paramKey = `ctx_${key}`;
        sql += ` AND json_extract(context, '$.${key}') = @${paramKey}`;
        params[paramKey] = value;
      }
    }

    sql += ' ORDER BY importance DESC, updated_at DESC';

    if (query.limit) {
      sql += ' LIMIT @limit';
      params.limit = query.limit;
    }

    const rows = this.db.prepare(sql).all(params) as MemoryRow[];
    return rows.map(rowToMemory);
  }

  touchMemory(id: string): void {
    this.db
      .prepare(
        'UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
      )
      .run(Date.now(), id);
  }

  touchMemories(ids: string[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE memories SET access_count = access_count + 1, last_accessed_at = ? WHERE id IN (${placeholders})`
      )
      .run(now, ...ids);
  }

  decayMemories(decayRate: number): number {
    const now = Date.now();
    const oneDayMs = 86_400_000;

    // Reduce importance of memories not accessed in the last day
    const info = this.db
      .prepare(
        `UPDATE memories SET importance = MAX(0, importance - @decayRate), updated_at = @now
         WHERE (last_accessed_at IS NULL OR last_accessed_at < @threshold)
           AND importance > 0`
      )
      .run({
        decayRate,
        now,
        threshold: now - oneDayMs,
      });

    return info.changes;
  }

  pruneExpiredMemories(): number {
    const now = Date.now();
    const info = this.db
      .prepare('DELETE FROM memories WHERE expires_at IS NOT NULL AND expires_at < ?')
      .run(now);
    return info.changes;
  }

  getMemoryCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM memories').get() as {
      count: number;
    };
    return row.count;
  }

  getMemoryCountByType(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type')
      .all() as Array<{ type: string; count: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = row.count;
    }
    return result;
  }

  // ── Knowledge ────────────────────────────────────────────────

  createKnowledge(data: KnowledgeCreate): KnowledgeEntry {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO knowledge (id, topic, content, source, confidence, supersedes, created_at, updated_at)
         VALUES (@id, @topic, @content, @source, @confidence, NULL, @created_at, @updated_at)`
      )
      .run({
        id,
        topic: data.topic,
        content: data.content,
        source: data.source,
        confidence: data.confidence ?? 0.8,
        created_at: now,
        updated_at: now,
      });

    const result = this.getKnowledge(id);
    if (!result) throw new Error(`Failed to retrieve knowledge after insert: ${id}`);
    return result;
  }

  getKnowledge(id: string): KnowledgeEntry | null {
    const row = this.db.prepare('SELECT * FROM knowledge WHERE id = ?').get(id) as
      | KnowledgeRow
      | undefined;
    return row ? rowToKnowledge(row) : null;
  }

  queryKnowledge(query: KnowledgeQuery = {}): KnowledgeEntry[] {
    let sql = 'SELECT * FROM knowledge WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (query.topic) {
      sql += ' AND topic = @topic';
      params.topic = query.topic;
    }
    if (query.search) {
      const keywords = query.search
        .split(/\s+/)
        .map(w => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter(w => w.length >= 3);
      if (keywords.length > 0) {
        const clauses = keywords.map((kw, idx) => {
          const key = `search_kw_${idx}`;
          params[key] = `%${kw}%`;
          return `(content LIKE @${key} OR topic LIKE @${key})`;
        });
        sql += ` AND (${clauses.join(' OR ')})`;
      } else {
        sql += ' AND (content LIKE @search OR topic LIKE @search)';
        params.search = `%${query.search}%`;
      }
    }
    if (query.minConfidence !== undefined) {
      sql += ' AND confidence >= @minConfidence';
      params.minConfidence = query.minConfidence;
    }

    sql += ' ORDER BY confidence DESC, updated_at DESC';

    if (query.limit) {
      sql += ' LIMIT @limit';
      params.limit = query.limit;
    }

    const rows = this.db.prepare(sql).all(params) as KnowledgeRow[];
    return rows.map(rowToKnowledge);
  }

  updateKnowledge(
    id: string,
    data: { content?: string; confidence?: number; supersedes?: string }
  ): KnowledgeEntry {
    const existing = this.getKnowledge(id);
    if (!existing) throw new Error(`Knowledge not found: ${id}`);

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE knowledge SET content = @content, confidence = @confidence, supersedes = @supersedes, updated_at = @updated_at WHERE id = @id`
      )
      .run({
        id,
        content: data.content ?? existing.content,
        confidence: data.confidence ?? existing.confidence,
        supersedes: data.supersedes ?? existing.supersedes,
        updated_at: now,
      });

    return this.getKnowledge(id)!;
  }

  deleteKnowledge(id: string): boolean {
    const info = this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    return info.changes > 0;
  }

  getKnowledgeCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as {
      count: number;
    };
    return row.count;
  }

  // ── Skills ───────────────────────────────────────────────────

  createSkill(data: SkillCreate): Skill {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO skills (id, name, description, instructions, tools, trigger_patterns, enabled, source, status, usage_count, last_used_at, created_at, updated_at)
         VALUES (@id, @name, @description, @instructions, @tools, @trigger_patterns, @enabled, @source, @status, 0, NULL, @created_at, @updated_at)`
      )
      .run({
        id,
        name: data.name,
        description: data.description ?? '',
        instructions: data.instructions ?? '',
        tools: JSON.stringify(data.tools ?? []),
        trigger_patterns: JSON.stringify(data.triggerPatterns ?? []),
        enabled: data.enabled !== false ? 1 : 0,
        source: data.source ?? 'user',
        status: data.status ?? 'active',
        created_at: now,
        updated_at: now,
      });

    const result = this.getSkill(id);
    if (!result) throw new Error(`Failed to retrieve skill after insert: ${id}`);
    return result;
  }

  getSkill(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
    return row ? rowToSkill(row) : null;
  }

  updateSkill(id: string, data: SkillUpdate): Skill {
    const existing = this.getSkill(id);
    if (!existing) throw new Error(`Skill not found: ${id}`);

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE skills SET
           name = @name,
           description = @description,
           instructions = @instructions,
           tools = @tools,
           trigger_patterns = @trigger_patterns,
           enabled = @enabled,
           source = @source,
           status = @status,
           updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        id,
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        instructions: data.instructions ?? existing.instructions,
        tools: JSON.stringify(data.tools ?? existing.tools),
        trigger_patterns: JSON.stringify(data.triggerPatterns ?? existing.triggerPatterns),
        enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
        source: data.source ?? existing.source,
        status: data.status ?? existing.status,
        updated_at: now,
      });

    return this.getSkill(id)!;
  }

  deleteSkill(id: string): boolean {
    const info = this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return info.changes > 0;
  }

  listSkills(filter?: SkillFilter): Skill[] {
    let query = 'SELECT * FROM skills WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (filter?.status) {
      query += ' AND status = @status';
      params.status = filter.status;
    }
    if (filter?.source) {
      query += ' AND source = @source';
      params.source = filter.source;
    }
    if (filter?.enabled !== undefined) {
      query += ' AND enabled = @enabled';
      params.enabled = filter.enabled ? 1 : 0;
    }

    query += ' ORDER BY usage_count DESC, created_at DESC';

    const rows = this.db.prepare(query).all(params) as SkillRow[];
    return rows.map(rowToSkill);
  }

  getEnabledSkills(): Skill[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM skills WHERE enabled = 1 AND status = 'active' ORDER BY usage_count DESC, created_at DESC"
      )
      .all() as SkillRow[];
    return rows.map(rowToSkill);
  }

  getPendingSkills(): Skill[] {
    const rows = this.db
      .prepare("SELECT * FROM skills WHERE status = 'pending_approval' ORDER BY created_at DESC")
      .all() as SkillRow[];
    return rows.map(rowToSkill);
  }

  incrementUsage(skillId: string): void {
    this.db
      .prepare('UPDATE skills SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?')
      .run(Date.now(), skillId);
  }

  getSkillCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM skills').get() as { count: number };
    return row.count;
  }

  // ── Brain Meta ───────────────────────────────────────────────

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM brain_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO brain_meta (key, value, updated_at) VALUES (@key, @value, @updated_at)
         ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at`
      )
      .run({ key, value, updated_at: Date.now() });
  }

  // ── Stats ────────────────────────────────────────────────────

  getStats(): BrainStats {
    return {
      memories: {
        total: this.getMemoryCount(),
        byType: this.getMemoryCountByType(),
      },
      knowledge: {
        total: this.getKnowledgeCount(),
      },
      skills: {
        total: this.getSkillCount(),
      },
    };
  }

  // ── Cleanup ──────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
