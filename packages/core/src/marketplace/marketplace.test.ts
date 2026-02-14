import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarketplaceStorage } from './storage.js';
import { MarketplaceManager } from './manager.js';
import { BrainStorage } from '../brain/storage.js';
import { BrainManager } from '../brain/manager.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { createNoopLogger } from '../logging/logger.js';
import type { SecureLogger } from '../logging/logger.js';
import { existsSync, unlinkSync } from 'node:fs';

const TEST_DB = '/tmp/marketplace-test.db';

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  } as SecureLogger;
}

function createBrainManager(): { brainStorage: BrainStorage; brainManager: BrainManager } {
  const brainStorage = new BrainStorage();
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: 'test-signing-key-must-be-at-least-32-chars!!' });
  const brainManager = new BrainManager(brainStorage, {
    enabled: true, maxMemories: 10000, maxKnowledge: 5000,
    memoryRetentionDays: 90, importanceDecayRate: 0.01, contextWindowMemories: 10,
  }, { auditChain, logger: noopLogger() });
  return { brainStorage, brainManager };
}

describe('MarketplaceStorage', () => {
  let storage: MarketplaceStorage;
  beforeEach(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); storage = new MarketplaceStorage({ dbPath: TEST_DB }); });
  afterEach(() => { storage.close(); if (existsSync(TEST_DB)) unlinkSync(TEST_DB); });

  it('should add and retrieve a skill', () => {
    const skill = storage.addSkill({ name: 'Test Skill', category: 'ai' });
    expect(skill.id).toBeTruthy();
    expect(storage.getSkill(skill.id)!.name).toBe('Test Skill');
  });

  it('should search skills', () => {
    storage.addSkill({ name: 'AI Helper', category: 'ai' });
    storage.addSkill({ name: 'Code Formatter', category: 'dev' });
    const { skills, total } = storage.search('AI');
    expect(total).toBe(1);
    expect(skills[0].name).toBe('AI Helper');
  });

  it('should install/uninstall', () => {
    const skill = storage.addSkill({ name: 'Installable' });
    expect(storage.setInstalled(skill.id, true)).toBe(true);
    expect(storage.getSkill(skill.id)!.installed).toBe(true);
    expect(storage.setInstalled(skill.id, false)).toBe(true);
    expect(storage.getSkill(skill.id)!.installed).toBe(false);
  });

  it('should delete skills', () => {
    const skill = storage.addSkill({ name: 'Deletable' });
    expect(storage.delete(skill.id)).toBe(true);
    expect(storage.getSkill(skill.id)).toBeNull();
  });

  it('should seed builtin skills', () => {
    storage.seedBuiltinSkills();
    const { skills } = storage.search('Summarize');
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Summarize Text');
    expect(skills[0].author).toBe('FRIDAY');
    expect(skills[0].category).toBe('utilities');
  });

  it('should be idempotent when seeding builtin skills', () => {
    storage.seedBuiltinSkills();
    storage.seedBuiltinSkills();
    const { skills } = storage.search('Summarize');
    expect(skills).toHaveLength(1);
  });
});

describe('MarketplaceManager', () => {
  let storage: MarketplaceStorage;
  let manager: MarketplaceManager;
  beforeEach(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); storage = new MarketplaceStorage({ dbPath: TEST_DB }); manager = new MarketplaceManager(storage, { logger: createNoopLogger() }); });
  afterEach(() => { storage.close(); if (existsSync(TEST_DB)) unlinkSync(TEST_DB); });

  it('should publish and search', () => {
    manager.publish({ name: 'Published Skill', category: 'test' });
    const { skills } = manager.search();
    expect(skills).toHaveLength(1);
  });

  it('should install and uninstall', () => {
    const skill = manager.publish({ name: 'My Skill' });
    expect(manager.install(skill.id)).toBe(true);
    expect(manager.getSkill(skill.id)!.installed).toBe(true);
    expect(manager.uninstall(skill.id)).toBe(true);
  });

  it('should return false when installing a non-existent skill', () => {
    expect(manager.install('non-existent-id')).toBe(false);
  });

  it('should seed builtin skills via manager', () => {
    manager.seedBuiltinSkills();
    const { skills } = manager.search('Summarize');
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('Summarize Text');
  });
});

describe('MarketplaceManager with BrainManager', () => {
  let storage: MarketplaceStorage;
  let manager: MarketplaceManager;
  let brainStorage: BrainStorage;
  let brainManager: BrainManager;

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    storage = new MarketplaceStorage({ dbPath: TEST_DB });
    const brain = createBrainManager();
    brainStorage = brain.brainStorage;
    brainManager = brain.brainManager;
    manager = new MarketplaceManager(storage, {
      logger: createNoopLogger(),
      brainManager,
    });
  });

  afterEach(() => {
    storage.close();
    brainStorage.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('should create a brain skill on install', () => {
    const skill = manager.publish({
      name: 'Test Marketplace Skill',
      description: 'A test skill',
      instructions: 'Do the thing',
    });
    manager.install(skill.id);

    const brainSkills = brainManager.listSkills({ source: 'marketplace' });
    expect(brainSkills).toHaveLength(1);
    expect(brainSkills[0].name).toBe('Test Marketplace Skill');
    expect(brainSkills[0].source).toBe('marketplace');
    expect(brainSkills[0].instructions).toBe('Do the thing');
  });

  it('should remove the brain skill on uninstall', () => {
    const skill = manager.publish({ name: 'Removable Skill', instructions: 'Instructions here' });
    manager.install(skill.id);
    expect(brainManager.listSkills({ source: 'marketplace' })).toHaveLength(1);

    manager.uninstall(skill.id);
    expect(brainManager.listSkills({ source: 'marketplace' })).toHaveLength(0);
  });

  it('should not create duplicate brain skills on double install', () => {
    const skill = manager.publish({ name: 'Double Install' });
    manager.install(skill.id);
    // Second install won't flip storage again (already installed), so no duplicate
    manager.install(skill.id);
    const brainSkills = brainManager.listSkills({ source: 'marketplace' });
    expect(brainSkills).toHaveLength(1);
  });
});
