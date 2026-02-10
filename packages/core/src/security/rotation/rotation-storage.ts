/**
 * Rotation Storage — SQLite-backed metadata and previous-value storage
 * for secret rotation grace periods.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecretMetadata } from './types.js';

export class RotationStorage {
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
      CREATE TABLE IF NOT EXISTS secret_metadata (
        name TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        rotated_at INTEGER,
        rotation_interval_days INTEGER,
        auto_rotate INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'external',
        category TEXT NOT NULL DEFAULT 'encryption'
      );

      CREATE TABLE IF NOT EXISTS secret_previous_values (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        stored_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  upsert(meta: SecretMetadata): void {
    this.db
      .prepare(
        `INSERT INTO secret_metadata (name, created_at, expires_at, rotated_at, rotation_interval_days, auto_rotate, source, category)
         VALUES (@name, @created_at, @expires_at, @rotated_at, @rotation_interval_days, @auto_rotate, @source, @category)
         ON CONFLICT(name) DO UPDATE SET
           expires_at = @expires_at,
           rotated_at = @rotated_at,
           rotation_interval_days = @rotation_interval_days,
           auto_rotate = @auto_rotate,
           source = @source,
           category = @category`,
      )
      .run({
        name: meta.name,
        created_at: meta.createdAt,
        expires_at: meta.expiresAt,
        rotated_at: meta.rotatedAt,
        rotation_interval_days: meta.rotationIntervalDays,
        auto_rotate: meta.autoRotate ? 1 : 0,
        source: meta.source,
        category: meta.category,
      });
  }

  get(name: string): SecretMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM secret_metadata WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined;

    return row ? this.rowToMeta(row) : null;
  }

  getAll(): SecretMetadata[] {
    const rows = this.db
      .prepare('SELECT * FROM secret_metadata ORDER BY name')
      .all() as Record<string, unknown>[];

    return rows.map((r) => this.rowToMeta(r));
  }

  updateRotation(name: string, rotatedAt: number, expiresAt: number | null): void {
    this.db
      .prepare(
        'UPDATE secret_metadata SET rotated_at = ?, expires_at = ? WHERE name = ?',
      )
      .run(rotatedAt, expiresAt, name);
  }

  storePreviousValue(name: string, value: string, gracePeriodMs: number): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO secret_previous_values (name, value, stored_at, expires_at)
         VALUES (@name, @value, @stored_at, @expires_at)
         ON CONFLICT(name) DO UPDATE SET
           value = @value,
           stored_at = @stored_at,
           expires_at = @expires_at`,
      )
      .run({
        name,
        value,
        stored_at: now,
        expires_at: now + gracePeriodMs,
      });
  }

  getPreviousValue(name: string): string | null {
    const row = this.db
      .prepare(
        'SELECT value, expires_at FROM secret_previous_values WHERE name = ?',
      )
      .get(name) as { value: string; expires_at: number } | undefined;

    if (!row) return null;

    // Expired?
    if (row.expires_at < Date.now()) {
      this.clearPreviousValue(name);
      return null;
    }

    return row.value;
  }

  clearPreviousValue(name: string): void {
    this.db
      .prepare('DELETE FROM secret_previous_values WHERE name = ?')
      .run(name);
  }

  close(): void {
    this.db.close();
  }

  private rowToMeta(row: Record<string, unknown>): SecretMetadata {
    return {
      name: row.name as string,
      createdAt: row.created_at as number,
      expiresAt: (row.expires_at as number) ?? null,
      rotatedAt: (row.rotated_at as number) ?? null,
      rotationIntervalDays: (row.rotation_interval_days as number) ?? null,
      autoRotate: (row.auto_rotate as number) === 1,
      source: row.source as 'internal' | 'external',
      category: row.category as SecretMetadata['category'],
    };
  }
}
