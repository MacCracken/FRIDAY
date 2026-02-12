/**
 * SlackIntegration — Slack adapter using @slack/bolt.
 *
 * Uses socket mode (no public URL needed).
 * Normalizes inbound messages to UnifiedMessage with `sl_` prefix.
 */

import { App } from '@slack/bolt';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@friday/shared';
import type { Integration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

export class SlackIntegration implements Integration {
  readonly platform: Platform = 'slack';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 1 };

  private app: App | null = null;
  private config: IntegrationConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;

    const botToken = config.config.botToken as string | undefined;
    const appToken = config.config.appToken as string | undefined;

    if (!botToken) {
      throw new Error('Slack integration requires a botToken in config');
    }
    if (!appToken) {
      throw new Error('Slack integration requires an appToken in config (for socket mode)');
    }

    this.app = new App({
      token: botToken,
      appToken: appToken,
      socketMode: true,
      signingSecret: config.config.signingSecret as string | undefined,
    });

    // Listen for regular messages
    this.app.message(async ({ message }) => {
      const msg = message as Record<string, any>;
      if (msg.subtype) return; // skip edited, deleted, etc.
      if (!msg.text) return;

      const files = (msg.files ?? []) as Array<Record<string, any>>;
      const unified: UnifiedMessage = {
        id: `sl_${msg.ts}`,
        integrationId: config.id,
        platform: 'slack',
        direction: 'inbound',
        senderId: String(msg.user ?? ''),
        senderName: String(msg.user ?? 'Unknown'),
        chatId: String(msg.channel),
        text: String(msg.text),
        attachments: files.map((f: Record<string, any>) => ({
          type: 'file' as const,
          url: f.url_private ?? undefined,
          fileName: f.name ?? undefined,
          mimeType: f.mimetype ?? undefined,
          size: f.size ?? undefined,
        })),
        replyToMessageId: msg.thread_ts ?? undefined,
        platformMessageId: String(msg.ts),
        metadata: {
          threadTs: msg.thread_ts,
          channelType: msg.channel_type,
        },
        timestamp: parseFloat(msg.ts) * 1000,
      };

      void this.deps!.onMessage(unified);
    });

    // Listen for app_mention events (when bot is @mentioned)
    this.app.event('app_mention', async ({ event }) => {
      const unified: UnifiedMessage = {
        id: `sl_${event.ts}`,
        integrationId: config.id,
        platform: 'slack',
        direction: 'inbound',
        senderId: event.user ?? '',
        senderName: event.user ?? 'Unknown',
        chatId: event.channel,
        text: event.text,
        attachments: [],
        replyToMessageId: event.thread_ts ?? undefined,
        platformMessageId: event.ts,
        metadata: {
          isMention: true,
          threadTs: event.thread_ts,
        },
        timestamp: parseFloat(event.ts) * 1000,
      };

      void this.deps!.onMessage(unified);
    });

    // Slash command: /friday
    this.app.command('/friday', async ({ command, ack, respond }) => {
      await ack();

      const unified: UnifiedMessage = {
        id: `sl_cmd_${Date.now()}`,
        integrationId: config.id,
        platform: 'slack',
        direction: 'inbound',
        senderId: command.user_id,
        senderName: command.user_name,
        chatId: command.channel_id,
        text: command.text || '/friday',
        attachments: [],
        platformMessageId: command.trigger_id,
        metadata: {
          isSlashCommand: true,
          commandName: '/friday',
        },
        timestamp: Date.now(),
      };

      void this.deps!.onMessage(unified);
    });

    // Slash command: /friday-status
    this.app.command('/friday-status', async ({ command, ack, respond }) => {
      await ack();
      await respond({
        text: `Agent: ${config.displayName}\nPlatform: Slack\nStatus: Connected`,
      });
    });

    this.logger?.info('Slack integration initialized');
  }

  async start(): Promise<void> {
    if (!this.app) throw new Error('Integration not initialized');
    if (this.running) return;

    await this.app.start();
    this.running = true;
    this.logger?.info('Slack bot connected (socket mode)');
  }

  async stop(): Promise<void> {
    if (!this.app || !this.running) return;
    this.running = false;
    await this.app.stop();
    this.logger?.info('Slack bot disconnected');
  }

  async sendMessage(chatId: string, text: string, metadata?: Record<string, unknown>): Promise<string> {
    if (!this.app) throw new Error('Integration not initialized');

    const threadTs = metadata?.threadTs as string | undefined;

    const result = await this.app.client.chat.postMessage({
      channel: chatId,
      text,
      thread_ts: threadTs,
    });

    return result.ts ?? '';
  }

  isHealthy(): boolean {
    return this.running;
  }
}
