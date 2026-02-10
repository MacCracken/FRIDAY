/**
 * Auth Storage — SQLite-backed storage for token blacklist and API keys.
 *
 * Follows the same patterns as SQLiteAuditStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  role: string;
  user_id: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  last_used_at: number | null;
}

export class AuthStorage {
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
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        jti TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        revoked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        role TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revoked_at INTEGER,
        last_used_at INTEGER
      );
    `);
  }

  // ── Token revocation ───────────────────────────────────────────────

  revokeToken(jti: string, userId: string, expiresAt: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO revoked_tokens (jti, user_id, revoked_at, expires_at)
         VALUES (@jti, @user_id, @revoked_at, @expires_at)`,
      )
      .run({ jti, user_id: userId, revoked_at: Date.now(), expires_at: expiresAt });
  }

  isTokenRevoked(jti: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?')
      .get(jti) as { 1: number } | undefined;
    return row !== undefined;
  }

  cleanupExpiredTokens(): number {
    const info = this.db
      .prepare('DELETE FROM revoked_tokens WHERE expires_at < ?')
      .run(Date.now());
    return info.changes;
  }

  // ── API keys ───────────────────────────────────────────────────────

  storeApiKey(row: ApiKeyRow): void {
    this.db
      .prepare(
        `INSERT INTO api_keys (id, name, key_hash, key_prefix, role, user_id, created_at, expires_at, revoked_at, last_used_at)
         VALUES (@id, @name, @key_hash, @key_prefix, @role, @user_id, @created_at, @expires_at, @revoked_at, @last_used_at)`,
      )
      .run(row);
  }

  findApiKeyByHash(hash: string): ApiKeyRow | null {
    const row = this.db
      .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
      .get(hash) as ApiKeyRow | undefined;

    if (!row) return null;

    // Check expiry
    if (row.expires_at !== null && row.expires_at < Date.now()) {
      return null;
    }

    return row;
  }

  listApiKeys(userId?: string): Omit<ApiKeyRow, 'key_hash'>[] {
    const query = userId
      ? 'SELECT id, name, key_prefix, role, user_id, created_at, expires_at, revoked_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'
      : 'SELECT id, name, key_prefix, role, user_id, created_at, expires_at, revoked_at, last_used_at FROM api_keys ORDER BY created_at DESC';

    const rows = userId
      ? this.db.prepare(query).all(userId)
      : this.db.prepare(query).all();

    return rows as Omit<ApiKeyRow, 'key_hash'>[];
  }

  revokeApiKey(id: string): boolean {
    const info = this.db
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(Date.now(), id);
    return info.changes > 0;
  }

  updateLastUsed(id: string, ts: number): void {
    this.db
      .prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
      .run(ts, id);
  }

  close(): void {
    this.db.close();
  }
}
