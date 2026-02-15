/**
 * Soul Storage — SQLite-backed storage for personalities and skills.
 *
 * Follows the same patterns as AuthStorage and RotationStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Personality,
  PersonalityCreate,
  PersonalityUpdate,
  Skill,
  SkillCreate,
  SkillUpdate,
  UserProfile,
  UserProfileCreate,
  UserProfileUpdate,
} from './types.js';
import type { SkillFilter } from './types.js';
import { uuidv7 } from '../utils/crypto.js';

interface PersonalityRow {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  traits: string; // JSON
  sex: string;
  voice: string;
  preferred_language: string;
  default_model: string; // JSON | ''
  include_archetypes: number; // 0 | 1
  is_active: number; // 0 | 1
  body: string; // JSON
  created_at: number;
  updated_at: number;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: string; // JSON
  trigger_patterns: string; // JSON
  enabled: number; // 0 | 1
  source: string;
  status: string;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
  updated_at: number;
}

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToPersonality(row: PersonalityRow): Personality {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    traits: safeJsonParse<Record<string, string>>(row.traits, {}),
    sex: row.sex as Personality['sex'],
    voice: row.voice,
    preferredLanguage: row.preferred_language,
    defaultModel: row.default_model
      ? safeJsonParse<Personality['defaultModel']>(row.default_model, null)
      : null,
    includeArchetypes: row.include_archetypes === 1,
    isActive: row.is_active === 1,
    body: safeJsonParse(row.body, {
      enabled: false,
      capabilities: [],
      heartEnabled: true,
      creationConfig: { skills: false, tasks: false, personalities: false, experiments: false },
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface UserRow {
  id: string;
  name: string;
  nickname: string;
  relationship: string;
  preferences: string; // JSON
  notes: string;
  created_at: number;
  updated_at: number;
}

function rowToUser(row: UserRow): UserProfile {
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    relationship: row.relationship as UserProfile['relationship'],
    preferences: safeJsonParse<Record<string, string>>(row.preferences, {}),
    notes: row.notes,
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

export class SoulStorage {
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
      CREATE TABLE IF NOT EXISTS soul_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personalities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        traits TEXT NOT NULL DEFAULT '{}',
        sex TEXT NOT NULL DEFAULT 'unspecified',
        voice TEXT NOT NULL DEFAULT '',
        preferred_language TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        include_archetypes INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        relationship TEXT NOT NULL DEFAULT 'user',
        preferences TEXT NOT NULL DEFAULT '{}',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

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
    `);

    // Migration: add default_model column for existing DBs (v1.4+)
    try {
      this.db.exec(`ALTER TABLE personalities ADD COLUMN default_model TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists
    }

    // Migration: add include_archetypes column (v1.5+)
    try {
      this.db.exec(
        `ALTER TABLE personalities ADD COLUMN include_archetypes INTEGER NOT NULL DEFAULT 1`
      );
    } catch {
      // Column already exists
    }

    // Migration: add body column (v1.6+)
    try {
      this.db.exec(`ALTER TABLE personalities ADD COLUMN body TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // Column already exists
    }
  }

  // ── Personalities ─────────────────────────────────────────────

  createPersonality(data: PersonalityCreate): Personality {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO personalities (id, name, description, system_prompt, traits, sex, voice, preferred_language, default_model, include_archetypes, is_active, body, created_at, updated_at)
         VALUES (@id, @name, @description, @system_prompt, @traits, @sex, @voice, @preferred_language, @default_model, @include_archetypes, @is_active, @body, @created_at, @updated_at)`
      )
      .run({
        id,
        name: data.name,
        description: data.description ?? '',
        system_prompt: data.systemPrompt ?? '',
        traits: JSON.stringify(data.traits ?? {}),
        sex: data.sex ?? 'unspecified',
        voice: data.voice ?? '',
        preferred_language: data.preferredLanguage ?? '',
        default_model: data.defaultModel ? JSON.stringify(data.defaultModel) : '',
        include_archetypes: (data.includeArchetypes ?? true) ? 1 : 0,
        is_active: 0,
        body: JSON.stringify(
          data.body ?? {
            enabled: false,
            capabilities: [],
            heartEnabled: true,
            creationConfig: {
              skills: false,
              tasks: false,
              personalities: false,
              experiments: false,
            },
          }
        ),
        created_at: now,
        updated_at: now,
      });

    const result = this.getPersonality(id);
    if (!result) throw new Error(`Failed to retrieve personality after insert: ${id}`);
    return result;
  }

  getPersonality(id: string): Personality | null {
    const row = this.db.prepare('SELECT * FROM personalities WHERE id = ?').get(id) as
      | PersonalityRow
      | undefined;
    return row ? rowToPersonality(row) : null;
  }

  getActivePersonality(): Personality | null {
    const row = this.db.prepare('SELECT * FROM personalities WHERE is_active = 1 LIMIT 1').get() as
      | PersonalityRow
      | undefined;
    return row ? rowToPersonality(row) : null;
  }

  setActivePersonality(id: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('UPDATE personalities SET is_active = 0 WHERE is_active = 1').run();
      const info = this.db
        .prepare('UPDATE personalities SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), id);
      if (info.changes === 0) {
        throw new Error(`Personality not found: ${id}`);
      }
    });
    txn();
  }

  updatePersonality(id: string, data: PersonalityUpdate): Personality {
    const existing = this.getPersonality(id);
    if (!existing) {
      throw new Error(`Personality not found: ${id}`);
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE personalities SET
           name = @name,
           description = @description,
           system_prompt = @system_prompt,
           traits = @traits,
           sex = @sex,
           voice = @voice,
           preferred_language = @preferred_language,
           default_model = @default_model,
           include_archetypes = @include_archetypes,
           updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        id,
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        system_prompt: data.systemPrompt ?? existing.systemPrompt,
        traits: JSON.stringify(data.traits ?? existing.traits),
        sex: data.sex ?? existing.sex,
        voice: data.voice ?? existing.voice,
        preferred_language: data.preferredLanguage ?? existing.preferredLanguage,
        default_model:
          data.defaultModel !== undefined
            ? data.defaultModel
              ? JSON.stringify(data.defaultModel)
              : ''
            : existing.defaultModel
              ? JSON.stringify(existing.defaultModel)
              : '',
        include_archetypes:
          data.includeArchetypes !== undefined
            ? data.includeArchetypes
              ? 1
              : 0
            : existing.includeArchetypes
              ? 1
              : 0,
        updated_at: now,
      });

    const result = this.getPersonality(id);
    if (!result) throw new Error(`Failed to retrieve personality after update: ${id}`);
    return result;
  }

  deletePersonality(id: string): boolean {
    const info = this.db.prepare('DELETE FROM personalities WHERE id = ?').run(id);
    return info.changes > 0;
  }

  listPersonalities(): Personality[] {
    const rows = this.db
      .prepare('SELECT * FROM personalities ORDER BY created_at DESC')
      .all() as PersonalityRow[];
    return rows.map(rowToPersonality);
  }

  getPersonalityCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM personalities').get() as {
      count: number;
    };
    return row.count;
  }

  // ── Skills ────────────────────────────────────────────────────

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
        enabled: (data.enabled ?? true) ? 1 : 0,
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
    if (!existing) {
      throw new Error(`Skill not found: ${id}`);
    }

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

    const result = this.getSkill(id);
    if (!result) throw new Error(`Failed to retrieve skill after update: ${id}`);
    return result;
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

  // ── Soul Meta ───────────────────────────────────────────────────

  getAgentName(): string | null {
    const row = this.db.prepare('SELECT value FROM soul_meta WHERE key = ?').get('agent_name') as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setAgentName(name: string): void {
    this.db
      .prepare(
        `INSERT INTO soul_meta (key, value, updated_at) VALUES ('agent_name', @value, @updated_at)
         ON CONFLICT(key) DO UPDATE SET value = @value, updated_at = @updated_at`
      )
      .run({ value: name, updated_at: Date.now() });
  }

  // ── Users ───────────────────────────────────────────────────

  createUser(data: UserProfileCreate): UserProfile {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO users (id, name, nickname, relationship, preferences, notes, created_at, updated_at)
         VALUES (@id, @name, @nickname, @relationship, @preferences, @notes, @created_at, @updated_at)`
      )
      .run({
        id,
        name: data.name,
        nickname: data.nickname ?? '',
        relationship: data.relationship ?? 'user',
        preferences: JSON.stringify(data.preferences ?? {}),
        notes: data.notes ?? '',
        created_at: now,
        updated_at: now,
      });

    const result = this.getUser(id);
    if (!result) throw new Error(`Failed to retrieve user after insert: ${id}`);
    return result;
  }

  getUser(id: string): UserProfile | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getUserByName(name: string): UserProfile | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE LIMIT 1')
      .get(name) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  getOwner(): UserProfile | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE relationship = 'owner' LIMIT 1")
      .get() as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  updateUser(id: string, data: UserProfileUpdate): UserProfile {
    const existing = this.getUser(id);
    if (!existing) {
      throw new Error(`User not found: ${id}`);
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE users SET
           name = @name,
           nickname = @nickname,
           relationship = @relationship,
           preferences = @preferences,
           notes = @notes,
           updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        id,
        name: data.name ?? existing.name,
        nickname: data.nickname ?? existing.nickname,
        relationship: data.relationship ?? existing.relationship,
        preferences: JSON.stringify(data.preferences ?? existing.preferences),
        notes: data.notes ?? existing.notes,
        updated_at: now,
      });

    const result = this.getUser(id);
    if (!result) throw new Error(`Failed to retrieve user after update: ${id}`);
    return result;
  }

  deleteUser(id: string): boolean {
    const info = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return info.changes > 0;
  }

  listUsers(): UserProfile[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[];
    return rows.map(rowToUser);
  }

  close(): void {
    this.db.close();
  }
}
