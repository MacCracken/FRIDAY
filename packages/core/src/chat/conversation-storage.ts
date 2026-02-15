/**
 * Conversation Storage — SQLite-backed persistence for chat conversations.
 *
 * Follows the same patterns as BrainStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { uuidv7 } from '../utils/crypto.js';

// ── Row Types ────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  title: string;
  personality_id: string | null;
  message_count: number;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  provider: string | null;
  tokens_used: number | null;
  attachments_json: string;
  created_at: number;
}

// ── Domain Types ─────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  personalityId: string | null;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  provider: string | null;
  tokensUsed: number | null;
  attachments: { type: 'image'; data: string; mimeType: string }[];
  createdAt: number;
}

// ── Helpers ──────────────────────────────────────────────────

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    personalityId: row.personality_id,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    model: row.model,
    provider: row.provider,
    tokensUsed: row.tokens_used,
    attachments: safeJsonParse(row.attachments_json, []),
    createdAt: row.created_at,
  };
}

// ── ConversationStorage ──────────────────────────────────────

export class ConversationStorage {
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
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        personality_id TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        model TEXT,
        provider TEXT,
        tokens_used INTEGER,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
    `);
  }

  // ── Conversations ──────────────────────────────────────────

  createConversation(data: { title: string; personalityId?: string | null }): Conversation {
    const now = Date.now();
    const id = uuidv7();

    this.db
      .prepare(
        `INSERT INTO conversations (id, title, personality_id, message_count, created_at, updated_at)
         VALUES (@id, @title, @personality_id, 0, @created_at, @updated_at)`
      )
      .run({
        id,
        title: data.title,
        personality_id: data.personalityId ?? null,
        created_at: now,
        updated_at: now,
      });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined;
    return row ? rowToConversation(row) : null;
  }

  listConversations(opts: { limit?: number; offset?: number } = {}): {
    conversations: Conversation[];
    total: number;
  } {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM conversations')
      .get() as { count: number };

    const rows = this.db
      .prepare('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as ConversationRow[];

    return {
      conversations: rows.map(rowToConversation),
      total: totalRow.count,
    };
  }

  updateConversation(id: string, data: { title?: string }): Conversation {
    const existing = this.getConversation(id);
    if (!existing) throw new Error(`Conversation not found: ${id}`);

    const now = Date.now();
    this.db
      .prepare('UPDATE conversations SET title = @title, updated_at = @updated_at WHERE id = @id')
      .run({
        id,
        title: data.title ?? existing.title,
        updated_at: now,
      });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.getConversation(id)!;
  }

  deleteConversation(id: string): boolean {
    const info = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    return info.changes > 0;
  }

  // ── Messages ───────────────────────────────────────────────

  addMessage(data: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    model?: string | null;
    provider?: string | null;
    tokensUsed?: number | null;
    attachments?: { type: 'image'; data: string; mimeType: string }[];
  }): ConversationMessage {
    const now = Date.now();
    const id = uuidv7();

    const addMsg = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, model, provider, tokens_used, attachments_json, created_at)
           VALUES (@id, @conversation_id, @role, @content, @model, @provider, @tokens_used, @attachments_json, @created_at)`
        )
        .run({
          id,
          conversation_id: data.conversationId,
          role: data.role,
          content: data.content,
          model: data.model ?? null,
          provider: data.provider ?? null,
          tokens_used: data.tokensUsed ?? null,
          attachments_json: JSON.stringify(data.attachments ?? []),
          created_at: now,
        });

      this.db
        .prepare(
          'UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ?'
        )
        .run(now, data.conversationId);
    });

    addMsg();

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.getMessage(id)!;
  }

  getMessage(id: string): ConversationMessage | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      | MessageRow
      | undefined;
    return row ? rowToMessage(row) : null;
  }

  getMessages(conversationId: string, opts: { limit?: number; offset?: number } = {}): ConversationMessage[] {
    const limit = opts.limit ?? 1000;
    const offset = opts.offset ?? 0;

    const rows = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
      )
      .all(conversationId, limit, offset) as MessageRow[];

    return rows.map(rowToMessage);
  }

  // ── Cleanup ────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
