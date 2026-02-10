/**
 * Integration Test: Audit Trail
 *
 * Chain integrity, tamper detection, query filtering,
 * persistence across instances, and auth operation auditing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createTestStack,
  TEST_SIGNING_KEY,
  type TestStack,
} from './helpers.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { SQLiteAuditStorage } from '../logging/sqlite-storage.js';

describe('Audit Trail Integration', () => {
  let stack: TestStack;

  beforeEach(async () => {
    stack = createTestStack();
    await stack.auditChain.initialize();
  });

  afterEach(() => {
    stack.cleanup();
  });

  // ── Chain integrity across multiple operations ────────────────────

  it('maintains chain integrity across multiple operations', async () => {
    const chain = stack.auditChain;

    for (let i = 0; i < 10; i++) {
      await chain.record({
        event: `operation_${i}`,
        level: 'info',
        message: `Operation ${i} completed`,
        metadata: { index: i },
      });
    }

    const result = await chain.verify();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(10);
  });

  // ── Chain continuation across instances (same storage) ────────────

  it('chain continues across AuditChain instances with same storage', async () => {
    const storage = new InMemoryAuditStorage();

    // First instance
    const chain1 = new AuditChain({ storage, signingKey: TEST_SIGNING_KEY });
    await chain1.initialize();
    await chain1.record({ event: 'first', level: 'info', message: 'First entry' });
    await chain1.record({ event: 'second', level: 'info', message: 'Second entry' });

    // Second instance (same storage)
    const chain2 = new AuditChain({ storage, signingKey: TEST_SIGNING_KEY });
    await chain2.initialize();
    await chain2.record({ event: 'third', level: 'info', message: 'Third entry' });

    // Verify with second instance
    const result = await chain2.verify();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
  });

  // ── Tamper detection ──────────────────────────────────────────────

  it('detects tampered entry (corrupt message)', async () => {
    const storage = new InMemoryAuditStorage();
    const chain = new AuditChain({ storage, signingKey: TEST_SIGNING_KEY });
    await chain.initialize();

    await chain.record({ event: 'legit_1', level: 'info', message: 'Legit 1' });
    const entry2 = await chain.record({ event: 'legit_2', level: 'info', message: 'Legit 2' });
    await chain.record({ event: 'legit_3', level: 'info', message: 'Legit 3' });

    // Tamper with entry 2
    (entry2 as { message: string }).message = 'TAMPERED';

    const result = await chain.verify();
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Signature verification failed|Chain link broken/);
  });

  // ── Query filtering ───────────────────────────────────────────────

  it('query filters by level', async () => {
    const chain = stack.auditChain;

    await chain.record({ event: 'info_event', level: 'info', message: 'Info' });
    await chain.record({ event: 'warn_event', level: 'warn', message: 'Warning' });
    await chain.record({ event: 'error_event', level: 'error', message: 'Error' });

    const warnOnly = await stack.auditStorage.query({ level: ['warn'] });
    expect(warnOnly.entries.length).toBe(1);
    expect(warnOnly.entries[0].level).toBe('warn');
  });

  it('query filters by event name', async () => {
    const chain = stack.auditChain;

    await chain.record({ event: 'task_created', level: 'info', message: 'Task' });
    await chain.record({ event: 'auth_success', level: 'info', message: 'Auth' });
    await chain.record({ event: 'task_completed', level: 'info', message: 'Done' });

    const taskEvents = await stack.auditStorage.query({
      event: ['task_created', 'task_completed'],
    });
    expect(taskEvents.entries.length).toBe(2);
  });

  it('query filters by userId', async () => {
    const chain = stack.auditChain;

    await chain.record({ event: 'action', level: 'info', message: 'User A', userId: 'user_a' });
    await chain.record({ event: 'action', level: 'info', message: 'User B', userId: 'user_b' });
    await chain.record({ event: 'action', level: 'info', message: 'User A again', userId: 'user_a' });

    const userA = await stack.auditStorage.query({ userId: 'user_a' });
    expect(userA.entries.length).toBe(2);
  });

  it('query filters by time range', async () => {
    const chain = stack.auditChain;

    const before = Date.now();
    await chain.record({ event: 'early', level: 'info', message: 'Early' });

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    const mid = Date.now();

    await chain.record({ event: 'late', level: 'info', message: 'Late' });

    const earlyOnly = await stack.auditStorage.query({ to: mid - 1 });
    expect(earlyOnly.entries.length).toBeGreaterThanOrEqual(1);
    expect(earlyOnly.entries.every((e) => e.timestamp < mid)).toBe(true);
  });

  // ── SQLite persistence ────────────────────────────────────────────

  it('persists to SQLite, reopens, and verifies', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    const dbPath = join(tmpDir, 'audit.db');

    try {
      // Create and populate
      const storage1 = new SQLiteAuditStorage({ dbPath });
      const chain1 = new AuditChain({ storage: storage1, signingKey: TEST_SIGNING_KEY });
      await chain1.initialize();

      await chain1.record({ event: 'persist_1', level: 'info', message: 'Persisted 1' });
      await chain1.record({ event: 'persist_2', level: 'info', message: 'Persisted 2' });
      storage1.close();

      // Reopen
      const storage2 = new SQLiteAuditStorage({ dbPath });
      const chain2 = new AuditChain({ storage: storage2, signingKey: TEST_SIGNING_KEY });
      await chain2.initialize();

      // Add more entries
      await chain2.record({ event: 'persist_3', level: 'info', message: 'Persisted 3' });

      // Verify
      const result = await chain2.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(3);

      storage2.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Auth operations → audit log ───────────────────────────────────

  it('auth operations produce correct audit events', async () => {
    // Login
    await stack.authService.login('test-admin-password-32chars!!', '127.0.0.1');

    // Check that auth_success was recorded
    const result = await stack.auditStorage.query({
      event: ['auth_success'],
    });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries.some((e) => e.message === 'Admin login')).toBe(true);
  });

  it('failed login produces auth_failure audit event', async () => {
    try {
      await stack.authService.login('wrong-password', '127.0.0.1');
    } catch {
      // Expected
    }

    const result = await stack.auditStorage.query({
      event: ['auth_failure'],
    });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });
});
