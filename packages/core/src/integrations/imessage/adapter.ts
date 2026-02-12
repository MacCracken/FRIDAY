/**
 * IMessageIntegration — macOS iMessage adapter using AppleScript.
 *
 * Sends messages via `osascript` commands to Messages.app.
 * Receives messages by polling the Messages SQLite database
 * at ~/Library/Messages/chat.db.
 *
 * Requirements:
 * - macOS with Messages.app
 * - Full Disk Access granted to the host process (for chat.db reads)
 */

import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@friday/shared';
import type { Integration, IntegrationDeps } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

const execFileAsync = promisify(execFile);

interface ChatDbRow {
  rowid: number;
  guid: string;
  text: string;
  handle_id: number;
  date: number;
  is_from_me: number;
  cache_roomnames: string | null;
}

interface HandleRow {
  rowid: number;
  id: string;
}

export class IMessageIntegration implements Integration {
  readonly platform: Platform = 'imessage';

  private config: IntegrationConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastRowId = 0;
  private chatDbPath: string;
  private pollIntervalMs: number;

  constructor() {
    this.chatDbPath = `${homedir()}/Library/Messages/chat.db`;
    this.pollIntervalMs = 5000;
  }

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;

    // Override defaults from config
    if (config.config.chatDb) {
      this.chatDbPath = config.config.chatDb as string;
    }
    if (config.config.pollIntervalMs) {
      this.pollIntervalMs = config.config.pollIntervalMs as number;
    }

    // Verify macOS
    if (process.platform !== 'darwin') {
      throw new Error('iMessage integration is only available on macOS');
    }

    // Verify osascript is available
    try {
      await execFileAsync('osascript', ['-e', 'return "ok"']);
    } catch {
      throw new Error('osascript is not available — required for iMessage integration');
    }

    // Verify chat.db is readable
    try {
      await access(this.chatDbPath, constants.R_OK);
    } catch {
      throw new Error(
        `Cannot read iMessage database at ${this.chatDbPath}. ` +
        'Ensure Full Disk Access is granted to this process.',
      );
    }

    // Get current max rowid so we only process new messages
    try {
      const db = new Database(this.chatDbPath, { readonly: true });
      const row = db.prepare('SELECT MAX(ROWID) as maxId FROM message').get() as { maxId: number | null } | undefined;
      this.lastRowId = row?.maxId ?? 0;
      db.close();
    } catch (err) {
      throw new Error(
        `Failed to read iMessage database: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    this.logger.info('iMessage integration initialized', { chatDbPath: this.chatDbPath });
  }

  async start(): Promise<void> {
    if (!this.config || !this.deps) throw new Error('Integration not initialized');
    if (this.running) return;

    this.running = true;
    this.pollTimer = setInterval(() => {
      void this.pollMessages().catch((err: unknown) => {
        this.logger?.error('iMessage poll error', {
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }, this.pollIntervalMs);

    this.logger?.info('iMessage polling started', { intervalMs: this.pollIntervalMs });
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    this.logger?.info('iMessage polling stopped');
  }

  async sendMessage(chatId: string, text: string, _metadata?: Record<string, unknown>): Promise<string> {
    // Escape single quotes for AppleScript
    const escapedText = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const escapedChatId = chatId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    const script = `
      tell application "Messages"
        set targetBuddy to buddy "${escapedChatId}" of (service 1 whose service type is iMessage)
        send "${escapedText}" to targetBuddy
      end tell
    `;

    try {
      await execFileAsync('osascript', ['-e', script]);
      const messageId = `imsg_${Date.now()}`;
      return messageId;
    } catch (err) {
      throw new Error(
        `Failed to send iMessage: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  isHealthy(): boolean {
    return this.running;
  }

  private async pollMessages(): Promise<void> {
    let db: Database.Database | null = null;
    try {
      db = new Database(this.chatDbPath, { readonly: true });

      const rows = db.prepare(`
        SELECT m.ROWID as rowid, m.guid, m.text, m.handle_id, m.date, m.is_from_me, c.room_name as cache_roomnames
        FROM message m
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ? AND m.is_from_me = 0 AND m.text IS NOT NULL
        ORDER BY m.ROWID ASC
        LIMIT 50
      `).all(this.lastRowId) as ChatDbRow[];

      if (rows.length === 0) return;

      // Build handle map for sender info
      const handleIds = [...new Set(rows.map(r => r.handle_id))];
      const handles = new Map<number, string>();
      for (const hid of handleIds) {
        const h = db.prepare('SELECT rowid, id FROM handle WHERE rowid = ?').get(hid) as HandleRow | undefined;
        if (h) handles.set(h.rowid, h.id);
      }

      for (const row of rows) {
        const senderId = handles.get(row.handle_id) ?? String(row.handle_id);

        const unified: UnifiedMessage = {
          id: `imsg_${row.rowid}`,
          integrationId: this.config!.id,
          platform: 'imessage',
          direction: 'inbound',
          senderId,
          senderName: senderId,
          chatId: row.cache_roomnames ?? senderId,
          text: row.text,
          attachments: [],
          platformMessageId: row.guid,
          metadata: {},
          timestamp: this.cocoaToUnixMs(row.date),
        };

        await this.deps!.onMessage(unified);
        this.lastRowId = Math.max(this.lastRowId, row.rowid);
      }
    } finally {
      db?.close();
    }
  }

  /** Convert macOS Cocoa timestamp (nanoseconds since 2001-01-01) to Unix ms */
  private cocoaToUnixMs(cocoaTime: number): number {
    // macOS stores dates as nanoseconds since 2001-01-01 in newer versions
    // or seconds since 2001-01-01 in older versions
    const COCOA_EPOCH_OFFSET = 978307200; // seconds between 1970-01-01 and 2001-01-01
    if (cocoaTime > 1e15) {
      // Nanoseconds
      return Math.floor(cocoaTime / 1_000_000) + COCOA_EPOCH_OFFSET * 1000;
    }
    // Seconds
    return (cocoaTime + COCOA_EPOCH_OFFSET) * 1000;
  }
}
