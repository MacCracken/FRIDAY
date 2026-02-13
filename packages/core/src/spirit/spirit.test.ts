import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpiritStorage } from './storage.js';
import { SpiritManager } from './manager.js';
import type { SpiritConfig, SpiritManagerDeps, PassionCreate, InspirationCreate, PainCreate } from './types.js';
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

function defaultConfig(overrides?: Partial<SpiritConfig>): SpiritConfig {
  return {
    enabled: true,
    maxPassions: 20,
    maxInspirations: 20,
    maxPains: 20,
    ...overrides,
  };
}

function createDeps(): SpiritManagerDeps & { auditStorage: InMemoryAuditStorage } {
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: 'test-signing-key-must-be-at-least-32-chars!!' });
  return {
    auditChain,
    auditStorage,
    logger: noopLogger(),
  };
}

const TEST_PASSION: PassionCreate = {
  name: 'Open Source',
  description: 'Building and contributing to open source software',
  intensity: 0.9,
  isActive: true,
};

const TEST_INSPIRATION: InspirationCreate = {
  source: 'Alan Turing',
  description: 'Pioneer of computational theory and AI',
  impact: 0.95,
  isActive: true,
};

const TEST_PAIN: PainCreate = {
  trigger: 'Data Loss',
  description: 'Losing user data due to system failure',
  severity: 0.8,
  isActive: true,
};

// ── SpiritStorage Tests ────────────────────────────────────────

describe('SpiritStorage', () => {
  let storage: SpiritStorage;

  beforeEach(() => {
    storage = new SpiritStorage(); // :memory:
  });

  afterEach(() => {
    storage.close();
  });

  describe('passions', () => {
    it('should create and retrieve a passion', () => {
      const p = storage.createPassion(TEST_PASSION);
      expect(p.id).toBeDefined();
      expect(p.name).toBe('Open Source');
      expect(p.description).toBe('Building and contributing to open source software');
      expect(p.intensity).toBe(0.9);
      expect(p.isActive).toBe(true);

      const retrieved = storage.getPassion(p.id);
      expect(retrieved).toEqual(p);
    });

    it('should return null for non-existent passion', () => {
      expect(storage.getPassion('nonexistent')).toBeNull();
    });

    it('should update a passion', () => {
      const p = storage.createPassion(TEST_PASSION);
      const updated = storage.updatePassion(p.id, { name: 'Closed Source', intensity: 0.3 });
      expect(updated.name).toBe('Closed Source');
      expect(updated.intensity).toBe(0.3);
      expect(updated.description).toBe(p.description); // unchanged
    });

    it('should throw when updating non-existent passion', () => {
      expect(() => storage.updatePassion('nonexistent', { name: 'X' })).toThrow('Passion not found');
    });

    it('should delete a passion', () => {
      const p = storage.createPassion(TEST_PASSION);
      expect(storage.deletePassion(p.id)).toBe(true);
      expect(storage.getPassion(p.id)).toBeNull();
    });

    it('should return false when deleting non-existent passion', () => {
      expect(storage.deletePassion('nonexistent')).toBe(false);
    });

    it('should list passions ordered by intensity', () => {
      storage.createPassion({ ...TEST_PASSION, name: 'Low', intensity: 0.1 });
      storage.createPassion({ ...TEST_PASSION, name: 'High', intensity: 0.9 });
      const list = storage.listPassions();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('High');
    });

    it('should get active passions only', () => {
      storage.createPassion(TEST_PASSION);
      storage.createPassion({ ...TEST_PASSION, name: 'Inactive', isActive: false });
      const active = storage.getActivePassions();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Open Source');
    });

    it('should count passions', () => {
      expect(storage.getPassionCount()).toBe(0);
      storage.createPassion(TEST_PASSION);
      expect(storage.getPassionCount()).toBe(1);
    });
  });

  describe('inspirations', () => {
    it('should create and retrieve an inspiration', () => {
      const i = storage.createInspiration(TEST_INSPIRATION);
      expect(i.id).toBeDefined();
      expect(i.source).toBe('Alan Turing');
      expect(i.description).toBe('Pioneer of computational theory and AI');
      expect(i.impact).toBe(0.95);
      expect(i.isActive).toBe(true);

      const retrieved = storage.getInspiration(i.id);
      expect(retrieved).toEqual(i);
    });

    it('should return null for non-existent inspiration', () => {
      expect(storage.getInspiration('nonexistent')).toBeNull();
    });

    it('should update an inspiration', () => {
      const i = storage.createInspiration(TEST_INSPIRATION);
      const updated = storage.updateInspiration(i.id, { source: 'Ada Lovelace', impact: 0.99 });
      expect(updated.source).toBe('Ada Lovelace');
      expect(updated.impact).toBe(0.99);
      expect(updated.description).toBe(i.description);
    });

    it('should throw when updating non-existent inspiration', () => {
      expect(() => storage.updateInspiration('nonexistent', { source: 'X' })).toThrow('Inspiration not found');
    });

    it('should delete an inspiration', () => {
      const i = storage.createInspiration(TEST_INSPIRATION);
      expect(storage.deleteInspiration(i.id)).toBe(true);
      expect(storage.getInspiration(i.id)).toBeNull();
    });

    it('should return false when deleting non-existent inspiration', () => {
      expect(storage.deleteInspiration('nonexistent')).toBe(false);
    });

    it('should list inspirations ordered by impact', () => {
      storage.createInspiration({ ...TEST_INSPIRATION, source: 'Low', impact: 0.1 });
      storage.createInspiration({ ...TEST_INSPIRATION, source: 'High', impact: 0.9 });
      const list = storage.listInspirations();
      expect(list).toHaveLength(2);
      expect(list[0].source).toBe('High');
    });

    it('should get active inspirations only', () => {
      storage.createInspiration(TEST_INSPIRATION);
      storage.createInspiration({ ...TEST_INSPIRATION, source: 'Inactive', isActive: false });
      const active = storage.getActiveInspirations();
      expect(active).toHaveLength(1);
      expect(active[0].source).toBe('Alan Turing');
    });

    it('should count inspirations', () => {
      expect(storage.getInspirationCount()).toBe(0);
      storage.createInspiration(TEST_INSPIRATION);
      expect(storage.getInspirationCount()).toBe(1);
    });
  });

  describe('pains', () => {
    it('should create and retrieve a pain', () => {
      const p = storage.createPain(TEST_PAIN);
      expect(p.id).toBeDefined();
      expect(p.trigger).toBe('Data Loss');
      expect(p.description).toBe('Losing user data due to system failure');
      expect(p.severity).toBe(0.8);
      expect(p.isActive).toBe(true);

      const retrieved = storage.getPain(p.id);
      expect(retrieved).toEqual(p);
    });

    it('should return null for non-existent pain', () => {
      expect(storage.getPain('nonexistent')).toBeNull();
    });

    it('should update a pain', () => {
      const p = storage.createPain(TEST_PAIN);
      const updated = storage.updatePain(p.id, { trigger: 'Memory Leak', severity: 0.6 });
      expect(updated.trigger).toBe('Memory Leak');
      expect(updated.severity).toBe(0.6);
      expect(updated.description).toBe(p.description);
    });

    it('should throw when updating non-existent pain', () => {
      expect(() => storage.updatePain('nonexistent', { trigger: 'X' })).toThrow('Pain not found');
    });

    it('should delete a pain', () => {
      const p = storage.createPain(TEST_PAIN);
      expect(storage.deletePain(p.id)).toBe(true);
      expect(storage.getPain(p.id)).toBeNull();
    });

    it('should return false when deleting non-existent pain', () => {
      expect(storage.deletePain('nonexistent')).toBe(false);
    });

    it('should list pains ordered by severity', () => {
      storage.createPain({ ...TEST_PAIN, trigger: 'Low', severity: 0.1 });
      storage.createPain({ ...TEST_PAIN, trigger: 'High', severity: 0.9 });
      const list = storage.listPains();
      expect(list).toHaveLength(2);
      expect(list[0].trigger).toBe('High');
    });

    it('should get active pains only', () => {
      storage.createPain(TEST_PAIN);
      storage.createPain({ ...TEST_PAIN, trigger: 'Inactive', isActive: false });
      const active = storage.getActivePains();
      expect(active).toHaveLength(1);
      expect(active[0].trigger).toBe('Data Loss');
    });

    it('should count pains', () => {
      expect(storage.getPainCount()).toBe(0);
      storage.createPain(TEST_PAIN);
      expect(storage.getPainCount()).toBe(1);
    });
  });

  describe('spirit meta', () => {
    it('should return null for non-existent meta key', () => {
      expect(storage.getMeta('nonexistent')).toBeNull();
    });

    it('should set and get meta', () => {
      storage.setMeta('theme', 'growth');
      expect(storage.getMeta('theme')).toBe('growth');
    });

    it('should overwrite existing meta', () => {
      storage.setMeta('theme', 'growth');
      storage.setMeta('theme', 'resilience');
      expect(storage.getMeta('theme')).toBe('resilience');
    });
  });
});

// ── SpiritManager Tests ────────────────────────────────────────

describe('SpiritManager', () => {
  let storage: SpiritStorage;
  let manager: SpiritManager;
  let deps: SpiritManagerDeps;

  beforeEach(() => {
    storage = new SpiritStorage();
    deps = createDeps();
    manager = new SpiritManager(storage, defaultConfig(), deps);
  });

  afterEach(() => {
    storage.close();
  });

  describe('passion management', () => {
    it('should create and list passions', () => {
      manager.createPassion(TEST_PASSION);
      expect(manager.listPassions()).toHaveLength(1);
    });

    it('should enforce max passions limit', () => {
      const mgr = new SpiritManager(storage, defaultConfig({ maxPassions: 2 }), deps);
      mgr.createPassion(TEST_PASSION);
      mgr.createPassion({ ...TEST_PASSION, name: 'Second' });
      expect(() => mgr.createPassion({ ...TEST_PASSION, name: 'Third' })).toThrow('Maximum passion limit');
    });

    it('should get active passions', () => {
      manager.createPassion(TEST_PASSION);
      manager.createPassion({ ...TEST_PASSION, name: 'Inactive', isActive: false });
      expect(manager.getActivePassions()).toHaveLength(1);
    });

    it('should update and delete passions', () => {
      const p = manager.createPassion(TEST_PASSION);
      const updated = manager.updatePassion(p.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
      expect(manager.deletePassion(p.id)).toBe(true);
      expect(manager.listPassions()).toHaveLength(0);
    });
  });

  describe('inspiration management', () => {
    it('should create and list inspirations', () => {
      manager.createInspiration(TEST_INSPIRATION);
      expect(manager.listInspirations()).toHaveLength(1);
    });

    it('should enforce max inspirations limit', () => {
      const mgr = new SpiritManager(storage, defaultConfig({ maxInspirations: 2 }), deps);
      mgr.createInspiration(TEST_INSPIRATION);
      mgr.createInspiration({ ...TEST_INSPIRATION, source: 'Second' });
      expect(() => mgr.createInspiration({ ...TEST_INSPIRATION, source: 'Third' })).toThrow('Maximum inspiration limit');
    });

    it('should get active inspirations', () => {
      manager.createInspiration(TEST_INSPIRATION);
      manager.createInspiration({ ...TEST_INSPIRATION, source: 'Inactive', isActive: false });
      expect(manager.getActiveInspirations()).toHaveLength(1);
    });

    it('should update and delete inspirations', () => {
      const i = manager.createInspiration(TEST_INSPIRATION);
      const updated = manager.updateInspiration(i.id, { source: 'Updated' });
      expect(updated.source).toBe('Updated');
      expect(manager.deleteInspiration(i.id)).toBe(true);
      expect(manager.listInspirations()).toHaveLength(0);
    });
  });

  describe('pain management', () => {
    it('should create and list pains', () => {
      manager.createPain(TEST_PAIN);
      expect(manager.listPains()).toHaveLength(1);
    });

    it('should enforce max pains limit', () => {
      const mgr = new SpiritManager(storage, defaultConfig({ maxPains: 2 }), deps);
      mgr.createPain(TEST_PAIN);
      mgr.createPain({ ...TEST_PAIN, trigger: 'Second' });
      expect(() => mgr.createPain({ ...TEST_PAIN, trigger: 'Third' })).toThrow('Maximum pain limit');
    });

    it('should get active pains', () => {
      manager.createPain(TEST_PAIN);
      manager.createPain({ ...TEST_PAIN, trigger: 'Inactive', isActive: false });
      expect(manager.getActivePains()).toHaveLength(1);
    });

    it('should update and delete pains', () => {
      const p = manager.createPain(TEST_PAIN);
      const updated = manager.updatePain(p.id, { trigger: 'Updated' });
      expect(updated.trigger).toBe('Updated');
      expect(manager.deletePain(p.id)).toBe(true);
      expect(manager.listPains()).toHaveLength(0);
    });
  });

  describe('prompt composition', () => {
    it('should return empty string when disabled', () => {
      const mgr = new SpiritManager(storage, defaultConfig({ enabled: false }), deps);
      expect(mgr.composeSpiritPrompt()).toBe('');
    });

    it('should return empty string with no passions, inspirations, or pains', () => {
      expect(manager.composeSpiritPrompt()).toBe('');
    });

    it('should include passions in prompt', () => {
      manager.createPassion(TEST_PASSION);
      const prompt = manager.composeSpiritPrompt();
      expect(prompt).toContain('## Spirit');
      expect(prompt).toContain('Your Spirit is your drive');
      expect(prompt).toContain('### Passions');
      expect(prompt).toContain('Open Source');
      expect(prompt).toContain('intensity: 0.9');
    });

    it('should include inspirations in prompt', () => {
      manager.createInspiration(TEST_INSPIRATION);
      const prompt = manager.composeSpiritPrompt();
      expect(prompt).toContain('### Inspirations');
      expect(prompt).toContain('Alan Turing');
      expect(prompt).toContain('impact: 0.95');
    });

    it('should include pains in prompt', () => {
      manager.createPain(TEST_PAIN);
      const prompt = manager.composeSpiritPrompt();
      expect(prompt).toContain('### Pain Points');
      expect(prompt).toContain('Data Loss');
      expect(prompt).toContain('severity: 0.8');
    });

    it('should compose all three sections', () => {
      manager.createPassion(TEST_PASSION);
      manager.createInspiration(TEST_INSPIRATION);
      manager.createPain(TEST_PAIN);
      const prompt = manager.composeSpiritPrompt();
      expect(prompt).toContain('### Passions');
      expect(prompt).toContain('### Inspirations');
      expect(prompt).toContain('### Pain Points');
    });

    it('should exclude inactive items from prompt', () => {
      manager.createPassion({ ...TEST_PASSION, isActive: false });
      manager.createInspiration({ ...TEST_INSPIRATION, isActive: false });
      manager.createPain({ ...TEST_PAIN, isActive: false });
      expect(manager.composeSpiritPrompt()).toBe('');
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      manager.createPassion(TEST_PASSION);
      manager.createPassion({ ...TEST_PASSION, name: 'Inactive', isActive: false });
      manager.createInspiration(TEST_INSPIRATION);
      manager.createPain(TEST_PAIN);
      manager.createPain({ ...TEST_PAIN, trigger: 'Inactive', isActive: false });

      const stats = manager.getStats();
      expect(stats.passions.total).toBe(2);
      expect(stats.passions.active).toBe(1);
      expect(stats.inspirations.total).toBe(1);
      expect(stats.inspirations.active).toBe(1);
      expect(stats.pains.total).toBe(2);
      expect(stats.pains.active).toBe(1);
    });
  });

  describe('config', () => {
    it('should return config', () => {
      expect(manager.getConfig()).toEqual(defaultConfig());
    });
  });
});
