/**
 * MCP Storage — SQLite persistence for MCP server configurations
 */

import Database from 'better-sqlite3';
import type { McpServerConfig, McpServerCreate, McpToolDef } from '@friday/shared';
import { uuidv7 } from '../utils/crypto.js';

export interface McpFeatureConfig {
  exposeGit: boolean;
  exposeFilesystem: boolean;
}

const MCP_CONFIG_DEFAULTS: McpFeatureConfig = {
  exposeGit: false,
  exposeFilesystem: false,
};

export class McpStorage {
  private db: Database.Database;

  constructor(opts: { dbPath: string }) {
    this.db = new Database(opts.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        transport TEXT DEFAULT 'stdio',
        command TEXT,
        args TEXT DEFAULT '[]',
        url TEXT,
        env TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_server_tools (
        server_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        input_schema TEXT DEFAULT '{}',
        PRIMARY KEY (server_id, name),
        FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mcp_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  addServer(create: McpServerCreate): McpServerConfig {
    const now = Date.now();
    const id = uuidv7();
    const server: McpServerConfig = {
      id,
      name: create.name,
      description: create.description ?? '',
      transport: create.transport ?? 'stdio',
      command: create.command,
      args: create.args ?? [],
      url: create.url,
      env: create.env ?? {},
      enabled: create.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.prepare(`
      INSERT INTO mcp_servers (id, name, description, transport, command, args, url, env, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      server.id, server.name, server.description, server.transport,
      server.command ?? null, JSON.stringify(server.args), server.url ?? null,
      JSON.stringify(server.env), server.enabled ? 1 : 0, server.createdAt, server.updatedAt,
    );

    return server;
  }

  getServer(id: string): McpServerConfig | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToConfig(row) : null;
  }

  findServerByName(name: string): McpServerConfig | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToConfig(row) : null;
  }

  listServers(): McpServerConfig[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToConfig(r));
  }

  updateServer(id: string, update: { enabled?: boolean }): boolean {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (update.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(update.enabled ? 1 : 0);
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    const result = this.db.prepare(
      `UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
    return result.changes > 0;
  }

  deleteServer(id: string): boolean {
    const result = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  private rowToConfig(row: Record<string, unknown>): McpServerConfig {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? '',
      transport: (row.transport as McpServerConfig['transport']) ?? 'stdio',
      command: row.command as string | undefined,
      args: JSON.parse((row.args as string) || '[]'),
      url: row.url as string | undefined,
      env: JSON.parse((row.env as string) || '{}'),
      enabled: row.enabled === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  /**
   * Persist tool manifests for a server. Replaces any existing tools.
   */
  saveTools(serverId: string, serverName: string, tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>): void {
    const del = this.db.prepare('DELETE FROM mcp_server_tools WHERE server_id = ?');
    const ins = this.db.prepare('INSERT INTO mcp_server_tools (server_id, name, description, input_schema) VALUES (?, ?, ?, ?)');
    const tx = this.db.transaction(() => {
      del.run(serverId);
      for (const t of tools) {
        ins.run(serverId, t.name, t.description ?? '', JSON.stringify(t.inputSchema ?? {}));
      }
    });
    tx();
  }

  /**
   * Load persisted tools for a server.
   */
  loadTools(serverId: string): McpToolDef[] {
    const server = this.getServer(serverId);
    if (!server) return [];
    const rows = this.db.prepare('SELECT * FROM mcp_server_tools WHERE server_id = ?').all(serverId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      name: row.name as string,
      description: (row.description as string) ?? '',
      inputSchema: JSON.parse((row.input_schema as string) || '{}'),
      serverId,
      serverName: server.name,
    }));
  }

  /**
   * Delete persisted tools for a server.
   */
  deleteTools(serverId: string): void {
    this.db.prepare('DELETE FROM mcp_server_tools WHERE server_id = ?').run(serverId);
  }

  getConfig(): McpFeatureConfig {
    const rows = this.db.prepare('SELECT key, value FROM mcp_config').all() as Array<{ key: string; value: string }>;
    const config = { ...MCP_CONFIG_DEFAULTS };
    for (const row of rows) {
      if (row.key in config) {
        (config as Record<string, unknown>)[row.key] = JSON.parse(row.value);
      }
    }
    return config;
  }

  setConfig(partial: Partial<McpFeatureConfig>): McpFeatureConfig {
    const upsert = this.db.prepare(
      'INSERT INTO mcp_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(partial)) {
        if (value !== undefined) {
          upsert.run(key, JSON.stringify(value));
        }
      }
    });
    tx();
    return this.getConfig();
  }

  close(): void {
    this.db.close();
  }
}
