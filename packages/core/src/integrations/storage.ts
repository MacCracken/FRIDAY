/**
 * Integration Storage — SQLite-backed storage for integration configs and messages.
 *
 * Follows the same patterns as SoulStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  IntegrationConfig,
  IntegrationCreate,
  IntegrationUpdate,
  IntegrationStatus,
  UnifiedMessage,
  Platform,
} from '@friday/shared';
import { uuidv7 } from '../utils/crypto.js';

// ─── Row Types ───────────────────────────────────────────────

interface IntegrationRow {
  id: string;
  platform: string;
  display_name: string;
  enabled: number; // 0 | 1
  status: string;
  config: string; // JSON
  connected_at: number | null;
  last_message_at: number | null;
  message_count: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  integration_id: string;
  platform: string;
  direction: string;
  sender_id: string;
  sender_name: string;
  chat_id: string;
  text: string;
  attachments: string; // JSON
  reply_to_message_id: string | null;
  platform_message_id: string | null;
  metadata: string; // JSON
  timestamp: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToConfig(row: IntegrationRow): IntegrationConfig {
  return {
    id: row.id,
    platform: row.platform as Platform,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    status: row.status as IntegrationStatus,
    config: safeJsonParse<Record<string, unknown>>(row.config, {}),
    connectedAt: row.connected_at ?? undefined,
    lastMessageAt: row.last_message_at ?? undefined,
    messageCount: row.message_count,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): UnifiedMessage {
  return {
    id: row.id,
    integrationId: row.integration_id,
    platform: row.platform as Platform,
    direction: row.direction as UnifiedMessage['direction'],
    senderId: row.sender_id,
    senderName: row.sender_name,
    chatId: row.chat_id,
    text: row.text,
    attachments: safeJsonParse(row.attachments, []),
    replyToMessageId: row.reply_to_message_id ?? undefined,
    platformMessageId: row.platform_message_id ?? undefined,
    metadata: safeJsonParse(row.metadata, {}),
    timestamp: row.timestamp,
  };
}

// ─── IntegrationStorage ──────────────────────────────────────

export class IntegrationStorage {
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
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        display_name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'disconnected',
        config TEXT NOT NULL DEFAULT '{}',
        connected_at INTEGER,
        last_message_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS integration_messages (
        id TEXT PRIMARY KEY,
        integration_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        direction TEXT NOT NULL,
        sender_id TEXT NOT NULL DEFAULT '',
        sender_name TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        attachments TEXT NOT NULL DEFAULT '[]',
        reply_to_message_id TEXT,
        platform_message_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_integration ON integration_messages(integration_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON integration_messages(timestamp);
    `);
  }

  // ── Integration CRUD ─────────────────────────────────────

  createIntegration(data: IntegrationCreate): IntegrationConfig {
    const now = Date.now();
    const id = uuidv7();

    this.db.prepare(`
      INSERT INTO integrations (id, platform, display_name, enabled, status, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'disconnected', ?, ?, ?)
    `).run(
      id,
      data.platform,
      data.displayName,
      data.enabled ? 1 : 0,
      JSON.stringify(data.config ?? {}),
      now,
      now,
    );

    return this.getIntegration(id)!;
  }

  getIntegration(id: string): IntegrationConfig | null {
    const row = this.db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as IntegrationRow | undefined;
    return row ? rowToConfig(row) : null;
  }

  listIntegrations(filter?: { platform?: Platform; enabled?: boolean }): IntegrationConfig[] {
    let sql = 'SELECT * FROM integrations WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.platform) {
      sql += ' AND platform = ?';
      params.push(filter.platform);
    }
    if (filter?.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filter.enabled ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as IntegrationRow[];
    return rows.map(rowToConfig);
  }

  updateIntegration(id: string, data: IntegrationUpdate): IntegrationConfig | null {
    const existing = this.getIntegration(id);
    if (!existing) return null;

    const now = Date.now();
    const fields: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];

    if (data.platform !== undefined) { fields.push('platform = ?'); params.push(data.platform); }
    if (data.displayName !== undefined) { fields.push('display_name = ?'); params.push(data.displayName); }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); params.push(data.enabled ? 1 : 0); }
    if (data.config !== undefined) { fields.push('config = ?'); params.push(JSON.stringify(data.config)); }

    this.db.prepare(`UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
    return this.getIntegration(id);
  }

  deleteIntegration(id: string): boolean {
    const result = this.db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Status updates ───────────────────────────────────────

  updateStatus(id: string, status: IntegrationStatus, errorMessage?: string): void {
    const now = Date.now();
    const fields = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [status, now];

    if (status === 'connected') {
      fields.push('connected_at = ?', 'error_message = NULL');
      params.push(now);
    }
    if (errorMessage !== undefined) {
      fields.push('error_message = ?');
      params.push(errorMessage);
    }

    this.db.prepare(`UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  }

  incrementMessageCount(id: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE integrations SET message_count = message_count + 1, last_message_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id);
  }

  // ── Message Storage ──────────────────────────────────────

  storeMessage(message: Omit<UnifiedMessage, 'id'>): UnifiedMessage {
    const id = uuidv7();

    this.db.prepare(`
      INSERT INTO integration_messages
        (id, integration_id, platform, direction, sender_id, sender_name, chat_id, text, attachments, reply_to_message_id, platform_message_id, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      message.integrationId,
      message.platform,
      message.direction,
      message.senderId,
      message.senderName,
      message.chatId,
      message.text,
      JSON.stringify(message.attachments),
      message.replyToMessageId ?? null,
      message.platformMessageId ?? null,
      JSON.stringify(message.metadata),
      message.timestamp,
    );

    this.incrementMessageCount(message.integrationId);
    return { ...message, id };
  }

  listMessages(integrationId: string, opts?: { limit?: number; offset?: number }): UnifiedMessage[] {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    const rows = this.db.prepare(
      'SELECT * FROM integration_messages WHERE integration_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    ).all(integrationId, limit, offset) as MessageRow[];
    return rows.map(rowToMessage);
  }

  // ── Lifecycle ────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
