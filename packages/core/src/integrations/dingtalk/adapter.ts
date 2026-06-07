/**
 * DingTalk Integration
 *
 * Webhook-based integration receiving events from DingTalk outgoing robots.
 * Sends messages via DingTalk webhook (custom robot incoming webhook URL).
 * Handles text messages, @ mentions, and file transfer events.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@secureyeoman/shared';
import type { WebhookIntegration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';
import { errorToString } from '../../utils/errors.js';
import { assertPublicUrl } from '../../utils/ssrf-guard.js';

interface DingTalkConfig {
  outboundWebhookUrl?: string;
  appKey?: string;
  appSecret?: string;
  webhookToken?: string;
}

interface DingTalkEvent {
  msgtype: string;
  text?: { content: string };
  markdown?: { title: string; text: string };
  senderStaffId?: string;
  senderNick?: string;
  conversationId?: string;
  msgId?: string;
  createAt?: number;
  sessionWebhook?: string;
}

const DINGTALK_API = 'https://oapi.dingtalk.com';

export class DingTalkIntegration implements WebhookIntegration {
  readonly platform: Platform = 'dingtalk';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 20 };

  private config: IntegrationConfig | null = null;
  private dtConfig: DingTalkConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;
    this.dtConfig = config.config;
    this.logger?.info('DingTalk integration initialized');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger?.info('DingTalk integration started — awaiting webhooks');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger?.info('DingTalk integration stopped');
  }

  async sendMessage(
    chatId: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    // Use sessionWebhook from metadata if available (reply in-conversation)
    const webhookUrl =
      (metadata?.sessionWebhook as string | undefined) ??
      chatId ??
      this.dtConfig?.outboundWebhookUrl;
    if (!webhookUrl?.startsWith('http'))
      throw new Error('No DingTalk outbound webhook URL configured');
    assertPublicUrl(webhookUrl, 'DingTalk Webhook URL');

    const isMarkdown = metadata?.markdown === true;
    const body = isMarkdown
      ? { msgtype: 'markdown', markdown: { title: text.slice(0, 20), text } }
      : { msgtype: 'text', text: { content: text } };

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`DingTalk send failed: ${resp.status}`);
    return `dingtalk_${Date.now()}`;
  }

  isHealthy(): boolean {
    return this.running;
  }

  getWebhookPath(): string {
    return '/webhooks/dingtalk';
  }

  verifyWebhook(payload: string, signature: string): boolean {
    if (!this.dtConfig?.webhookToken) return true;
    try {
      const computed = createHmac('sha256', this.dtConfig.webhookToken)
        .update(payload)
        .digest('hex');
      const expected = signature.replace(/^sha256=/, '');
      return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  async handleWebhook(payload: string, _signature: string): Promise<void> {
    if (!this.deps) return;
    try {
      const event = JSON.parse(payload) as DingTalkEvent;
      const text =
        event.text?.content?.trim() ?? event.markdown?.text ?? `DingTalk event: ${event.msgtype}`;

      const unified: UnifiedMessage = {
        id: `dingtalk_${event.msgId ?? Date.now()}`,
        integrationId: this.config!.id,
        platform: 'dingtalk',
        direction: 'inbound',
        senderId: event.senderStaffId ?? 'unknown',
        senderName: event.senderNick ?? 'DingTalk',
        chatId: event.conversationId ?? 'dingtalk',
        text,
        attachments: [],
        platformMessageId: event.msgId ?? String(Date.now()),
        metadata: {
          msgtype: event.msgtype,
          conversationId: event.conversationId,
          sessionWebhook: event.sessionWebhook,
          createAt: event.createAt,
        },
        timestamp: event.createAt ?? Date.now(),
      };
      await this.deps.onMessage(unified);
    } catch (err) {
      this.logger?.warn(
        {
          error: errorToString(err),
        },
        'DingTalk webhook parse error'
      );
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (this.dtConfig?.outboundWebhookUrl) {
      return {
        ok: true,
        message: `DingTalk outbound configured: ${this.dtConfig.outboundWebhookUrl}`,
      };
    }
    if (this.dtConfig?.appKey) {
      try {
        const resp = await fetch(`${DINGTALK_API}/robot/sendBySession`, {
          method: 'GET',
          headers: { 'x-acs-dingtalk-access-token': this.dtConfig.appKey },
          signal: AbortSignal.timeout(30_000),
        });
        return {
          ok: resp.status !== 401,
          message: resp.status === 401 ? 'Invalid app credentials' : 'DingTalk connected',
        };
      } catch (err) {
        return { ok: false, message: errorToString(err) };
      }
    }
    return { ok: true, message: 'DingTalk ready — awaiting webhook events' };
  }
}
