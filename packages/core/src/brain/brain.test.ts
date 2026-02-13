import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrainStorage } from './storage.js';
import { BrainManager } from './manager.js';
import type { BrainConfig } from '@friday/shared';
import type { BrainManagerDeps } from './types.js';
import type { SecureLogger } from '../logging/logger.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';

// ── Helpers ──────────────────────────────────────────────────────

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  } as SecureLogger;
}

function defaultConfig(overrides?: Partial<BrainConfig>): BrainConfig {
  return {
    enabled: true,
    maxMemories: 10000,
    maxKnowledge: 5000,
    memoryRetentionDays: 90,
    importanceDecayRate: 0.01,
    contextWindowMemories: 10,
    ...overrides,
  };
}

function createDeps(): BrainManagerDeps {
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: 'test-signing-key-must-be-at-least-32-chars!!' });
  return {
    auditChain,
    logger: noopLogger(),
  };
}

// ── BrainStorage Tests ────────────────────────────────────────────

describe('BrainStorage', () => {
  let storage: BrainStorage;

  beforeEach(() => {
    storage = new BrainStorage();
  });

  afterEach(() => {
    storage.close();
  });

  describe('memories', () => {
    it('should create and retrieve a memory', () => {
      const m = storage.createMemory({
        type: 'episodic',
        content: 'User asked about deploying to production',
        source: 'conversation',
      });
      expect(m.id).toBeDefined();
      expect(m.type).toBe('episodic');
      expect(m.content).toContain('deploying');
      expect(m.source).toBe('conversation');
      expect(m.importance).toBe(0.5);
      expect(m.accessCount).toBe(0);

      const retrieved = storage.getMemory(m.id);
      expect(retrieved).toEqual(m);
    });

    it('should return null for non-existent memory', () => {
      expect(storage.getMemory('nonexistent')).toBeNull();
    });

    it('should create memory with custom importance', () => {
      const m = storage.createMemory({
        type: 'semantic',
        content: 'Project uses React 18',
        source: 'observation',
        importance: 0.9,
      });
      expect(m.importance).toBe(0.9);
    });

    it('should create memory with context', () => {
      const m = storage.createMemory({
        type: 'preference',
        content: 'User prefers concise answers',
        source: 'user',
        context: { userId: 'user1', topic: 'style' },
      });
      expect(m.context).toEqual({ userId: 'user1', topic: 'style' });
    });

    it('should create memory with expiration', () => {
      const expires = Date.now() + 86_400_000;
      const m = storage.createMemory({
        type: 'episodic',
        content: 'Temporary event',
        source: 'event',
        expiresAt: expires,
      });
      expect(m.expiresAt).toBe(expires);
    });

    it('should delete a memory', () => {
      const m = storage.createMemory({
        type: 'semantic',
        content: 'Test',
        source: 'test',
      });
      expect(storage.deleteMemory(m.id)).toBe(true);
      expect(storage.getMemory(m.id)).toBeNull();
    });

    it('should return false deleting non-existent memory', () => {
      expect(storage.deleteMemory('nonexistent')).toBe(false);
    });

    it('should query memories by type', () => {
      storage.createMemory({ type: 'episodic', content: 'Event 1', source: 'test' });
      storage.createMemory({ type: 'semantic', content: 'Fact 1', source: 'test' });
      storage.createMemory({ type: 'episodic', content: 'Event 2', source: 'test' });

      const episodic = storage.queryMemories({ type: 'episodic' });
      expect(episodic).toHaveLength(2);
    });

    it('should query memories by search', () => {
      storage.createMemory({ type: 'semantic', content: 'React 18 framework', source: 'test' });
      storage.createMemory({ type: 'semantic', content: 'Vue 3 framework', source: 'test' });

      const results = storage.queryMemories({ search: 'React' });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('React');
    });

    it('should query memories with minImportance', () => {
      storage.createMemory({ type: 'semantic', content: 'Low', source: 'test', importance: 0.2 });
      storage.createMemory({ type: 'semantic', content: 'High', source: 'test', importance: 0.8 });

      const results = storage.queryMemories({ minImportance: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('High');
    });

    it('should query memories with limit', () => {
      for (let i = 0; i < 5; i++) {
        storage.createMemory({ type: 'episodic', content: `Event ${i}`, source: 'test' });
      }
      const results = storage.queryMemories({ limit: 3 });
      expect(results).toHaveLength(3);
    });

    it('should touch memory (update access count)', () => {
      const m = storage.createMemory({ type: 'semantic', content: 'Test', source: 'test' });
      storage.touchMemory(m.id);
      storage.touchMemory(m.id);

      const updated = storage.getMemory(m.id);
      expect(updated?.accessCount).toBe(2);
      expect(updated?.lastAccessedAt).toBeGreaterThan(0);
    });

    it('should batch-touch multiple memories in a single call', () => {
      const m1 = storage.createMemory({ type: 'semantic', content: 'Memory 1', source: 'test' });
      const m2 = storage.createMemory({ type: 'semantic', content: 'Memory 2', source: 'test' });
      const m3 = storage.createMemory({ type: 'episodic', content: 'Memory 3', source: 'test' });

      storage.touchMemories([m1.id, m2.id, m3.id]);

      expect(storage.getMemory(m1.id)?.accessCount).toBe(1);
      expect(storage.getMemory(m2.id)?.accessCount).toBe(1);
      expect(storage.getMemory(m3.id)?.accessCount).toBe(1);
      expect(storage.getMemory(m1.id)?.lastAccessedAt).toBeGreaterThan(0);
    });

    it('should handle empty array in touchMemories', () => {
      // Should not throw
      storage.touchMemories([]);
    });

    it('should decay memories', () => {
      const m = storage.createMemory({
        type: 'semantic',
        content: 'Old fact',
        source: 'test',
        importance: 0.5,
      });

      const decayed = storage.decayMemories(0.1);
      expect(decayed).toBe(1);

      const updated = storage.getMemory(m.id);
      expect(updated?.importance).toBe(0.4);
    });

    it('should prune expired memories', () => {
      storage.createMemory({
        type: 'episodic',
        content: 'Expired',
        source: 'test',
        expiresAt: Date.now() - 1000,
      });
      storage.createMemory({
        type: 'semantic',
        content: 'Active',
        source: 'test',
      });

      const pruned = storage.pruneExpiredMemories();
      expect(pruned).toBe(1);
      expect(storage.getMemoryCount()).toBe(1);
    });

    it('should count memories', () => {
      expect(storage.getMemoryCount()).toBe(0);
      storage.createMemory({ type: 'semantic', content: 'Test', source: 'test' });
      expect(storage.getMemoryCount()).toBe(1);
    });

    it('should count memories by type', () => {
      storage.createMemory({ type: 'episodic', content: 'E1', source: 'test' });
      storage.createMemory({ type: 'episodic', content: 'E2', source: 'test' });
      storage.createMemory({ type: 'semantic', content: 'S1', source: 'test' });

      const counts = storage.getMemoryCountByType();
      expect(counts.episodic).toBe(2);
      expect(counts.semantic).toBe(1);
    });
  });

  describe('knowledge', () => {
    it('should create and retrieve knowledge', () => {
      const k = storage.createKnowledge({
        topic: 'deployment',
        content: 'Production uses Docker Compose',
        source: 'documentation',
      });
      expect(k.id).toBeDefined();
      expect(k.topic).toBe('deployment');
      expect(k.confidence).toBe(0.8);

      const retrieved = storage.getKnowledge(k.id);
      expect(retrieved).toEqual(k);
    });

    it('should return null for non-existent knowledge', () => {
      expect(storage.getKnowledge('nonexistent')).toBeNull();
    });

    it('should create knowledge with custom confidence', () => {
      const k = storage.createKnowledge({
        topic: 'api',
        content: 'REST endpoint on port 18789',
        source: 'config',
        confidence: 1.0,
      });
      expect(k.confidence).toBe(1.0);
    });

    it('should query knowledge by topic', () => {
      storage.createKnowledge({ topic: 'deployment', content: 'Docker', source: 'test' });
      storage.createKnowledge({ topic: 'security', content: 'TLS', source: 'test' });

      const results = storage.queryKnowledge({ topic: 'deployment' });
      expect(results).toHaveLength(1);
      expect(results[0].topic).toBe('deployment');
    });

    it('should query knowledge by search', () => {
      storage.createKnowledge({ topic: 'tech', content: 'Uses React 18', source: 'test' });
      storage.createKnowledge({ topic: 'tech', content: 'Uses Vue 3', source: 'test' });

      const results = storage.queryKnowledge({ search: 'React' });
      expect(results).toHaveLength(1);
    });

    it('should update knowledge', () => {
      const k = storage.createKnowledge({
        topic: 'api',
        content: 'Port 3000',
        source: 'test',
      });
      const updated = storage.updateKnowledge(k.id, { content: 'Port 18789', confidence: 0.95 });
      expect(updated.content).toBe('Port 18789');
      expect(updated.confidence).toBe(0.95);
    });

    it('should update knowledge with supersedes', () => {
      const old = storage.createKnowledge({ topic: 'api', content: 'v1', source: 'test' });
      const newer = storage.createKnowledge({ topic: 'api', content: 'v2', source: 'test' });
      const updated = storage.updateKnowledge(newer.id, { supersedes: old.id });
      expect(updated.supersedes).toBe(old.id);
    });

    it('should throw when updating non-existent knowledge', () => {
      expect(() => storage.updateKnowledge('nonexistent', { content: 'X' })).toThrow('Knowledge not found');
    });

    it('should delete knowledge', () => {
      const k = storage.createKnowledge({ topic: 'test', content: 'Test', source: 'test' });
      expect(storage.deleteKnowledge(k.id)).toBe(true);
      expect(storage.getKnowledge(k.id)).toBeNull();
    });

    it('should count knowledge', () => {
      expect(storage.getKnowledgeCount()).toBe(0);
      storage.createKnowledge({ topic: 'test', content: 'Test', source: 'test' });
      expect(storage.getKnowledgeCount()).toBe(1);
    });
  });

  describe('skills', () => {
    it('should create and retrieve a skill', () => {
      const s = storage.createSkill({
        name: 'code-review',
        description: 'Reviews code',
        instructions: 'Review the code carefully.',
        tools: [],
        triggerPatterns: ['review'],
        enabled: true,
        source: 'user',
        status: 'active',
      });
      expect(s.id).toBeDefined();
      expect(s.name).toBe('code-review');

      const retrieved = storage.getSkill(s.id);
      expect(retrieved).toEqual(s);
    });

    it('should list enabled skills', () => {
      storage.createSkill({ name: 's1', enabled: true, source: 'user', status: 'active' });
      storage.createSkill({ name: 's2', enabled: false, source: 'user', status: 'active' });

      const enabled = storage.getEnabledSkills();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('s1');
    });

    it('should increment usage', () => {
      const s = storage.createSkill({ name: 's1', source: 'user', status: 'active' });
      storage.incrementUsage(s.id);
      const updated = storage.getSkill(s.id);
      expect(updated?.usageCount).toBe(1);
    });
  });

  describe('brain meta', () => {
    it('should get and set meta', () => {
      expect(storage.getMeta('test')).toBeNull();
      storage.setMeta('test', 'value');
      expect(storage.getMeta('test')).toBe('value');
    });

    it('should overwrite meta', () => {
      storage.setMeta('key', 'v1');
      storage.setMeta('key', 'v2');
      expect(storage.getMeta('key')).toBe('v2');
    });
  });

  describe('stats', () => {
    it('should return brain stats', () => {
      storage.createMemory({ type: 'semantic', content: 'Test', source: 'test' });
      storage.createKnowledge({ topic: 'test', content: 'Test', source: 'test' });
      storage.createSkill({ name: 's1', source: 'user', status: 'active' });

      const stats = storage.getStats();
      expect(stats.memories.total).toBe(1);
      expect(stats.knowledge.total).toBe(1);
      expect(stats.skills.total).toBe(1);
    });
  });
});

// ── BrainManager Tests ────────────────────────────────────────────

describe('BrainManager', () => {
  let storage: BrainStorage;
  let manager: BrainManager;

  beforeEach(() => {
    storage = new BrainStorage();
    manager = new BrainManager(storage, defaultConfig(), createDeps());
  });

  afterEach(() => {
    storage.close();
  });

  describe('memory operations', () => {
    it('should remember and recall', () => {
      const m = manager.remember('semantic', 'React is a UI framework', 'learning');
      expect(m.type).toBe('semantic');

      const recalled = manager.recall({ type: 'semantic' });
      expect(recalled).toHaveLength(1);
      expect(recalled[0].content).toContain('React');
    });

    it('should forget a memory', () => {
      const m = manager.remember('episodic', 'Test event', 'test');
      manager.forget(m.id);
      expect(manager.getMemory(m.id)).toBeNull();
    });

    it('should add expiration to episodic memories', () => {
      const m = manager.remember('episodic', 'Event', 'test');
      expect(m.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should not add expiration to semantic memories', () => {
      const m = manager.remember('semantic', 'Fact', 'test');
      expect(m.expiresAt).toBeNull();
    });

    it('should touch memories on recall', () => {
      const m = manager.remember('semantic', 'Test', 'test');
      manager.recall({ type: 'semantic' });

      const updated = manager.getMemory(m.id);
      expect(updated?.accessCount).toBe(1);
    });

    it('should batch-touch memories on recall', () => {
      const m1 = manager.remember('semantic', 'First memory', 'test');
      const m2 = manager.remember('semantic', 'Second memory', 'test');
      const m3 = manager.remember('semantic', 'Third memory', 'test');

      manager.recall({ type: 'semantic' });

      // All memories should be touched in a single batch
      expect(manager.getMemory(m1.id)?.accessCount).toBe(1);
      expect(manager.getMemory(m2.id)?.accessCount).toBe(1);
      expect(manager.getMemory(m3.id)?.accessCount).toBe(1);
    });

    it('should throw when brain is disabled', () => {
      const mgr = new BrainManager(storage, defaultConfig({ enabled: false }), createDeps());
      expect(() => mgr.remember('semantic', 'Test', 'test')).toThrow('Brain is not enabled');
    });

    it('should return empty on recall when disabled', () => {
      const mgr = new BrainManager(storage, defaultConfig({ enabled: false }), createDeps());
      expect(mgr.recall({})).toEqual([]);
    });
  });

  describe('knowledge operations', () => {
    it('should learn and lookup', () => {
      manager.learn('deployment', 'Uses Docker', 'docs');
      const results = manager.lookup('deployment');
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Uses Docker');
    });

    it('should throw when max knowledge reached', () => {
      const mgr = new BrainManager(storage, defaultConfig({ maxKnowledge: 2 }), createDeps());
      mgr.learn('t1', 'c1', 's');
      mgr.learn('t2', 'c2', 's');
      expect(() => mgr.learn('t3', 'c3', 's')).toThrow('Maximum knowledge limit');
    });

    it('should update knowledge', () => {
      const k = manager.learn('api', 'Port 3000', 'test');
      const updated = manager.updateKnowledge(k.id, { content: 'Port 18789' });
      expect(updated.content).toBe('Port 18789');
    });

    it('should delete knowledge', () => {
      const k = manager.learn('test', 'Test', 'test');
      manager.deleteKnowledge(k.id);
      expect(manager.lookup('test')).toHaveLength(0);
    });

    it('should query knowledge', () => {
      manager.learn('tech', 'React 18', 'test');
      manager.learn('tech', 'Vue 3', 'test');

      const results = manager.queryKnowledge({ search: 'React' });
      expect(results).toHaveLength(1);
    });
  });

  describe('prompt integration', () => {
    it('should return relevant context for input', () => {
      manager.remember('semantic', 'React is used for the frontend', 'observation');
      manager.learn('frontend', 'React 18 framework', 'docs');

      const context = manager.getRelevantContext('React');
      expect(context).toContain('## Brain');
      expect(context).toContain('Your Brain is your mind');
      expect(context).toContain('### Memories');
      expect(context).toContain('React');
    });

    it('should return empty when disabled', () => {
      const mgr = new BrainManager(storage, defaultConfig({ enabled: false }), createDeps());
      expect(mgr.getRelevantContext('anything')).toBe('');
    });

    it('should return empty when no matches', () => {
      const context = manager.getRelevantContext('nonexistent topic xyz');
      expect(context).toBe('');
    });

    it('should batch-touch memories in getRelevantContext', () => {
      const m1 = manager.remember('semantic', 'React component lifecycle', 'test');
      const m2 = manager.remember('semantic', 'React hooks patterns', 'test');

      manager.getRelevantContext('React');

      // Both memories should have been touched via batch update
      expect(manager.getMemory(m1.id)?.accessCount).toBe(1);
      expect(manager.getMemory(m2.id)?.accessCount).toBe(1);
    });
  });

  describe('skill operations', () => {
    it('should create and get skills', () => {
      const s = manager.createSkill({ name: 'test-skill', source: 'user', status: 'active' });
      expect(manager.getSkill(s.id)?.name).toBe('test-skill');
    });

    it('should list and filter skills', () => {
      manager.createSkill({ name: 's1', source: 'user', status: 'active' });
      manager.createSkill({ name: 's2', source: 'ai_proposed', status: 'pending_approval' });

      expect(manager.listSkills()).toHaveLength(2);
      expect(manager.listSkills({ source: 'user' })).toHaveLength(1);
    });

    it('should enable and disable skills', () => {
      const s = manager.createSkill({ name: 's1', source: 'user', status: 'active' });
      manager.disableSkill(s.id);
      expect(manager.getSkill(s.id)?.enabled).toBe(false);
      manager.enableSkill(s.id);
      expect(manager.getSkill(s.id)?.enabled).toBe(true);
    });

    it('should approve pending skills', () => {
      const s = manager.createSkill({ name: 's1', source: 'ai_proposed', status: 'pending_approval', enabled: false });
      const approved = manager.approveSkill(s.id);
      expect(approved.status).toBe('active');
    });

    it('should reject pending skills', () => {
      const s = manager.createSkill({ name: 's1', source: 'ai_proposed', status: 'pending_approval', enabled: false });
      manager.rejectSkill(s.id);
      expect(manager.getSkill(s.id)).toBeNull();
    });

    it('should throw when approving non-pending skill', () => {
      const s = manager.createSkill({ name: 's1', source: 'user', status: 'active' });
      expect(() => manager.approveSkill(s.id)).toThrow('not pending approval');
    });

    it('should get active tools from enabled skills', () => {
      manager.createSkill({
        name: 's1',
        source: 'user',
        status: 'active',
        tools: [{ name: 'search', description: 'Search', parameters: { type: 'object', properties: {} } }],
      });
      const tools = manager.getActiveTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
    });

    it('should increment skill usage', () => {
      const s = manager.createSkill({ name: 's1', source: 'user', status: 'active' });
      manager.incrementSkillUsage(s.id);
      expect(manager.getSkill(s.id)?.usageCount).toBe(1);
    });
  });

  describe('maintenance', () => {
    it('should run maintenance (decay + prune)', () => {
      manager.remember('episodic', 'Old event', 'test');
      const result = manager.runMaintenance();
      expect(result).toHaveProperty('decayed');
      expect(result).toHaveProperty('pruned');
    });
  });

  describe('stats', () => {
    it('should return stats', () => {
      manager.remember('semantic', 'Test', 'test');
      manager.learn('topic', 'Content', 'test');

      const stats = manager.getStats();
      expect(stats.memories.total).toBe(1);
      expect(stats.knowledge.total).toBe(1);
    });
  });
});
