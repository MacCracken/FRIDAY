import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EmailIntegration } from './adapter.js';
import type { IntegrationConfig } from '@friday/shared';
import type { IntegrationDeps } from '../types.js';
import type { SecureLogger } from '../../logging/logger.js';

// ── Mock ImapFlow ─────────────────────────────────────────────

vi.mock('imapflow', () => {
  class MockImapFlow {
    usable = true;
    mailbox = { uidNext: 100 };
    connect = vi.fn().mockResolvedValue(undefined);
    logout = vi.fn().mockResolvedValue(undefined);
    getMailboxLock = vi.fn().mockResolvedValue({ release: vi.fn() });
    fetch = vi.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }),
    });
    on = vi.fn();
    constructor(_opts: unknown) {}
  }
  return { ImapFlow: MockImapFlow };
});

// ── Mock nodemailer ───────────────────────────────────────────

vi.mock('nodemailer', () => {
  const sendMail = vi.fn().mockResolvedValue({ messageId: '<test-msg-id@example.com>' });
  return {
    createTransport: vi.fn().mockReturnValue({
      sendMail,
      close: vi.fn(),
    }),
    __mockSendMail: sendMail,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockSendMail: mockSendMail } = await import('nodemailer') as any;

// ── Helpers ───────────────────────────────────────────────────

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  } as SecureLogger;
}

function makeConfig(overrides: Partial<IntegrationConfig['config']> = {}): IntegrationConfig {
  return {
    id: 'email_int_1',
    platform: 'email',
    displayName: 'Test Email',
    enabled: true,
    status: 'disconnected',
    config: {
      imapHost: '127.0.0.1',
      imapPort: 1143,
      smtpHost: '127.0.0.1',
      smtpPort: 1025,
      username: 'test@example.com',
      password: 'secret',
      enableRead: true,
      enableSend: true,
      tls: false,
      rejectUnauthorized: false,
      ...overrides,
    },
    messageCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeDeps(onMessage = vi.fn().mockResolvedValue(undefined)): IntegrationDeps {
  return { logger: noopLogger(), onMessage };
}

// ── Tests ─────────────────────────────────────────────────────

describe('EmailIntegration', () => {
  let adapter: EmailIntegration;

  beforeEach(() => {
    adapter = new EmailIntegration();
    vi.clearAllMocks();
  });

  it('should have email platform', () => {
    expect(adapter.platform).toBe('email');
  });

  it('should have rate limit config', () => {
    expect(adapter.platformRateLimit).toEqual({ maxPerSecond: 2 });
  });

  it('should not be healthy before init', () => {
    expect(adapter.isHealthy()).toBe(false);
  });

  describe('init()', () => {
    it('should initialize with valid config', async () => {
      await adapter.init(makeConfig(), makeDeps());
      // No error thrown = success
    });

    it('should throw when missing required fields', async () => {
      await expect(
        adapter.init(
          makeConfig({ imapHost: '', smtpHost: '', username: '', password: '' }),
          makeDeps()
        )
      ).rejects.toThrow('Email integration requires imapHost, smtpHost, username, and password');
    });

    it('should use username as fromAddress when fromAddress not specified', async () => {
      await adapter.init(makeConfig(), makeDeps());
      // sendMessage will use the fromAddress internally
    });
  });

  describe('start() / stop()', () => {
    it('should start and become healthy', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.start();
      expect(adapter.isHealthy()).toBe(true);
    });

    it('should stop cleanly', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.start();
      await adapter.stop();
      expect(adapter.isHealthy()).toBe(false);
    });

    it('should be idempotent on start', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.start();
      await adapter.start(); // Should not throw
    });

    it('should be idempotent on stop', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.stop(); // Should not throw even if not started
    });
  });

  describe('sendMessage()', () => {
    it('should send via SMTP', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.start();

      const msgId = await adapter.sendMessage('recipient@example.com', 'Hello!', {
        subject: 'Test Subject',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'test@example.com',
          to: 'recipient@example.com',
          subject: 'Test Subject',
          text: 'Hello!',
        })
      );
      expect(msgId).toBe('<test-msg-id@example.com>');
    });

    it('should include threading headers when provided', async () => {
      await adapter.init(makeConfig(), makeDeps());
      await adapter.start();

      await adapter.sendMessage('to@example.com', 'Reply', {
        subject: 'Re: Thread',
        inReplyTo: '<orig@example.com>',
        references: '<orig@example.com>',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          inReplyTo: '<orig@example.com>',
          references: '<orig@example.com>',
        })
      );
    });

    it('should throw when send is disabled', async () => {
      await adapter.init(makeConfig({ enableSend: false }), makeDeps());
      await adapter.start();

      await expect(
        adapter.sendMessage('to@example.com', 'Hello')
      ).rejects.toThrow('Email send is not enabled');
    });
  });

  describe('deriveThreadId()', () => {
    it('should use inReplyTo for thread grouping when present', () => {
      const id1 = adapter.deriveThreadId('<msg1@example.com>', '<root@example.com>');
      const id2 = adapter.deriveThreadId('<msg2@example.com>', '<root@example.com>');
      expect(id1).toBe(id2); // Same inReplyTo → same thread
    });

    it('should use own messageId for new conversations', () => {
      const id = adapter.deriveThreadId('<new@example.com>', '');
      expect(id).toMatch(/^thread_/);
    });

    it('should generate different IDs for different threads', () => {
      const id1 = adapter.deriveThreadId('<a@x.com>', '');
      const id2 = adapter.deriveThreadId('<b@x.com>', '');
      expect(id1).not.toBe(id2);
    });
  });
});
