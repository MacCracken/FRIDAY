/**
 * Brain Storage — PostgreSQL-backed storage for memories, knowledge, and skills.
 *
 * Extends PgBaseStorage for shared pool access, async methods, and transactions.
 */

import { PgBaseStorage } from '../storage/pg-base.js';
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
  KbDocument,
  DocumentCreate,
  KnowledgeHealthStats,
  QueryLogCreate,
  NotebookCorpusDocument,
  ProvenanceScores,
} from './types.js';
import type { Skill, SkillCreate, SkillUpdate } from '@secureyeoman/shared';
import { uuidv7 } from '../utils/crypto.js';

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_MEMORY_IMPORTANCE = 0.5;
const DEFAULT_KNOWLEDGE_CONFIDENCE = 0.8;
const DEFAULT_TRUST_SCORE = 0.5;
const GROUNDING_LOW_THRESHOLD = 0.5;
const SKILL_LIST_LIMIT = 1_000;
const KNOWLEDGE_QUERY_LIMIT = 1_000;
const MS_PER_DAY = 86_400_000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
/** RRF (Reciprocal Rank Fusion) smoothing constant — standard value from the original RRF paper. */
const RRF_CONSTANT = 60.0;
/** RRF fallback rank for missing results — effectively zero contribution. */
const RRF_MAX_RANK = 9999;

// ── Row Types ────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  personality_id: string | null;
  type: string;
  content: string;
  source: string;
  context: Record<string, string>;
  importance: number;
  access_count: number;
  last_accessed_at: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

interface KnowledgeRow {
  id: string;
  personality_id: string | null;
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
  tools: unknown[];
  trigger_patterns: string[];
  enabled: boolean;
  source: string;
  status: string;
  usage_count: number;
  last_used_at: number | null;
  personality_id: string | null;
  created_at: number;
  updated_at: number;
  // Routing quality (Phase 44/49) — columns added by migration 049/051
  use_when?: string;
  do_not_use_when?: string;
  success_criteria?: string;
  mcp_tools_allowed?: unknown[];
  routing?: string;
  autonomy_level?: string;
  invoked_count?: number;
  // Structured output schema (Phase 54) — column added by migration 055
  output_schema?: Record<string, unknown> | null;
}

interface DocumentRow {
  id: string;
  personality_id: string | null;
  title: string;
  filename: string | null;
  format: string | null;
  source_url: string | null;
  visibility: string;
  status: string;
  chunk_count: number;
  error_message: string | null;
  source_quality: unknown | null;
  trust_score: number | null;
  created_at: number;
  updated_at: number;
}

// ── Helpers ──────────────────────────────────────────────────

function safeJsonParseProv(val: unknown): ProvenanceScores | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val as ProvenanceScores;
  try {
    return JSON.parse(val as string) as ProvenanceScores;
  } catch {
    return null;
  }
}

function rowToDocument(row: DocumentRow): KbDocument {
  return {
    id: row.id,
    personalityId: row.personality_id,
    title: row.title,
    filename: row.filename,
    format: row.format as KbDocument['format'],
    sourceUrl: row.source_url,
    visibility: row.visibility as KbDocument['visibility'],
    status: row.status as KbDocument['status'],
    chunkCount: row.chunk_count,
    errorMessage: row.error_message,
    sourceQuality: safeJsonParseProv(row.source_quality),
    trustScore: row.trust_score ?? DEFAULT_TRUST_SCORE,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    personalityId: row.personality_id,
    type: row.type as MemoryType,
    content: row.content,
    source: row.source,
    context: row.context ?? {},
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
    personalityId: row.personality_id,
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
    tools: (row.tools ?? []) as Skill['tools'],
    triggerPatterns: row.trigger_patterns ?? [],
    // Routing quality (Phase 44/49)
    useWhen: row.use_when ?? '',
    doNotUseWhen: row.do_not_use_when ?? '',
    successCriteria: row.success_criteria ?? '',
    mcpToolsAllowed: Array.isArray(row.mcp_tools_allowed)
      ? (row.mcp_tools_allowed as string[])
      : [],
    routing: (row.routing ?? 'fuzzy') as Skill['routing'],
    linkedWorkflowId: null,
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
    enabled: row.enabled,
    source: row.source as Skill['source'],
    status: row.status as Skill['status'],
    usageCount: row.usage_count,
    invokedCount: (row as unknown as { invoked_count?: number }).invoked_count ?? 0,
    lastUsedAt: row.last_used_at,
    personalityId: row.personality_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Autonomy classification (Phase 49)
    autonomyLevel: (row.autonomy_level ?? 'L1') as Skill['autonomyLevel'],
    // Structured output schema (Phase 54)
    outputSchema: row.output_schema ?? null,
    // Optimistic locking (brain.skills doesn't track version — default to 1)
    version: (row as unknown as { version?: number }).version ?? 1,
  };
}

// ── BrainStorage ─────────────────────────────────────────────

export class BrainStorage extends PgBaseStorage {
  // ── Memories ─────────────────────────────────────────────────

  async createMemory(data: MemoryCreate, personalityId?: string): Promise<Memory> {
    const now = Date.now();
    const id = uuidv7();

    await this.query(
      `INSERT INTO brain.memories (id, personality_id, type, content, source, context, importance, access_count, last_accessed_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, NULL, $8, $9, $10)`,
      [
        id,
        personalityId ?? null,
        data.type,
        data.content,
        data.source,
        JSON.stringify(data.context ?? {}),
        data.importance ?? DEFAULT_MEMORY_IMPORTANCE,
        data.expiresAt ?? null,
        now,
        now,
      ]
    );

    const result = await this.getMemory(id);
    if (!result) throw new Error(`Failed to retrieve memory after insert: ${id}`);
    return result;
  }

  async getMemory(id: string): Promise<Memory | null> {
    const row = await this.queryOne<MemoryRow>('SELECT * FROM brain.memories WHERE id = $1', [id]);
    return row ? rowToMemory(row) : null;
  }

  async getMemoryBatch(ids: string[]): Promise<Memory[]> {
    if (ids.length === 0) return [];
    const rows = await this.queryMany<MemoryRow>(
      'SELECT * FROM brain.memories WHERE id = ANY($1)',
      [ids]
    );
    return rows.map(rowToMemory);
  }

  async updateMemory(
    id: string,
    data: {
      content?: string;
      importance?: number;
      type?: MemoryType;
      context?: Record<string, string>;
      expiresAt?: number | null;
    }
  ): Promise<Memory | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (data.content !== undefined) {
      sets.push(`content = $${idx++}`);
      vals.push(data.content);
    }
    if (data.importance !== undefined) {
      sets.push(`importance = $${idx++}`);
      vals.push(data.importance);
    }
    if (data.type !== undefined) {
      sets.push(`type = $${idx++}`);
      vals.push(data.type);
    }
    if (data.context !== undefined) {
      sets.push(`context = $${idx++}`);
      vals.push(JSON.stringify(data.context));
    }
    if (data.expiresAt !== undefined) {
      sets.push(`expires_at = $${idx++}`);
      vals.push(data.expiresAt);
    }

    if (sets.length === 0) return null;

    sets.push(`updated_at = $${idx++}`);
    vals.push(Date.now());
    vals.push(id);

    const row = await this.queryOne<MemoryRow>(
      `UPDATE brain.memories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    return row ? rowToMemory(row) : null;
  }

  async deleteMemory(id: string): Promise<boolean> {
    const count = await this.execute('DELETE FROM brain.memories WHERE id = $1', [id]);
    return count > 0;
  }

  async deleteMemories(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.execute('DELETE FROM brain.memories WHERE id = ANY($1)', [ids]);
  }

  async queryMemories(query: MemoryQuery & { personalityId?: string } = {}): Promise<Memory[]> {
    let sql = 'SELECT * FROM brain.memories WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (query.personalityId) {
      sql += ` AND personality_id = $${idx++}`;
      params.push(query.personalityId);
    }
    if (query.type) {
      sql += ` AND type = $${idx++}`;
      params.push(query.type);
    }
    if (query.source) {
      sql += ` AND source = $${idx++}`;
      params.push(query.source);
    }
    if (query.minImportance !== undefined) {
      sql += ` AND importance >= $${idx++}`;
      params.push(query.minImportance);
    }
    if (query.search) {
      // Split into keywords (3+ chars) for better matching than full-string LIKE
      const keywords = query.search
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((w) => w.length >= 3);
      if (keywords.length > 0) {
        const clauses = keywords.map((kw) => {
          params.push(`%${kw}%`);
          return `content ILIKE $${idx++}`;
        });
        sql += ` AND (${clauses.join(' OR ')})`;
      } else {
        sql += ` AND content ILIKE $${idx++}`;
        params.push(`%${query.search}%`);
      }
    }
    if (query.context) {
      for (const [key, value] of Object.entries(query.context)) {
        if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
          throw new Error(`Invalid context key: ${key}`);
        }
        sql += ` AND context::jsonb->>$${idx++} = $${idx++}`;
        params.push(key, value);
      }
    }

    const sortDir = query.sortDirection === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY importance ${sortDir}, updated_at ${sortDir}`;

    const MAX_QUERY_LIMIT = 1_000;
    const effectiveLimit = Math.min(query.limit ?? MAX_QUERY_LIMIT, MAX_QUERY_LIMIT);
    sql += ` LIMIT $${idx++}`;
    params.push(effectiveLimit);

    if (query.offset) {
      sql += ` OFFSET $${idx++}`;
      params.push(query.offset);
    }

    const rows = await this.queryMany<MemoryRow>(sql, params);
    return rows.map(rowToMemory);
  }

  async touchMemory(id: string): Promise<void> {
    await this.execute(
      'UPDATE brain.memories SET access_count = access_count + 1, last_accessed_at = $1 WHERE id = $2',
      [Date.now(), id]
    );
  }

  async touchMemories(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = Date.now();
    await this.execute(
      `UPDATE brain.memories SET access_count = access_count + 1, last_accessed_at = $1 WHERE id = ANY($2::text[])`,
      [now, ids]
    );
  }

  async decayMemories(decayRate: number): Promise<number> {
    const now = Date.now();
    const oneDayMs = MS_PER_DAY;

    // Reduce importance of memories not accessed in the last day
    const count = await this.execute(
      `UPDATE brain.memories SET importance = GREATEST(0, importance - $1), updated_at = $2
       WHERE (last_accessed_at IS NULL OR last_accessed_at < $3)
         AND importance > 0`,
      [decayRate, now, now - oneDayMs]
    );

    return count;
  }

  async pruneExpiredMemories(): Promise<string[]> {
    const now = Date.now();
    const rows = await this.queryMany<{ id: string }>(
      'DELETE FROM brain.memories WHERE expires_at IS NOT NULL AND expires_at < $1 RETURNING id',
      [now]
    );
    return rows.map((r) => r.id);
  }

  async pruneByImportanceFloor(floor: number): Promise<string[]> {
    const rows = await this.queryMany<{ id: string }>(
      'DELETE FROM brain.memories WHERE importance < $1 AND importance > 0 RETURNING id',
      [floor]
    );
    return rows.map((r) => r.id);
  }

  async getMemoryCount(personalityId?: string): Promise<number> {
    if (personalityId !== undefined) {
      const row = await this.queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM brain.memories WHERE personality_id = $1 OR personality_id IS NULL',
        [personalityId]
      );
      return Number(row?.count ?? 0);
    }
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM brain.memories'
    );
    return Number(row?.count ?? 0);
  }

  async getMemoryCountByType(): Promise<Record<string, number>> {
    const rows = await this.queryMany<{ type: string; count: string }>(
      'SELECT type, COUNT(*) as count FROM brain.memories GROUP BY type'
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.type] = Number(row.count);
    }
    return result;
  }

  // ── Knowledge ────────────────────────────────────────────────

  async createKnowledge(data: KnowledgeCreate, personalityId?: string): Promise<KnowledgeEntry> {
    const now = Date.now();
    const id = uuidv7();

    await this.query(
      `INSERT INTO brain.knowledge (id, personality_id, topic, content, source, confidence, supersedes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
      [
        id,
        personalityId ?? null,
        data.topic,
        data.content,
        data.source,
        data.confidence ?? DEFAULT_KNOWLEDGE_CONFIDENCE,
        now,
        now,
      ]
    );

    const result = await this.getKnowledge(id);
    if (!result) throw new Error(`Failed to retrieve knowledge after insert: ${id}`);
    return result;
  }

  async getKnowledge(id: string): Promise<KnowledgeEntry | null> {
    const row = await this.queryOne<KnowledgeRow>('SELECT * FROM brain.knowledge WHERE id = $1', [
      id,
    ]);
    return row ? rowToKnowledge(row) : null;
  }

  async queryKnowledge(query: KnowledgeQuery = {}): Promise<KnowledgeEntry[]> {
    let sql = 'SELECT * FROM brain.knowledge WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (query.personalityId !== undefined) {
      sql += ` AND (personality_id = $${idx++} OR personality_id IS NULL)`;
      params.push(query.personalityId);
    }

    if (query.topic) {
      sql += ` AND topic = $${idx++}`;
      params.push(query.topic);
    }
    if (query.search) {
      const keywords = query.search
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
        .filter((w) => w.length >= 3);
      if (keywords.length > 0) {
        const clauses = keywords.map((kw) => {
          params.push(`%${kw}%`);
          return `(content ILIKE $${idx} OR topic ILIKE $${idx++})`;
        });
        sql += ` AND (${clauses.join(' OR ')})`;
      } else {
        params.push(`%${query.search}%`);
        sql += ` AND (content ILIKE $${idx} OR topic ILIKE $${idx++})`;
      }
    }
    if (query.minConfidence !== undefined) {
      sql += ` AND confidence >= $${idx++}`;
      params.push(query.minConfidence);
    }

    sql += ' ORDER BY confidence DESC, updated_at DESC';

    const kbLimit = Math.min(query.limit ?? KNOWLEDGE_QUERY_LIMIT, KNOWLEDGE_QUERY_LIMIT);
    sql += ` LIMIT $${idx++}`;
    params.push(kbLimit);

    if (query.offset && query.offset > 0) {
      sql += ` OFFSET $${idx++}`;
      params.push(query.offset);
    }

    const rows = await this.queryMany<KnowledgeRow>(sql, params);
    return rows.map(rowToKnowledge);
  }

  /**
   * Single-query check: returns true when all base-knowledge seeds already exist so that
   * seedBaseKnowledge() can short-circuit without issuing 4+ queries on every startup.
   * Checks the 3 global entries (hierarchy, purpose, interaction) and one self-identity
   * entry per personality.
   */
  async isBaseKnowledgeSeeded(personalityIds: string[]): Promise<boolean> {
    const globalTopics = ['hierarchy', 'purpose', 'interaction'] as const;

    // Count global entries (personality_id IS NULL) for the 3 required topics
    const globalRow = await this.queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM brain.knowledge
       WHERE topic = ANY($1) AND personality_id IS NULL AND source = 'base-knowledge'`,
      [globalTopics]
    );
    if (parseInt(globalRow?.cnt ?? '0', 10) < globalTopics.length) return false;

    if (personalityIds.length === 0) return true;

    // Count scoped self-identity entries for all provided personalities
    const scopedRow = await this.queryOne<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM brain.knowledge
       WHERE topic = 'self-identity' AND personality_id = ANY($1) AND source = 'base-knowledge'`,
      [personalityIds]
    );
    return parseInt(scopedRow?.cnt ?? '0', 10) >= personalityIds.length;
  }

  async updateKnowledge(
    id: string,
    data: { content?: string; confidence?: number; supersedes?: string }
  ): Promise<KnowledgeEntry> {
    const existing = await this.getKnowledge(id);
    if (!existing) throw new Error(`Knowledge not found: ${id}`);

    const now = Date.now();
    await this.execute(
      `UPDATE brain.knowledge SET content = $1, confidence = $2, supersedes = $3, updated_at = $4 WHERE id = $5`,
      [
        data.content ?? existing.content,
        data.confidence ?? existing.confidence,
        data.supersedes ?? existing.supersedes,
        now,
        id,
      ]
    );

    const result = await this.getKnowledge(id);
    if (!result) throw new Error(`Failed to retrieve knowledge after update: ${id}`);
    return result;
  }

  async deleteKnowledge(id: string): Promise<boolean> {
    const count = await this.execute('DELETE FROM brain.knowledge WHERE id = $1', [id]);
    return count > 0;
  }

  async getKnowledgeCount(personalityId?: string): Promise<number> {
    if (personalityId !== undefined) {
      const row = await this.queryOne<{ count: string }>(
        'SELECT COUNT(*) as count FROM brain.knowledge WHERE personality_id = $1 OR personality_id IS NULL',
        [personalityId]
      );
      return Number(row?.count ?? 0);
    }
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM brain.knowledge'
    );
    return Number(row?.count ?? 0);
  }

  // ── Skills ───────────────────────────────────────────────────

  async createSkill(data: SkillCreate): Promise<Skill> {
    const now = Date.now();
    const id = uuidv7();

    await this.query(
      `INSERT INTO brain.skills (id, name, description, instructions, tools, trigger_patterns, use_when, do_not_use_when, success_criteria, mcp_tools_allowed, routing, autonomy_level, output_schema, enabled, source, status, personality_id, usage_count, last_used_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, $14, $15, $16, $17, 0, NULL, $18, $19)`,
      [
        id,
        data.name,
        data.description ?? '',
        data.instructions ?? '',
        JSON.stringify(data.tools ?? []),
        JSON.stringify(data.triggerPatterns ?? []),
        data.useWhen ?? '',
        data.doNotUseWhen ?? '',
        data.successCriteria ?? '',
        JSON.stringify(data.mcpToolsAllowed ?? []),
        data.routing ?? 'fuzzy',
        data.autonomyLevel ?? 'L1',
        data.outputSchema != null ? JSON.stringify(data.outputSchema) : null,
        data.enabled ?? true,
        data.source ?? 'user',
        data.status ?? 'active',
        data.personalityId ?? null,
        now,
        now,
      ]
    );

    const result = await this.getSkill(id);
    if (!result) throw new Error(`Failed to retrieve skill after insert: ${id}`);
    return result;
  }

  async getSkill(id: string): Promise<Skill | null> {
    const row = await this.queryOne<SkillRow>('SELECT * FROM brain.skills WHERE id = $1', [id]);
    return row ? rowToSkill(row) : null;
  }

  async updateSkill(id: string, data: SkillUpdate): Promise<Skill> {
    const existing = await this.getSkill(id);
    if (!existing) throw new Error(`Skill not found: ${id}`);

    const now = Date.now();
    await this.execute(
      `UPDATE brain.skills SET
         name = $1,
         description = $2,
         instructions = $3,
         tools = $4::jsonb,
         trigger_patterns = $5::jsonb,
         use_when = $6,
         do_not_use_when = $7,
         success_criteria = $8,
         mcp_tools_allowed = $9::jsonb,
         routing = $10,
         autonomy_level = $11,
         output_schema = $12::jsonb,
         enabled = $13,
         source = $14,
         status = $15,
         updated_at = $16
       WHERE id = $17`,
      [
        data.name ?? existing.name,
        data.description ?? existing.description,
        data.instructions ?? existing.instructions,
        JSON.stringify(data.tools ?? existing.tools),
        JSON.stringify(data.triggerPatterns ?? existing.triggerPatterns),
        data.useWhen ?? existing.useWhen,
        data.doNotUseWhen ?? existing.doNotUseWhen,
        data.successCriteria ?? existing.successCriteria,
        JSON.stringify(data.mcpToolsAllowed ?? existing.mcpToolsAllowed),
        data.routing ?? existing.routing,
        data.autonomyLevel ?? existing.autonomyLevel,
        data.outputSchema !== undefined
          ? data.outputSchema != null
            ? JSON.stringify(data.outputSchema)
            : null
          : existing.outputSchema != null
            ? JSON.stringify(existing.outputSchema)
            : null,
        data.enabled !== undefined ? data.enabled : existing.enabled,
        data.source ?? existing.source,
        data.status ?? existing.status,
        now,
        id,
      ]
    );

    const result = await this.getSkill(id);
    if (!result) throw new Error(`Failed to retrieve skill after update: ${id}`);
    return result;
  }

  async deleteSkill(id: string): Promise<boolean> {
    const count = await this.execute('DELETE FROM brain.skills WHERE id = $1', [id]);
    return count > 0;
  }

  async listSkills(filter?: SkillFilter): Promise<Skill[]> {
    let sql = 'SELECT * FROM brain.skills WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (filter?.status) {
      sql += ` AND status = $${idx++}`;
      params.push(filter.status);
    }
    if (filter?.source) {
      sql += ` AND source = $${idx++}`;
      params.push(filter.source);
    }
    if (filter?.enabled !== undefined) {
      sql += ` AND enabled = $${idx++}`;
      params.push(filter.enabled);
    }
    if ('personalityId' in (filter ?? {})) {
      if (filter!.personalityId === null) {
        sql += ' AND personality_id IS NULL';
      } else {
        sql += ` AND personality_id = $${idx++}`;
        params.push(filter!.personalityId);
      }
    }
    if (filter?.forPersonalityId) {
      sql += ` AND (personality_id = $${idx} OR personality_id IS NULL)`;
      params.push(filter.forPersonalityId);
    }

    sql += ` ORDER BY usage_count DESC, created_at DESC LIMIT ${SKILL_LIST_LIMIT}`;

    const rows = await this.queryMany<SkillRow>(sql, params);
    return rows.map(rowToSkill);
  }

  async getEnabledSkills(personalityId?: string | null): Promise<Skill[]> {
    let sql: string;
    const params: unknown[] = [];

    if (personalityId !== undefined) {
      // Deduplicate by name: if both a personality-specific and a global skill share the
      // same name, return only one row — preferring the personality-specific record so that
      // per-personality overrides take effect rather than the global fallback appearing twice.
      sql = `
        SELECT DISTINCT ON (name) *
        FROM brain.skills
        WHERE enabled = true AND status = 'active'
          AND (personality_id = $1 OR personality_id IS NULL)
        ORDER BY name,
                 (personality_id IS NOT NULL) DESC,
                 usage_count DESC,
                 created_at DESC
      `;
      params.push(personalityId);
    } else {
      sql =
        "SELECT * FROM brain.skills WHERE enabled = true AND status = 'active' ORDER BY usage_count DESC, created_at DESC";
    }

    const rows = await this.queryMany<SkillRow>(sql, params);
    return rows.map(rowToSkill);
  }

  async getPendingSkills(): Promise<Skill[]> {
    const rows = await this.queryMany<SkillRow>(
      "SELECT * FROM brain.skills WHERE status = 'pending_approval' ORDER BY created_at DESC"
    );
    return rows.map(rowToSkill);
  }

  async incrementUsage(skillId: string): Promise<void> {
    await this.execute(
      'UPDATE brain.skills SET usage_count = usage_count + 1, last_used_at = $1 WHERE id = $2',
      [Date.now(), skillId]
    );
  }

  async getSkillCount(): Promise<number> {
    const row = await this.queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM brain.skills'
    );
    return Number(row?.count ?? 0);
  }

  // ── Hybrid FTS + Vector RRF ─────────────────────────────────

  /**
   * Hybrid Reciprocal Rank Fusion search over brain.memories.
   *
   * Runs both a `tsvector @@ to_tsquery` FTS query and a `pgvector` cosine
   * similarity query independently, then merges results via RRF:
   *   score = Σ 1 / (60 + rank_i)
   *
   * Degrades gracefully when `search_vec` is NULL or embeddings are absent.
   */
  async queryMemoriesByRRF(
    query: string,
    embedding: number[] | null,
    limit: number,
    ftsWeight = 1.0,
    vectorWeight = 1.0,
    /** When set, only return memories for this personality or unscoped (NULL) ones.
     *  When undefined (omnipresent / unscoped query), returns all memories. */
    personalityId?: string
  ): Promise<(Memory & { rrfScore: number })[]> {
    const params: unknown[] = [];
    let idx = 1;

    const tsQuery = query.replace(/[!'()*:&|\\]/g, ' ').trim();
    if (!tsQuery) return [];

    params.push(tsQuery);
    const ftsParam = idx++;

    // Personality scope clause — included in both FTS and vector subqueries
    let personalityClause = '';
    if (personalityId !== undefined) {
      params.push(personalityId);
      const pidParam = idx++;
      personalityClause = `AND (personality_id = $${pidParam} OR personality_id IS NULL)`;
    }

    const ftsSubquery = `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vec, plainto_tsquery('english', $${ftsParam})) DESC) AS fts_rank
      FROM brain.memories
      WHERE search_vec @@ plainto_tsquery('english', $${ftsParam}) ${personalityClause}
    `;

    let vectorSubquery: string;
    if (embedding && embedding.length > 0) {
      const vectorStr = `[${embedding.join(',')}]`;
      params.push(vectorStr);
      const vecParam = idx++;
      vectorSubquery = `
        SELECT id, ROW_NUMBER() OVER (ORDER BY (embedding <=> $${vecParam}::vector) ASC) AS vec_rank
        FROM brain.memories WHERE embedding IS NOT NULL ${personalityClause}
      `;
    } else {
      vectorSubquery = `SELECT id, NULL::bigint AS vec_rank FROM brain.memories WHERE FALSE`;
    }

    params.push(ftsWeight, vectorWeight, limit);
    const fwParam = idx++;
    const vwParam = idx++;
    const limitParam = idx;

    const sql = `
      WITH fts AS (${ftsSubquery}),
           vec AS (${vectorSubquery}),
           combined AS (
             SELECT COALESCE(fts.id, vec.id) AS id,
                    COALESCE($${fwParam}::float / (${RRF_CONSTANT} + COALESCE(fts.fts_rank, ${RRF_MAX_RANK})), 0)
                    + COALESCE($${vwParam}::float / (${RRF_CONSTANT} + COALESCE(vec.vec_rank, ${RRF_MAX_RANK})), 0) AS rrf_score
             FROM fts FULL OUTER JOIN vec ON fts.id = vec.id
           )
      SELECT m.*, c.rrf_score
      FROM combined c JOIN brain.memories m ON m.id = c.id
      ORDER BY c.rrf_score DESC LIMIT $${limitParam}
    `;

    const rows = await this.queryMany<MemoryRow & { rrf_score: number }>(sql, params);
    return rows.map((row) => ({ ...rowToMemory(row), rrfScore: row.rrf_score }));
  }

  /**
   * Hybrid RRF search over brain.knowledge.
   */
  async queryKnowledgeByRRF(
    query: string,
    embedding: number[] | null,
    limit: number,
    ftsWeight = 1.0,
    vectorWeight = 1.0,
    /** When set, only return knowledge for this personality or unscoped (NULL) ones.
     *  When undefined (omnipresent / unscoped query), returns all knowledge. */
    personalityId?: string
  ): Promise<(KnowledgeEntry & { rrfScore: number })[]> {
    const params: unknown[] = [];
    let idx = 1;

    const tsQuery = query.replace(/[!'()*:&|\\]/g, ' ').trim();
    if (!tsQuery) return [];

    params.push(tsQuery);
    const ftsParam = idx++;

    // Personality scope clause
    let personalityClause = '';
    if (personalityId !== undefined) {
      params.push(personalityId);
      const pidParam = idx++;
      personalityClause = `AND (personality_id = $${pidParam} OR personality_id IS NULL)`;
    }

    const ftsSubquery = `
      SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(search_vec, plainto_tsquery('english', $${ftsParam})) DESC) AS fts_rank
      FROM brain.knowledge
      WHERE search_vec @@ plainto_tsquery('english', $${ftsParam}) ${personalityClause}
    `;

    let vectorSubquery: string;
    if (embedding && embedding.length > 0) {
      const vectorStr = `[${embedding.join(',')}]`;
      params.push(vectorStr);
      const vecParam = idx++;
      vectorSubquery = `
        SELECT id, ROW_NUMBER() OVER (ORDER BY (embedding <=> $${vecParam}::vector) ASC) AS vec_rank
        FROM brain.knowledge WHERE embedding IS NOT NULL ${personalityClause}
      `;
    } else {
      vectorSubquery = `SELECT id, NULL::bigint AS vec_rank FROM brain.knowledge WHERE FALSE`;
    }

    params.push(ftsWeight, vectorWeight, limit);
    const fwParam = idx++;
    const vwParam = idx++;
    const limitParam = idx;

    const sql = `
      WITH fts AS (${ftsSubquery}),
           vec AS (${vectorSubquery}),
           combined AS (
             SELECT COALESCE(fts.id, vec.id) AS id,
                    COALESCE($${fwParam}::float / (${RRF_CONSTANT} + COALESCE(fts.fts_rank, ${RRF_MAX_RANK})), 0)
                    + COALESCE($${vwParam}::float / (${RRF_CONSTANT} + COALESCE(vec.vec_rank, ${RRF_MAX_RANK})), 0) AS rrf_score
             FROM fts FULL OUTER JOIN vec ON fts.id = vec.id
           )
      SELECT k.*, c.rrf_score
      FROM combined c JOIN brain.knowledge k ON k.id = c.id
      ORDER BY c.rrf_score DESC LIMIT $${limitParam}
    `;

    const rows = await this.queryMany<KnowledgeRow & { rrf_score: number }>(sql, params);
    return rows.map((row) => ({ ...rowToKnowledge(row), rrfScore: row.rrf_score }));
  }

  // ── Document Chunks ──────────────────────────────────────────

  async createChunks(
    sourceId: string,
    sourceTable: 'memories' | 'knowledge',
    chunks: { id: string; content: string; chunkIndex: number }[]
  ): Promise<void> {
    if (chunks.length === 0) return;
    const now = Date.now();
    const params: unknown[] = [];
    const valueClauses: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      const offset = i * 6;
      valueClauses.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
      );
      params.push(c.id, sourceId, sourceTable, c.chunkIndex, c.content, now);
    }
    await this.query(
      `INSERT INTO brain.document_chunks (id, source_id, source_table, chunk_index, content, created_at)
       VALUES ${valueClauses.join(', ')} ON CONFLICT (id) DO NOTHING`,
      params
    );
  }

  async deleteChunksForSource(sourceId: string): Promise<void> {
    await this.execute('DELETE FROM brain.document_chunks WHERE source_id = $1', [sourceId]);
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.execute('UPDATE brain.document_chunks SET embedding = $1::vector WHERE id = $2', [
      vectorStr,
      chunkId,
    ]);
  }

  async queryChunksByRRF(
    query: string,
    embedding: number[] | null,
    limit: number
  ): Promise<{ sourceId: string; sourceTable: string; content: string; rrfScore: number }[]> {
    const params: unknown[] = [];
    let idx = 1;

    const tsQuery = query.replace(/[!'()*:&|\\]/g, ' ').trim();
    if (!tsQuery) return [];

    params.push(tsQuery);
    const ftsParam = idx++;

    const ftsSubquery = `
      SELECT id, source_id, source_table, content,
             ROW_NUMBER() OVER (ORDER BY ts_rank(search_vec, plainto_tsquery('english', $${ftsParam})) DESC) AS fts_rank
      FROM brain.document_chunks
      WHERE search_vec @@ plainto_tsquery('english', $${ftsParam})
    `;

    let vectorSubquery: string;
    if (embedding && embedding.length > 0) {
      const vectorStr = `[${embedding.join(',')}]`;
      params.push(vectorStr);
      const vecParam = idx++;
      vectorSubquery = `
        SELECT id, source_id, source_table, content,
               ROW_NUMBER() OVER (ORDER BY (embedding <=> $${vecParam}::vector) ASC) AS vec_rank
        FROM brain.document_chunks WHERE embedding IS NOT NULL
      `;
    } else {
      vectorSubquery = `
        SELECT id, source_id, source_table, content, NULL::bigint AS vec_rank
        FROM brain.document_chunks WHERE FALSE
      `;
    }

    params.push(limit);
    const limitParam = idx;

    const sql = `
      WITH fts AS (${ftsSubquery}),
           vec AS (${vectorSubquery}),
           combined AS (
             SELECT COALESCE(fts.id, vec.id) AS id,
                    COALESCE(fts.source_id, vec.source_id) AS source_id,
                    COALESCE(fts.source_table, vec.source_table) AS source_table,
                    COALESCE(fts.content, vec.content) AS content,
                    1.0 / (${RRF_CONSTANT} + COALESCE(fts.fts_rank, ${RRF_MAX_RANK}))
                    + 1.0 / (${RRF_CONSTANT} + COALESCE(vec.vec_rank, ${RRF_MAX_RANK})) AS rrf_score
             FROM fts FULL OUTER JOIN vec ON fts.id = vec.id
           )
      SELECT * FROM combined ORDER BY rrf_score DESC LIMIT $${limitParam}
    `;

    const rows = await this.queryMany<{
      source_id: string;
      source_table: string;
      content: string;
      rrf_score: number;
    }>(sql, params);
    return rows.map((r) => ({
      sourceId: r.source_id,
      sourceTable: r.source_table,
      content: r.content,
      rrfScore: r.rrf_score,
    }));
  }

  // ── Vector Similarity ───────────────────────────────────────────

  async queryMemoriesBySimilarity(
    embedding: number[],
    limit: number,
    threshold: number
  ): Promise<(Memory & { similarity: number })[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await this.queryMany<MemoryRow & { similarity: number }>(
      `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM brain.memories
       WHERE embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $2
       ORDER BY similarity DESC
       LIMIT $3`,
      [vectorStr, threshold, limit]
    );
    return rows.map((row) => ({
      ...rowToMemory(row),
      similarity: row.similarity,
    }));
  }

  async queryKnowledgeBySimilarity(
    embedding: number[],
    limit: number,
    threshold: number
  ): Promise<(KnowledgeEntry & { similarity: number })[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const rows = await this.queryMany<KnowledgeRow & { similarity: number }>(
      `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
       FROM brain.knowledge
       WHERE embedding IS NOT NULL
         AND 1 - (embedding <=> $1::vector) >= $2
       ORDER BY similarity DESC
       LIMIT $3`,
      [vectorStr, threshold, limit]
    );
    return rows.map((row) => ({
      ...rowToKnowledge(row),
      similarity: row.similarity,
    }));
  }

  async updateMemoryEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.execute('UPDATE brain.memories SET embedding = $1::vector WHERE id = $2', [
      vectorStr,
      id,
    ]);
  }

  async updateKnowledgeEmbedding(id: string, embedding: number[]): Promise<void> {
    const vectorStr = `[${embedding.join(',')}]`;
    await this.execute('UPDATE brain.knowledge SET embedding = $1::vector WHERE id = $2', [
      vectorStr,
      id,
    ]);
  }

  // ── Brain Meta ───────────────────────────────────────────────

  async getMeta(key: string): Promise<string | null> {
    const row = await this.queryOne<{ value: string }>(
      'SELECT value FROM brain.meta WHERE key = $1',
      [key]
    );
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.execute(
      `INSERT INTO brain.meta (key, value, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = $3`,
      [key, value, Date.now()]
    );
  }

  async deleteMeta(key: string): Promise<void> {
    await this.execute('DELETE FROM brain.meta WHERE key = $1', [key]);
  }

  // ── Stats ────────────────────────────────────────────────────

  async getStats(personalityId?: string): Promise<BrainStats> {
    return {
      memories: {
        total: await this.getMemoryCount(personalityId),
        byType: await this.getMemoryCountByType(),
      },
      knowledge: {
        total: await this.getKnowledgeCount(personalityId),
      },
      skills: {
        total: await this.getSkillCount(),
      },
    };
  }

  // ── Documents ─────────────────────────────────────────────────

  async createDocument(data: DocumentCreate): Promise<KbDocument> {
    const now = Date.now();
    const id = uuidv7();

    await this.query(
      `INSERT INTO brain.documents (id, personality_id, title, filename, format, source_url, visibility, status, chunk_count, error_message, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, NULL, $9, $10)`,
      [
        id,
        data.personalityId,
        data.title,
        data.filename ?? null,
        data.format ?? null,
        data.sourceUrl ?? null,
        data.visibility,
        data.status,
        now,
        now,
      ]
    );

    const result = await this.getDocument(id);
    if (!result) throw new Error(`Failed to retrieve document after insert: ${id}`);
    return result;
  }

  async getDocument(id: string): Promise<KbDocument | null> {
    const row = await this.queryOne<DocumentRow>('SELECT * FROM brain.documents WHERE id = $1', [
      id,
    ]);
    return row ? rowToDocument(row) : null;
  }

  async updateDocument(id: string, data: Partial<KbDocument>): Promise<KbDocument> {
    const existing = await this.getDocument(id);
    if (!existing) throw new Error(`Document not found: ${id}`);

    const now = Date.now();
    await this.execute(
      `UPDATE brain.documents SET
         title = $1,
         status = $2,
         chunk_count = $3,
         error_message = $4,
         updated_at = $5
       WHERE id = $6`,
      [
        data.title ?? existing.title,
        data.status ?? existing.status,
        data.chunkCount ?? existing.chunkCount,
        data.errorMessage !== undefined ? data.errorMessage : existing.errorMessage,
        now,
        id,
      ]
    );

    const result = await this.getDocument(id);
    if (!result) throw new Error(`Failed to retrieve document after update: ${id}`);
    return result;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const count = await this.execute('DELETE FROM brain.documents WHERE id = $1', [id]);
    return count > 0;
  }

  async listDocuments(opts?: {
    personalityId?: string;
    visibility?: string;
  }): Promise<KbDocument[]> {
    let sql = 'SELECT * FROM brain.documents WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (opts?.personalityId) {
      sql += ` AND (personality_id = $${idx++} OR personality_id IS NULL)`;
      params.push(opts.personalityId);
    }
    if (opts?.visibility) {
      sql += ` AND visibility = $${idx}`;
      params.push(opts.visibility);
    }

    sql += ' ORDER BY created_at DESC';

    const rows = await this.queryMany<DocumentRow>(sql, params);
    return rows.map(rowToDocument);
  }

  async deleteKnowledgeBySourcePrefix(prefix: string): Promise<number> {
    const count = await this.execute('DELETE FROM brain.knowledge WHERE source LIKE $1', [
      prefix + '%',
    ]);
    return count;
  }

  /**
   * Load all document chunks for notebook mode.
   *
   * Returns one entry per document, with chunks concatenated in source-index order
   * (parsed from the `document:{id}:chunk{N}` source field).
   *
   * @param personalityId  When provided, returns chunks scoped to this personality OR global (NULL).
   *                       When null/undefined, returns all chunks across all personalities.
   */
  async getAllDocumentChunks(personalityId?: string | null): Promise<NotebookCorpusDocument[]> {
    let sql = `
      SELECT
        k.content,
        k.source,
        d.id       AS doc_id,
        d.title    AS doc_title,
        d.format   AS doc_format,
        d.chunk_count
      FROM brain.knowledge k
      JOIN brain.documents d
        ON d.id::text = split_part(split_part(k.source, 'document:', 2), ':', 1)
      WHERE k.source LIKE 'document:%:chunk%'
        AND d.status = 'ready'
    `;
    const params: unknown[] = [];
    if (personalityId !== undefined && personalityId !== null) {
      sql += ` AND (k.personality_id = $1 OR k.personality_id IS NULL)`;
      params.push(personalityId);
    }
    sql += ` ORDER BY d.created_at, doc_id`;

    interface ChunkRow {
      content: string;
      source: string;
      doc_id: string;
      doc_title: string;
      doc_format: string | null;
      chunk_count: number | string;
    }

    const rows = await this.queryMany<ChunkRow>(sql, params);

    // Group by document, preserving order
    const docMap = new Map<
      string,
      {
        title: string;
        format: string | null;
        chunkCount: number;
        chunks: { idx: number; text: string }[];
      }
    >();
    for (const row of rows) {
      if (!docMap.has(row.doc_id)) {
        docMap.set(row.doc_id, {
          title: row.doc_title,
          format: row.doc_format,
          chunkCount: Number(row.chunk_count),
          chunks: [],
        });
      }
      // Parse chunk index from source: "document:{id}:chunk{N}"
      const idxMatch = /:chunk(\d+)$/.exec(row.source);
      const idx = idxMatch ? parseInt(idxMatch[1] ?? '0', 10) : 0;
      docMap.get(row.doc_id)!.chunks.push({ idx, text: row.content });
    }

    const result: NotebookCorpusDocument[] = [];
    for (const [docId, doc] of docMap) {
      doc.chunks.sort((a, b) => a.idx - b.idx);
      const text = doc.chunks.map((c) => c.text).join('\n\n');
      result.push({
        docId,
        title: doc.title,
        format: doc.format,
        chunkCount: doc.chunkCount,
        text,
        estimatedTokens: Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE),
      });
    }

    return result;
  }

  // ── Knowledge Query Log ────────────────────────────────────────

  async logKnowledgeQuery(data: QueryLogCreate): Promise<void> {
    const now = Date.now();
    const id = uuidv7();

    await this.query(
      `INSERT INTO brain.knowledge_query_log (id, personality_id, query_text, results_count, top_score, queried_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, data.personalityId, data.queryText, data.resultsCount, data.topScore ?? null, now]
    );
  }

  async getKnowledgeHealthStats(personalityId?: string): Promise<KnowledgeHealthStats> {
    const since24h = Date.now() - MS_PER_DAY;

    // Total documents + chunk sum + by-format breakdown
    let docSql =
      'SELECT COUNT(*) as total, COALESCE(SUM(chunk_count), 0) as total_chunks FROM brain.documents WHERE 1=1';
    const docParams: unknown[] = [];
    if (personalityId) {
      docSql += ' AND (personality_id = $1 OR personality_id IS NULL)';
      docParams.push(personalityId);
    }
    const docRow = await this.queryOne<{ total: string; total_chunks: string }>(docSql, docParams);

    let formatSql = 'SELECT format, COUNT(*) as cnt FROM brain.documents WHERE 1=1';
    const formatParams: unknown[] = [];
    if (personalityId) {
      formatSql += ' AND (personality_id = $1 OR personality_id IS NULL)';
      formatParams.push(personalityId);
    }
    formatSql += ' GROUP BY format';
    const formatRows = await this.queryMany<{ format: string | null; cnt: string }>(
      formatSql,
      formatParams
    );

    const byFormat: Record<string, number> = {};
    for (const r of formatRows) {
      byFormat[r.format ?? 'unknown'] = Number(r.cnt);
    }

    // Query log stats (last 24h)
    let qlSql = `SELECT COUNT(*) as cnt, AVG(top_score) as avg_score FROM brain.knowledge_query_log WHERE queried_at >= $1`;
    const qlParams: unknown[] = [since24h];
    if (personalityId) {
      qlSql += ` AND (personality_id = $2 OR personality_id IS NULL)`;
      qlParams.push(personalityId);
    }
    const qlRow = await this.queryOne<{ cnt: string; avg_score: number | null }>(qlSql, qlParams);

    let lowSql = `SELECT COUNT(*) as cnt FROM brain.knowledge_query_log WHERE queried_at >= $1 AND results_count = 0`;
    const lowParams: unknown[] = [since24h];
    if (personalityId) {
      lowSql += ` AND (personality_id = $2 OR personality_id IS NULL)`;
      lowParams.push(personalityId);
    }
    const lowRow = await this.queryOne<{ cnt: string }>(lowSql, lowParams);

    return {
      totalDocuments: Number(docRow?.total ?? 0),
      totalChunks: Number(docRow?.total_chunks ?? 0),
      byFormat,
      recentQueryCount: Number(qlRow?.cnt ?? 0),
      avgTopScore: qlRow?.avg_score ?? null,
      lowCoverageQueries: Number(lowRow?.cnt ?? 0),
    };
  }

  // ── Provenance (Phase 110) ──────────────────────────────────────

  async updateDocumentProvenance(
    id: string,
    sourceQuality: ProvenanceScores,
    trustScore: number
  ): Promise<KbDocument | null> {
    const now = Date.now();
    await this.query(
      `UPDATE brain.documents SET source_quality = $1, trust_score = $2, updated_at = $3 WHERE id = $4`,
      [JSON.stringify(sourceQuality), trustScore, now, id]
    );
    return this.getDocument(id);
  }

  async getDocumentTrustScore(id: string): Promise<number> {
    const row = await this.queryOne<{ trust_score: number | null }>(
      'SELECT trust_score FROM brain.documents WHERE id = $1',
      [id]
    );
    return row?.trust_score ?? DEFAULT_TRUST_SCORE;
  }

  async getDocumentsByIds(ids: string[]): Promise<KbDocument[]> {
    if (ids.length === 0) return [];
    const rows = await this.queryMany<DocumentRow>(
      'SELECT * FROM brain.documents WHERE id = ANY($1)',
      [ids]
    );
    return rows.map(rowToDocument);
  }

  // ── Citation Feedback (Phase 110) ────────────────────────────────

  async addCitationFeedback(data: {
    messageId: string;
    citationIndex: number;
    sourceId: string;
    relevant: boolean;
  }): Promise<{ id: string }> {
    const id = uuidv7();
    const now = Date.now();
    await this.query(
      `INSERT INTO chat.citation_feedback (id, message_id, citation_index, source_id, relevant, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, data.messageId, data.citationIndex, data.sourceId, data.relevant, now]
    );
    return { id };
  }

  async getCitationFeedback(
    messageId: string
  ): Promise<
    { id: string; citationIndex: number; sourceId: string; relevant: boolean; createdAt: number }[]
  > {
    const rows = await this.queryMany<{
      id: string;
      citation_index: number;
      source_id: string;
      relevant: boolean;
      created_at: number;
    }>('SELECT * FROM chat.citation_feedback WHERE message_id = $1 ORDER BY created_at', [
      messageId,
    ]);
    return rows.map((r) => ({
      id: r.id,
      citationIndex: r.citation_index,
      sourceId: r.source_id,
      relevant: r.relevant,
      createdAt: r.created_at,
    }));
  }

  async getAverageGroundingScore(
    personalityId: string,
    windowDays = 30
  ): Promise<{ averageScore: number | null; totalMessages: number; lowGroundingCount: number }> {
    const since = Date.now() - windowDays * MS_PER_DAY;
    const row = await this.queryOne<{
      avg_score: number | null;
      total: string;
      low_count: string;
    }>(
      `SELECT
         AVG(m.grounding_score) AS avg_score,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE m.grounding_score < ${GROUNDING_LOW_THRESHOLD}) AS low_count
       FROM chat.messages m
       JOIN chat.conversations c ON c.id = m.conversation_id
       WHERE m.grounding_score IS NOT NULL
         AND c.personality_id = $1
         AND m.created_at >= $2`,
      [personalityId, since]
    );
    return {
      averageScore: row?.avg_score ?? null,
      totalMessages: Number(row?.total ?? 0),
      lowGroundingCount: Number(row?.low_count ?? 0),
    };
  }
}
