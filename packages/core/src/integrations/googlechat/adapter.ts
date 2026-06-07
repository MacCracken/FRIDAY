/**
 * Google Chat Integration
 *
 * Google Chat adapter using the Google Chat API.
 * Supports bot messages, card messages, and interactive cards.
 */

import type { IntegrationConfig, Platform } from '@secureyeoman/shared';
import type { Integration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

interface GoogleChatConfig {
  botToken: string;
  spaceId?: string;
  serviceAccount?: string;
}

interface GoogleChatMessage {
  name?: string;
  text?: string;
  cards?: GoogleChatCard[];
  fallbackText?: string;
}

interface GoogleChatCard {
  header?: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
  };
  sections?: {
    widgets: GoogleChatWidget[];
  }[];
}

interface GoogleChatWidget {
  textParagraph?: {
    text: string;
  };
  buttonList?: {
    buttons: {
      text: string;
      onClick: {
        action: {
          function?: string;
          parameters?: { key: string; value: string }[];
        };
      };
    }[];
  };
}

export class GoogleChatIntegration implements Integration {
  readonly platform: Platform = 'googlechat';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 5 };

  private config: IntegrationConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;
  private botToken = '';
  private spaceId = '';

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;

    const chatConfig = config.config as unknown as GoogleChatConfig;
    this.botToken = chatConfig.botToken;
    this.spaceId = chatConfig.spaceId || '';

    if (!this.botToken) {
      throw new Error('Google Chat integration requires a botToken in config');
    }

    this.logger?.info(
      {
        displayName: config.displayName,
        spaceId: this.spaceId,
      },
      'Google Chat integration initialized'
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger?.info('Google Chat bot connected');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.logger?.info('Google Chat bot disconnected');
  }

  async sendMessage(
    chatId: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const message: GoogleChatMessage = {
      text,
    };

    if (metadata?.card) {
      message.cards = [metadata.card];
    }

    const response = await fetch(`https://chat.googleapis.com/v1/spaces/${chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.botToken}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send Google Chat message: ${error}`);
    }

    const result = (await response.json()) as { name?: string };
    return result.name || '';
  }

  isHealthy(): boolean {
    return this.running;
  }

  getSpaceId(): string {
    return this.spaceId;
  }

  setSpaceId(spaceId: string): void {
    this.spaceId = spaceId;
  }
}
