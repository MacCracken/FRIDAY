import { describe, it, expect, beforeEach } from 'vitest';
import { AuditChain, InMemoryAuditStorage } from './audit-chain.js';

const SIGNING_KEY = 'a'.repeat(64); // 64 chars, well above 32 minimum

describe('AuditChain', () => {
  let storage: InMemoryAuditStorage;
  let chain: AuditChain;

  beforeEach(async () => {
    storage = new InMemoryAuditStorage();
    chain = new AuditChain({ storage, signingKey: SIGNING_KEY });
    await chain.initialize();
  });

  describe('constructor', () => {
    it('should reject signing keys shorter than 32 characters', () => {
      expect(() => new AuditChain({ storage, signingKey: 'short' }))
        .toThrow('Signing key must be at least 32 characters');
    });

    it('should accept signing keys of exactly 32 characters', () => {
      expect(() => new AuditChain({ storage, signingKey: 'x'.repeat(32) }))
        .not.toThrow();
    });
  });

  describe('genesis block', () => {
    it('should set previousHash to all zeros for first entry', async () => {
      const entry = await chain.record({
        event: 'test_event',
        level: 'info',
        message: 'Genesis entry',
      });

      expect(entry.integrity.previousEntryHash).toBe('0'.repeat(64));
    });
  });

  describe('chain linking', () => {
    it('should link entries via previousEntryHash', async () => {
      const first = await chain.record({
        event: 'event_1',
        level: 'info',
        message: 'First',
      });

      const second = await chain.record({
        event: 'event_2',
        level: 'info',
        message: 'Second',
      });

      // Second entry's previousHash should NOT be the genesis hash
      expect(second.integrity.previousEntryHash).not.toBe('0'.repeat(64));
      // The hash should be deterministic and non-empty
      expect(second.integrity.previousEntryHash).toHaveLength(64);
    });

    it('should produce unique signatures per entry', async () => {
      const first = await chain.record({
        event: 'event_1',
        level: 'info',
        message: 'First',
      });

      const second = await chain.record({
        event: 'event_2',
        level: 'info',
        message: 'Second',
      });

      expect(first.integrity.signature).not.toBe(second.integrity.signature);
    });
  });

  describe('verify()', () => {
    it('should return valid for empty chain', async () => {
      const result = await chain.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(0);
    });

    it('should return valid for a correct chain', async () => {
      await chain.record({ event: 'e1', level: 'info', message: 'First' });
      await chain.record({ event: 'e2', level: 'warn', message: 'Second' });
      await chain.record({ event: 'e3', level: 'error', message: 'Third' });

      const result = await chain.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(3);
    });

    it('should detect tampered entry', async () => {
      await chain.record({ event: 'e1', level: 'info', message: 'First' });
      await chain.record({ event: 'e2', level: 'info', message: 'Second' });

      // Tamper with the first entry by modifying message directly in storage
      const entries: any[] = [];
      for await (const e of storage.iterate()) {
        entries.push(e);
      }
      // Modify the first entry's message
      entries[0].message = 'TAMPERED';

      // Create a new storage with tampered data
      const tamperedStorage = new InMemoryAuditStorage();
      for (const e of entries) {
        await tamperedStorage.append(e);
      }

      const tamperedChain = new AuditChain({ storage: tamperedStorage, signingKey: SIGNING_KEY });
      await tamperedChain.initialize();
      const result = await tamperedChain.verify();
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getStats()', () => {
    it('should return correct counts', async () => {
      await chain.record({ event: 'e1', level: 'info', message: 'First' });
      await chain.record({ event: 'e2', level: 'info', message: 'Second' });

      const stats = await chain.getStats();
      expect(stats.entriesCount).toBe(2);
      expect(stats.chainValid).toBe(true);
      expect(stats.lastVerification).toBeDefined();
      expect(typeof stats.lastVerification).toBe('number');
    });

    it('should return zero for empty chain', async () => {
      const stats = await chain.getStats();
      expect(stats.entriesCount).toBe(0);
      expect(stats.chainValid).toBe(true);
    });
  });

  describe('createSnapshot()', () => {
    it('should return expected shape for empty chain', async () => {
      const snapshot = await chain.createSnapshot();
      expect(snapshot.timestamp).toBeTypeOf('number');
      expect(snapshot.entriesCount).toBe(0);
      expect(snapshot.lastHash).toBe('0'.repeat(64));
      expect(snapshot.lastEntryId).toBeNull();
    });

    it('should return expected shape after entries', async () => {
      const entry = await chain.record({ event: 'e1', level: 'info', message: 'First' });
      const snapshot = await chain.createSnapshot();
      expect(snapshot.entriesCount).toBe(1);
      expect(snapshot.lastEntryId).toBe(entry.id);
      expect(snapshot.lastHash).toHaveLength(64);
      expect(snapshot.lastHash).not.toBe('0'.repeat(64));
    });
  });

  describe('initialize() with existing chain', () => {
    it('should load and verify last entry on init', async () => {
      await chain.record({ event: 'e1', level: 'info', message: 'First' });
      await chain.record({ event: 'e2', level: 'info', message: 'Second' });

      // Create a new chain using the same storage
      const newChain = new AuditChain({ storage, signingKey: SIGNING_KEY });
      await newChain.initialize();

      // Should be able to continue the chain
      const third = await newChain.record({ event: 'e3', level: 'info', message: 'Third' });
      expect(third.integrity.previousEntryHash).not.toBe('0'.repeat(64));

      // Full verify should pass
      const result = await newChain.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesChecked).toBe(3);
    });

    it('should throw if last entry signature is invalid', async () => {
      await chain.record({ event: 'e1', level: 'info', message: 'First' });

      // Create a new chain with a different signing key
      const badChain = new AuditChain({ storage, signingKey: 'b'.repeat(64) });
      await expect(badChain.initialize()).rejects.toThrow('integrity compromised');
    });
  });

  describe('record() validation', () => {
    it('should set id, timestamp, and integrity fields automatically', async () => {
      const entry = await chain.record({
        event: 'test',
        level: 'info',
        message: 'Auto fields',
      });

      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeTypeOf('number');
      expect(entry.integrity.version).toBe('1.0.0');
      expect(entry.integrity.signature).toHaveLength(64);
    });

    it('should include optional fields when provided', async () => {
      const taskId = '00000000-0000-0000-0000-000000000002';
      const correlationId = '00000000-0000-0000-0000-000000000003';
      const entry = await chain.record({
        event: 'test',
        level: 'info',
        message: 'With extras',
        userId: 'user-1',
        taskId,
        correlationId,
        metadata: { key: 'value' },
      });

      expect(entry.userId).toBe('user-1');
      expect(entry.taskId).toBe(taskId);
      expect(entry.correlationId).toBe(correlationId);
      expect(entry.metadata).toEqual({ key: 'value' });
    });
  });
});

describe('InMemoryAuditStorage', () => {
  let storage: InMemoryAuditStorage;

  beforeEach(() => {
    storage = new InMemoryAuditStorage();
  });

  describe('query()', () => {
    it('should return empty result for empty storage', async () => {
      const result = await storage.query();
      expect(result.entries).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should filter by time range', async () => {
      const chain = new AuditChain({ storage, signingKey: SIGNING_KEY });
      await chain.initialize();
      await chain.record({ event: 'e1', level: 'info', message: 'Old' });

      const entries: any[] = [];
      for await (const e of storage.iterate()) entries.push(e);
      const ts = entries[0].timestamp;

      const result = await storage.query({ from: ts, to: ts });
      expect(result.total).toBe(1);
    });

    it('should respect limit and offset', async () => {
      const chain = new AuditChain({ storage, signingKey: SIGNING_KEY });
      await chain.initialize();
      for (let i = 0; i < 5; i++) {
        await chain.record({ event: `e${i}`, level: 'info', message: `Entry ${i}` });
      }

      const result = await storage.query({ limit: 2, offset: 1 });
      expect(result.entries).toHaveLength(2);
      expect(result.limit).toBe(2);
      expect(result.offset).toBe(1);
      expect(result.total).toBe(5);
    });
  });
});
