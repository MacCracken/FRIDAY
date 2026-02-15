/**
 * Generic IMAP/SMTP Email Integration
 *
 * Polling + IDLE-based email adapter using ImapFlow for reading and nodemailer
 * for sending. Works with any standard IMAP/SMTP provider: ProtonMail Bridge,
 * Outlook, Yahoo, Fastmail, self-hosted mail servers, etc.
 */

import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { createTransport, type Transporter } from 'nodemailer';
import type { IntegrationConfig, UnifiedMessage, Platform } from '@friday/shared';
import type { Integration, IntegrationDeps, PlatformRateLimit } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

// ─── Config ─────────────────────────────────────────────────

export interface EmailIntegrationConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  fromAddress?: string;
  enableRead: boolean;
  enableSend: boolean;
  mailbox?: string;
  pollIntervalMs?: number;
  tls?: boolean;
  rejectUnauthorized?: boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_MAILBOX = 'INBOX';

export class EmailIntegration implements Integration {
  readonly platform: Platform = 'email';
  readonly platformRateLimit: PlatformRateLimit = { maxPerSecond: 2 };

  private config: IntegrationConfig | null = null;
  private emailConfig: EmailIntegrationConfig | null = null;
  private deps: IntegrationDeps | null = null;
  private logger: SecureLogger | null = null;
  private running = false;

  private imapClient: ImapFlow | null = null;
  private smtpTransport: Transporter | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenUid = 0;
  private fromAddress = '';

  async init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void> {
    this.config = config;
    this.deps = deps;
    this.logger = deps.logger;

    const ec = config.config as unknown as EmailIntegrationConfig;
    this.emailConfig = ec;

    if (!ec.imapHost || !ec.smtpHost || !ec.username || !ec.password) {
      throw new Error('Email integration requires imapHost, smtpHost, username, and password');
    }

    this.fromAddress = ec.fromAddress || ec.username;

    const useTls = ec.tls !== false;
    const rejectUnauthorized = ec.rejectUnauthorized !== false;

    // Create IMAP client (don't connect yet)
    this.imapClient = new ImapFlow({
      host: ec.imapHost,
      port: ec.imapPort || (useTls ? 993 : 143),
      secure: useTls,
      auth: {
        user: ec.username,
        pass: ec.password,
      },
      tls: { rejectUnauthorized },
      logger: false,
    });

    // Create SMTP transport
    this.smtpTransport = createTransport({
      host: ec.smtpHost,
      port: ec.smtpPort || (useTls ? 465 : 587),
      secure: useTls,
      auth: {
        user: ec.username,
        pass: ec.password,
      },
      tls: { rejectUnauthorized },
    });

    this.logger?.info('Email integration initialized', {
      displayName: config.displayName,
      imapHost: ec.imapHost,
      smtpHost: ec.smtpHost,
      fromAddress: this.fromAddress,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const ec = this.emailConfig!;

    if (ec.enableRead && this.imapClient) {
      // Connect IMAP
      await this.imapClient.connect();

      const mailbox = ec.mailbox || DEFAULT_MAILBOX;
      const lock = await this.imapClient.getMailboxLock(mailbox);
      try {
        // Record highest UID as baseline — don't process existing mail
        const status = this.imapClient.mailbox;
        if (status) {
          this.lastSeenUid = status.uidNext ? status.uidNext - 1 : 0;
        }
      } finally {
        lock.release();
      }

      // Listen for IDLE 'exists' events (new mail notification)
      this.imapClient.on('exists', () => {
        void this.poll();
      });

      // Fallback polling interval
      const interval = ec.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      this.pollTimer = setInterval(() => {
        void this.poll();
      }, interval);

      this.logger?.info('Email IMAP polling started', {
        mailbox,
        intervalMs: interval,
        fromAddress: this.fromAddress,
      });
    }

    this.logger?.info('Email integration started', {
      enableRead: ec.enableRead,
      enableSend: ec.enableSend,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.imapClient) {
      try {
        await this.imapClient.logout();
      } catch {
        // Ignore logout errors during shutdown
      }
    }

    if (this.smtpTransport) {
      this.smtpTransport.close();
    }

    this.logger?.info('Email integration stopped');
  }

  async sendMessage(
    chatId: string,
    text: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    if (!this.emailConfig?.enableSend) {
      throw new Error('Email send is not enabled for this integration');
    }

    if (!this.smtpTransport) {
      throw new Error('SMTP transport not initialized');
    }

    const subject = (metadata?.subject as string) || 'Message from FRIDAY';
    const inReplyTo = metadata?.inReplyTo as string | undefined;
    const references = metadata?.references as string | undefined;

    const mailOptions: Record<string, unknown> = {
      from: this.fromAddress,
      to: chatId,
      subject,
      text,
    };

    if (inReplyTo) mailOptions.inReplyTo = inReplyTo;
    if (references) mailOptions.references = references;

    const info = await this.smtpTransport.sendMail(mailOptions);
    return info.messageId || '';
  }

  isHealthy(): boolean {
    return this.running && (this.imapClient?.usable ?? false);
  }

  // ─── Private helpers ────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.imapClient || !this.running) return;

    const mailbox = this.emailConfig?.mailbox || DEFAULT_MAILBOX;

    let lock;
    try {
      lock = await this.imapClient.getMailboxLock(mailbox);
    } catch (err) {
      this.logger?.warn('Email IMAP lock failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return;
    }

    try {
      // Fetch messages with UID > lastSeenUid
      const range = `${this.lastSeenUid + 1}:*`;
      const messages = this.imapClient.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
        bodyStructure: true,
      });

      for await (const msg of messages) {
        if (msg.uid <= this.lastSeenUid) continue;
        this.lastSeenUid = msg.uid;

        await this.processMessage(msg);
      }
    } catch (err) {
      this.logger?.warn('Email poll error', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      lock.release();
    }
  }

  private async processMessage(msg: FetchMessageObject): Promise<void> {
    const envelope = msg.envelope;
    if (!envelope) return;

    const senderAddress = envelope.from?.[0]?.address ?? '';
    const senderName = envelope.from?.[0]?.name ?? senderAddress;

    // Skip messages sent by ourselves
    if (senderAddress.toLowerCase() === this.fromAddress.toLowerCase()) {
      return;
    }

    const subject = envelope.subject ?? '';
    const messageId = envelope.messageId ?? '';
    const inReplyTo = envelope.inReplyTo ?? '';

    // Extract text body from raw source
    const bodyText = msg.source ? this.extractTextFromSource(msg.source) : '';

    // Derive chatId from threading headers for thread grouping
    const chatId = this.deriveThreadId(messageId, inReplyTo);

    const unified: UnifiedMessage = {
      id: `email_${msg.uid}`,
      integrationId: this.config!.id,
      platform: 'email',
      direction: 'inbound',
      senderId: senderAddress,
      senderName: senderName,
      chatId,
      text: bodyText,
      attachments: [],
      platformMessageId: String(msg.uid),
      metadata: {
        subject,
        messageId,
        inReplyTo,
      },
      timestamp: envelope.date
        ? (envelope.date instanceof Date ? envelope.date.getTime() : new Date(envelope.date).getTime())
        : Date.now(),
    };

    await this.deps!.onMessage(unified);
  }

  /** Extract text/plain content from raw email source */
  private extractTextFromSource(source: Buffer): string {
    const raw = source.toString('utf-8');

    // Find the boundary between headers and body
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) return raw;

    const headers = raw.substring(0, headerEnd).toLowerCase();
    const body = raw.substring(headerEnd + 4);

    // Simple single-part text/plain
    if (
      !headers.includes('content-type: multipart') &&
      (headers.includes('content-type: text/plain') || !headers.includes('content-type:'))
    ) {
      return this.decodeBody(body, headers);
    }

    // Multipart: find text/plain part
    const boundaryMatch = headers.match(/boundary="?([^";\r\n]+)"?/);
    if (!boundaryMatch) return body;

    const boundary = boundaryMatch[1];
    const parts = raw.split(`--${boundary}`);

    for (const part of parts) {
      const partHeaderEnd = part.indexOf('\r\n\r\n');
      if (partHeaderEnd === -1) continue;

      const partHeaders = part.substring(0, partHeaderEnd).toLowerCase();
      if (partHeaders.includes('content-type: text/plain')) {
        const partBody = part.substring(partHeaderEnd + 4).replace(/--\s*$/, '').trim();
        return this.decodeBody(partBody, partHeaders);
      }
    }

    // Fallback: return raw body
    return body;
  }

  private decodeBody(body: string, headers: string): string {
    if (headers.includes('content-transfer-encoding: base64')) {
      return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8');
    }
    if (headers.includes('content-transfer-encoding: quoted-printable')) {
      return body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
          String.fromCharCode(parseInt(hex, 16))
        );
    }
    return body;
  }

  /** Derive a stable thread ID from message threading headers */
  deriveThreadId(messageId: string, inReplyTo: string): string {
    // If replying to something, use the root message ID as thread grouping key
    if (inReplyTo) {
      return `thread_${this.hashString(inReplyTo)}`;
    }
    // New conversation: use own message ID
    if (messageId) {
      return `thread_${this.hashString(messageId)}`;
    }
    return `thread_${Date.now()}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  }
}
