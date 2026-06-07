/**
 * Zapier Integration
 *
 * Receives Zap trigger webhooks inbound; dispatches to Zapier catch-hook URLs outbound.
 * Inbound: any POST to /webhooks/zapier is treated as an incoming Zap trigger.
 * Outbound: POST payload to the configured outboundUrl (a Zapier catch-hook).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@secureyeoman/shared';
import type { WebhookIntegration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';
import { assertPublicUrl } from '../../utils/ssrf-guard.js';

interface ZapierConfig {
  webhookSecret?: string;
  outboundUrl?: string;
}

export class ZapierIntegration implements WebhookIntegration {
  readonly platform: Platform = 'zapier';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 10 };

  private config: IntegrationConfig | null = null;
  private zapierConfig: ZapierConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;
    this.zapierConfig = config.config;
    this.logger?.info('Zapier integration initialized');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger?.info('Zapier integration started — awaiting webhooks');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger?.info('Zapier integration stopped');
  }

  async sendMessage(
    _chatId: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const outboundUrl =
      (metadata?.outboundUrl as string | undefined) ?? this.zapierConfig?.outboundUrl;
    if (!outboundUrl) throw new Error('No Zapier outbound webhook URL configured');
    assertPublicUrl(outboundUrl, 'Zapier Webhook URL');
    const payload = { message: text, ...metadata };
    const resp = await fetch(outboundUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) throw new Error(`Zapier webhook dispatch failed: ${resp.status}`);
    return `zapier_out_${Date.now()}`;
  }

  isHealthy(): boolean {
    return this.running;
  }

  getWebhookPath(): string {
    return '/webhooks/zapier';
  }

  verifyWebhook(payload: string, signature: string): boolean {
    if (!this.zapierConfig?.webhookSecret) return true; // no secret = accept all
    try {
      const computed = createHmac('sha256', this.zapierConfig.webhookSecret)
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
      const data = JSON.parse(payload) as Record<string, unknown>;
      const text =
        (data.message as string | undefined) ??
        (data.text as string | undefined) ??
        (data.content as string | undefined) ??
        `Zap triggered: ${JSON.stringify(data).slice(0, 200)}`;
      const senderId =
        (data.sender as string | undefined) ?? (data.from as string | undefined) ?? 'zapier';

      const unified: UnifiedMessage = {
        id: `zapier_${Date.now()}`,
        integrationId: this.config!.id,
        platform: 'zapier',
        direction: 'inbound',
        senderId,
        senderName: 'Zapier',
        chatId: (data.chatId as string | undefined) ?? 'zapier',
        text,
        attachments: [],
        platformMessageId: String(data.id ?? Date.now()),
        metadata: { ...data, rawPayload: payload.slice(0, 2000) },
        timestamp: Date.now(),
      };
      await this.deps.onMessage(unified);
    } catch (err) {
      this.logger?.warn(
        {
          error: err instanceof Error ? err.message : String(err),
        },
        'Zapier webhook parse error'
      );
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    if (!this.zapierConfig?.outboundUrl) {
      return { ok: true, message: 'Zapier ready — no outbound URL configured (inbound only)' };
    }
    return { ok: true, message: `Zapier outbound configured: ${this.zapierConfig.outboundUrl}` };
  }
}
