/**
 * Comms Storage — SQLite-backed storage for peer agents and message logs.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentIdentity, MessageType, MessageLogQuery } from './types.js';
import { uuidv7 } from '../utils/crypto.js';

interface PeerRow {
  id: string;
  name: string;
  public_key: string;
  signing_key: string;
  endpoint: string;
  capabilities: string;
  last_seen_at: number;
  created_at: number;
}

interface MessageLogRow {
  id: string;
  direction: string;
  peer_agent_id: string;
  message_type: string;
  encrypted_payload: string;
  timestamp: number;
}

function rowToPeer(row: PeerRow): AgentIdentity {
  return {
    id: row.id,
    name: row.name,
    publicKey: row.public_key,
    signingKey: row.signing_key,
    endpoint: row.endpoint,
    capabilities: JSON.parse(row.capabilities) as string[],
    lastSeenAt: row.last_seen_at,
  };
}

export class CommsStorage {
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
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        signing_key TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        capabilities TEXT NOT NULL DEFAULT '[]',
        last_seen_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_log (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK(direction IN ('sent','received')),
        peer_agent_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        encrypted_payload TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_message_log_peer ON message_log(peer_agent_id);
      CREATE INDEX IF NOT EXISTS idx_message_log_time ON message_log(timestamp DESC);
    `);
  }

  // ── Peers ────────────────────────────────────────────────────

  addPeer(identity: AgentIdentity): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO peers (id, name, public_key, signing_key, endpoint, capabilities, last_seen_at, created_at)
         VALUES (@id, @name, @public_key, @signing_key, @endpoint, @capabilities, @last_seen_at, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           name = @name, public_key = @public_key, signing_key = @signing_key,
           endpoint = @endpoint, capabilities = @capabilities, last_seen_at = @last_seen_at`,
      )
      .run({
        id: identity.id,
        name: identity.name,
        public_key: identity.publicKey,
        signing_key: identity.signingKey,
        endpoint: identity.endpoint,
        capabilities: JSON.stringify(identity.capabilities),
        last_seen_at: identity.lastSeenAt,
        created_at: now,
      });
  }

  getPeer(id: string): AgentIdentity | null {
    const row = this.db
      .prepare('SELECT * FROM peers WHERE id = ?')
      .get(id) as PeerRow | undefined;
    return row ? rowToPeer(row) : null;
  }

  listPeers(): AgentIdentity[] {
    const rows = this.db
      .prepare('SELECT * FROM peers ORDER BY last_seen_at DESC')
      .all() as PeerRow[];
    return rows.map(rowToPeer);
  }

  removePeer(id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM peers WHERE id = ?')
      .run(id);
    return info.changes > 0;
  }

  updatePeerLastSeen(id: string): void {
    this.db
      .prepare('UPDATE peers SET last_seen_at = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  getPeerCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM peers')
      .get() as { count: number };
    return row.count;
  }

  // ── Message Log ──────────────────────────────────────────────

  logMessage(
    direction: 'sent' | 'received',
    peerAgentId: string,
    messageType: MessageType,
    encryptedPayload: string,
  ): string {
    const id = uuidv7();
    this.db
      .prepare(
        `INSERT INTO message_log (id, direction, peer_agent_id, message_type, encrypted_payload, timestamp)
         VALUES (@id, @direction, @peer_agent_id, @message_type, @encrypted_payload, @timestamp)`,
      )
      .run({
        id,
        direction,
        peer_agent_id: peerAgentId,
        message_type: messageType,
        encrypted_payload: encryptedPayload,
        timestamp: Date.now(),
      });
    return id;
  }

  queryMessageLog(query: MessageLogQuery = {}): MessageLogRow[] {
    let sql = 'SELECT * FROM message_log WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (query.peerId) {
      sql += ' AND peer_agent_id = @peerId';
      params.peerId = query.peerId;
    }
    if (query.type) {
      sql += ' AND message_type = @type';
      params.type = query.type;
    }

    sql += ' ORDER BY timestamp DESC';

    if (query.limit) {
      sql += ' LIMIT @limit';
      params.limit = query.limit;
    }

    return this.db.prepare(sql).all(params) as MessageLogRow[];
  }

  pruneOldMessages(retentionDays: number): number {
    const cutoff = Date.now() - retentionDays * 86_400_000;
    const info = this.db
      .prepare('DELETE FROM message_log WHERE timestamp < ?')
      .run(cutoff);
    return info.changes;
  }

  getMessageCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM message_log')
      .get() as { count: number };
    return row.count;
  }

  // ── Cleanup ──────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
