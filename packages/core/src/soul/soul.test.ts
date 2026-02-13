import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SoulStorage } from './storage.js';
import { SoulManager } from './manager.js';
import type { SoulConfig, SoulManagerDeps, PersonalityCreate, SkillCreate } from './types.js';
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

function defaultConfig(overrides?: Partial<SoulConfig>): SoulConfig {
  return {
    enabled: true,
    learningMode: ['user_authored'],
    maxSkills: 50,
    maxPromptTokens: 4096,
    ...overrides,
  };
}

function createDeps(): SoulManagerDeps & { auditStorage: InMemoryAuditStorage } {
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: 'test-signing-key-must-be-at-least-32-chars!!' });
  return {
    auditChain,
    auditStorage,
    logger: noopLogger(),
  };
}

const TEST_PERSONALITY: PersonalityCreate = {
  name: 'TestBot',
  description: 'A test personality',
  systemPrompt: 'You are a test bot.',
  traits: { humor: 'dry', formality: 'casual' },
  sex: 'unspecified',
  voice: '',
  preferredLanguage: '',
  defaultModel: null,
};

const TEST_SKILL: SkillCreate = {
  name: 'code-review',
  description: 'Reviews code for issues',
  instructions: 'Review the code carefully. Look for bugs, security issues, and style problems.',
  tools: [],
  triggerPatterns: ['review', 'code review'],
  enabled: true,
  source: 'user',
  status: 'active',
};

// ── SoulStorage Tests ────────────────────────────────────────────

describe('SoulStorage', () => {
  let storage: SoulStorage;

  beforeEach(() => {
    storage = new SoulStorage(); // :memory:
  });

  afterEach(() => {
    storage.close();
  });

  describe('personalities', () => {
    it('should create and retrieve a personality', () => {
      const p = storage.createPersonality(TEST_PERSONALITY);
      expect(p.id).toBeDefined();
      expect(p.name).toBe('TestBot');
      expect(p.description).toBe('A test personality');
      expect(p.systemPrompt).toBe('You are a test bot.');
      expect(p.traits).toEqual({ humor: 'dry', formality: 'casual' });
      expect(p.sex).toBe('unspecified');
      expect(p.isActive).toBe(false);

      const retrieved = storage.getPersonality(p.id);
      expect(retrieved).toEqual(p);
    });

    it('should return null for non-existent personality', () => {
      expect(storage.getPersonality('nonexistent')).toBeNull();
    });

    it('should set and get active personality', () => {
      const p = storage.createPersonality(TEST_PERSONALITY);
      expect(storage.getActivePersonality()).toBeNull();

      storage.setActivePersonality(p.id);
      const active = storage.getActivePersonality();
      expect(active?.id).toBe(p.id);
      expect(active?.isActive).toBe(true);
    });

    it('should deactivate previous personality when setting new active', () => {
      const p1 = storage.createPersonality(TEST_PERSONALITY);
      const p2 = storage.createPersonality({ ...TEST_PERSONALITY, name: 'Bot2' });

      storage.setActivePersonality(p1.id);
      storage.setActivePersonality(p2.id);

      const p1Updated = storage.getPersonality(p1.id);
      const p2Updated = storage.getPersonality(p2.id);
      expect(p1Updated?.isActive).toBe(false);
      expect(p2Updated?.isActive).toBe(true);
    });

    it('should throw when setting non-existent personality as active', () => {
      expect(() => storage.setActivePersonality('nonexistent')).toThrow('Personality not found');
    });

    it('should update a personality', () => {
      const p = storage.createPersonality(TEST_PERSONALITY);
      const updated = storage.updatePersonality(p.id, { name: 'UpdatedBot', voice: 'warm and friendly' });
      expect(updated.name).toBe('UpdatedBot');
      expect(updated.voice).toBe('warm and friendly');
      expect(updated.description).toBe(p.description); // unchanged
    });

    it('should throw when updating non-existent personality', () => {
      expect(() => storage.updatePersonality('nonexistent', { name: 'X' })).toThrow('Personality not found');
    });

    it('should delete a personality', () => {
      const p = storage.createPersonality(TEST_PERSONALITY);
      expect(storage.deletePersonality(p.id)).toBe(true);
      expect(storage.getPersonality(p.id)).toBeNull();
    });

    it('should return false when deleting non-existent personality', () => {
      expect(storage.deletePersonality('nonexistent')).toBe(false);
    });

    it('should list personalities', () => {
      storage.createPersonality(TEST_PERSONALITY);
      storage.createPersonality({ ...TEST_PERSONALITY, name: 'Bot2' });
      const list = storage.listPersonalities();
      expect(list).toHaveLength(2);
    });

    it('should count personalities', () => {
      expect(storage.getPersonalityCount()).toBe(0);
      storage.createPersonality(TEST_PERSONALITY);
      expect(storage.getPersonalityCount()).toBe(1);
    });

    it('should store sex field correctly', () => {
      const p = storage.createPersonality({ ...TEST_PERSONALITY, sex: 'female' });
      expect(p.sex).toBe('female');
    });

    it('should store voice field correctly', () => {
      const p = storage.createPersonality({ ...TEST_PERSONALITY, voice: 'warm and authoritative' });
      expect(p.voice).toBe('warm and authoritative');
    });

    it('should store preferredLanguage field correctly', () => {
      const p = storage.createPersonality({ ...TEST_PERSONALITY, preferredLanguage: 'Spanish' });
      expect(p.preferredLanguage).toBe('Spanish');
    });
  });

  describe('agent name (soul_meta)', () => {
    it('should return null when no agent name is set', () => {
      expect(storage.getAgentName()).toBeNull();
    });

    it('should set and get the agent name', () => {
      storage.setAgentName('JARVIS');
      expect(storage.getAgentName()).toBe('JARVIS');
    });

    it('should overwrite existing agent name', () => {
      storage.setAgentName('JARVIS');
      storage.setAgentName('FRIDAY');
      expect(storage.getAgentName()).toBe('FRIDAY');
    });
  });

  describe('skills', () => {
    it('should create and retrieve a skill', () => {
      const s = storage.createSkill(TEST_SKILL);
      expect(s.id).toBeDefined();
      expect(s.name).toBe('code-review');
      expect(s.instructions).toContain('Review the code');
      expect(s.enabled).toBe(true);
      expect(s.source).toBe('user');
      expect(s.status).toBe('active');
      expect(s.usageCount).toBe(0);
      expect(s.lastUsedAt).toBeNull();

      const retrieved = storage.getSkill(s.id);
      expect(retrieved).toEqual(s);
    });

    it('should return null for non-existent skill', () => {
      expect(storage.getSkill('nonexistent')).toBeNull();
    });

    it('should update a skill', () => {
      const s = storage.createSkill(TEST_SKILL);
      const updated = storage.updateSkill(s.id, { name: 'updated-review' });
      expect(updated.name).toBe('updated-review');
      expect(updated.instructions).toBe(s.instructions); // unchanged
    });

    it('should throw when updating non-existent skill', () => {
      expect(() => storage.updateSkill('nonexistent', { name: 'X' })).toThrow('Skill not found');
    });

    it('should delete a skill', () => {
      const s = storage.createSkill(TEST_SKILL);
      expect(storage.deleteSkill(s.id)).toBe(true);
      expect(storage.getSkill(s.id)).toBeNull();
    });

    it('should list skills with filters', () => {
      storage.createSkill(TEST_SKILL);
      storage.createSkill({ ...TEST_SKILL, name: 'debug', source: 'ai_proposed', status: 'pending_approval' });

      expect(storage.listSkills()).toHaveLength(2);
      expect(storage.listSkills({ source: 'user' })).toHaveLength(1);
      expect(storage.listSkills({ status: 'pending_approval' })).toHaveLength(1);
    });

    it('should get enabled skills only', () => {
      storage.createSkill(TEST_SKILL);
      storage.createSkill({ ...TEST_SKILL, name: 'disabled', enabled: false });
      storage.createSkill({ ...TEST_SKILL, name: 'pending', status: 'pending_approval' });

      const enabled = storage.getEnabledSkills();
      expect(enabled).toHaveLength(1);
      expect(enabled[0].name).toBe('code-review');
    });

    it('should get pending skills', () => {
      storage.createSkill(TEST_SKILL);
      storage.createSkill({ ...TEST_SKILL, name: 'pending1', status: 'pending_approval' });

      const pending = storage.getPendingSkills();
      expect(pending).toHaveLength(1);
      expect(pending[0].name).toBe('pending1');
    });

    it('should increment usage', () => {
      const s = storage.createSkill(TEST_SKILL);
      storage.incrementUsage(s.id);
      storage.incrementUsage(s.id);

      const updated = storage.getSkill(s.id);
      expect(updated?.usageCount).toBe(2);
      expect(updated?.lastUsedAt).toBeGreaterThan(0);
    });

    it('should count skills', () => {
      expect(storage.getSkillCount()).toBe(0);
      storage.createSkill(TEST_SKILL);
      expect(storage.getSkillCount()).toBe(1);
    });

    it('should store tools as JSON', () => {
      const s = storage.createSkill({
        ...TEST_SKILL,
        tools: [{
          name: 'search',
          description: 'Search tool',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        }],
      });
      expect(s.tools).toHaveLength(1);
      expect(s.tools[0].name).toBe('search');
    });
  });
});

// ── SoulManager Tests ────────────────────────────────────────────

describe('SoulManager', () => {
  let storage: SoulStorage;
  let manager: SoulManager;
  let deps: SoulManagerDeps;

  beforeEach(() => {
    storage = new SoulStorage();
    deps = createDeps();
    manager = new SoulManager(storage, defaultConfig(), deps);
  });

  afterEach(() => {
    storage.close();
  });

  describe('agent name', () => {
    it('should return null when no agent name is set', () => {
      expect(manager.getAgentName()).toBeNull();
    });

    it('should set and get the agent name', () => {
      manager.setAgentName('JARVIS');
      expect(manager.getAgentName()).toBe('JARVIS');
    });

    it('should trim whitespace from agent name', () => {
      manager.setAgentName('  JARVIS  ');
      expect(manager.getAgentName()).toBe('JARVIS');
    });

    it('should throw when setting empty agent name', () => {
      expect(() => manager.setAgentName('')).toThrow('Agent name cannot be empty');
    });

    it('should throw when setting whitespace-only agent name', () => {
      expect(() => manager.setAgentName('   ')).toThrow('Agent name cannot be empty');
    });
  });

  describe('onboarding', () => {
    it('should detect when onboarding is needed (no agent name, no personality)', () => {
      expect(manager.needsOnboarding()).toBe(true);
    });

    it('should still need onboarding with agent name but no personality', () => {
      manager.setAgentName('JARVIS');
      expect(manager.needsOnboarding()).toBe(true);
    });

    it('should still need onboarding with personality but no agent name', () => {
      manager.createPersonality(TEST_PERSONALITY);
      expect(manager.needsOnboarding()).toBe(true);
    });

    it('should not need onboarding after setting agent name and creating personality', () => {
      manager.setAgentName('FRIDAY');
      manager.createDefaultPersonality();
      expect(manager.needsOnboarding()).toBe(false);
    });

    it('should create default personality using the agent name', () => {
      manager.setAgentName('JARVIS');
      const p = manager.createDefaultPersonality();
      expect(p.name).toBe('JARVIS');
      expect(p.systemPrompt).toContain('You are JARVIS');
      expect(p.isActive).toBe(true);
      expect(p.traits).toEqual({ formality: 'balanced', humor: 'subtle', verbosity: 'concise' });
    });

    it('should fall back to FRIDAY when no agent name is set', () => {
      const p = manager.createDefaultPersonality();
      expect(p.name).toBe('FRIDAY');
      expect(p.systemPrompt).toContain('You are FRIDAY');
    });
  });

  describe('personality management', () => {
    it('should create, list, and delete personalities', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      expect(manager.listPersonalities()).toHaveLength(1);
      manager.deletePersonality(p.id);
      expect(manager.listPersonalities()).toHaveLength(0);
    });

    it('should prevent deleting the active personality', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);
      expect(() => manager.deletePersonality(p.id)).toThrow('Cannot delete the active personality');
    });

    it('should update personality', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      const updated = manager.updatePersonality(p.id, { name: 'NewName' });
      expect(updated.name).toBe('NewName');
    });
  });

  describe('skill management', () => {
    it('should create and list skills', () => {
      manager.createSkill(TEST_SKILL);
      expect(manager.listSkills()).toHaveLength(1);
    });

    it('should enforce max skills limit', () => {
      const mgr = new SoulManager(storage, defaultConfig({ maxSkills: 2 }), deps);
      mgr.createSkill(TEST_SKILL);
      mgr.createSkill({ ...TEST_SKILL, name: 'skill2' });
      expect(() => mgr.createSkill({ ...TEST_SKILL, name: 'skill3' })).toThrow('Maximum skill limit');
    });

    it('should enable and disable skills', () => {
      const s = manager.createSkill(TEST_SKILL);
      manager.disableSkill(s.id);
      expect(manager.getSkill(s.id)?.enabled).toBe(false);
      manager.enableSkill(s.id);
      expect(manager.getSkill(s.id)?.enabled).toBe(true);
    });

    it('should delete skills', () => {
      const s = manager.createSkill(TEST_SKILL);
      manager.deleteSkill(s.id);
      expect(manager.listSkills()).toHaveLength(0);
    });
  });

  describe('skill approval workflow', () => {
    it('should approve a pending skill', () => {
      const s = manager.createSkill({ ...TEST_SKILL, status: 'pending_approval', source: 'ai_proposed' });
      const approved = manager.approveSkill(s.id);
      expect(approved.status).toBe('active');
    });

    it('should reject a pending skill (deletes it)', () => {
      const s = manager.createSkill({ ...TEST_SKILL, status: 'pending_approval', source: 'ai_proposed' });
      manager.rejectSkill(s.id);
      expect(manager.getSkill(s.id)).toBeNull();
    });

    it('should throw when approving non-pending skill', () => {
      const s = manager.createSkill(TEST_SKILL); // status: active
      expect(() => manager.approveSkill(s.id)).toThrow('not pending approval');
    });

    it('should throw when rejecting non-pending skill', () => {
      const s = manager.createSkill(TEST_SKILL);
      expect(() => manager.rejectSkill(s.id)).toThrow('not pending approval');
    });

    it('should throw when approving non-existent skill', () => {
      expect(() => manager.approveSkill('nonexistent')).toThrow('Skill not found');
    });
  });

  describe('learning modes', () => {
    it('should propose a skill when ai_proposed mode is enabled', () => {
      const mgr = new SoulManager(storage, defaultConfig({ learningMode: ['user_authored', 'ai_proposed'] }), deps);
      const s = mgr.proposeSkill({ name: 'proposed', description: 'test', instructions: 'do stuff' });
      expect(s.source).toBe('ai_proposed');
      expect(s.status).toBe('pending_approval');
      expect(s.enabled).toBe(false);
    });

    it('should reject proposal when ai_proposed mode is not enabled', () => {
      expect(() => manager.proposeSkill({ name: 'proposed', description: 'test', instructions: 'do stuff' }))
        .toThrow('AI-proposed learning mode is not enabled');
    });

    it('should learn a skill when autonomous mode is enabled', () => {
      const mgr = new SoulManager(storage, defaultConfig({ learningMode: ['autonomous'] }), deps);
      const s = mgr.learnSkill({ name: 'learned', description: 'test', instructions: 'do stuff' });
      expect(s.source).toBe('ai_learned');
      expect(s.status).toBe('active');
      expect(s.enabled).toBe(true);
    });

    it('should reject learning when autonomous mode is not enabled', () => {
      expect(() => manager.learnSkill({ name: 'learned', description: 'test', instructions: 'do stuff' }))
        .toThrow('Autonomous learning mode is not enabled');
    });
  });

  describe('prompt composition', () => {
    it('should return empty string when disabled', () => {
      const mgr = new SoulManager(storage, defaultConfig({ enabled: false }), deps);
      expect(mgr.composeSoulPrompt()).toBe('');
    });

    it('should return archetypes preamble with no personality and no skills and no agent name', () => {
      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('In Our Image');
      expect(prompt).toContain('No-Thing-Ness');
      expect(prompt).not.toContain('Your name is');
    });

    it('should not inject agent name separately from personality', () => {
      manager.setAgentName('JARVIS');
      const p = manager.createPersonality({ ...TEST_PERSONALITY, name: 'TestBot' });
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('Your name is JARVIS.');
      expect(prompt).toContain('You are TestBot');
    });

    it('should not inject agent name when no personality is set', () => {
      manager.setAgentName('JARVIS');
      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('Your name is JARVIS.');
      expect(prompt).not.toContain('## Soul');
    });

    it('should compose personality into prompt', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('You are TestBot');
      expect(prompt).toContain('You are a test bot');
      expect(prompt).toContain('humor: dry');
      expect(prompt).toContain('formality: casual');
    });

    it('should include sex when not unspecified', () => {
      const p = manager.createPersonality({ ...TEST_PERSONALITY, sex: 'female' });
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('Sex: female');
    });

    it('should not include sex when unspecified', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('Sex:');
    });

    it('should include voice when set', () => {
      const p = manager.createPersonality({ ...TEST_PERSONALITY, voice: 'warm and authoritative' });
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('Voice style: warm and authoritative');
    });

    it('should include preferred language when set', () => {
      const p = manager.createPersonality({ ...TEST_PERSONALITY, preferredLanguage: 'Japanese' });
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('Preferred language: Japanese');
    });

    it('should not include preferred language when empty', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('Preferred language');
    });

    it('should compose personality + skills into prompt', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);
      manager.createSkill(TEST_SKILL);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('You are TestBot');
      expect(prompt).toContain('## Skill: code-review');
      expect(prompt).toContain('Review the code');
    });

    it('should exclude disabled skills from prompt', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);
      const s = manager.createSkill(TEST_SKILL);
      manager.disableSkill(s.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('code-review');
    });

    it('should exclude pending skills from prompt', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);
      manager.createSkill({ ...TEST_SKILL, status: 'pending_approval' });

      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('code-review');
    });

    it('should compose prompt for a specific personalityId', () => {
      const p1 = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p1.id);

      const p2 = manager.createPersonality({
        ...TEST_PERSONALITY,
        name: 'AlternateBot',
        systemPrompt: 'You are an alternate bot.',
      });

      const prompt = manager.composeSoulPrompt(undefined, p2.id);
      expect(prompt).toContain('You are AlternateBot');
      expect(prompt).not.toContain('You are TestBot');
    });

    it('should fall back to active personality for invalid personalityId', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt(undefined, 'nonexistent');
      expect(prompt).toContain('You are TestBot');
    });

    it('should include ## Soul header when personality is set', () => {
      const p = manager.createPersonality(TEST_PERSONALITY);
      manager.setPersonality(p.id);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('## Soul');
      expect(prompt).toContain('Your Soul is your identity');
    });

    it('should include ## Body when heartbeat has fired', () => {
      const mockHeartbeat = {
        getStatus: () => ({
          running: true,
          enabled: true,
          intervalMs: 60000,
          beatCount: 1,
          lastBeat: {
            timestamp: 1700000000000,
            durationMs: 15,
            checks: [
              { name: 'system_health', type: 'system_health', status: 'ok' as const, message: 'All good' },
            ],
          },
        }),
        getLastBeat: () => null,
        start: () => {},
        stop: () => {},
        beat: async () => ({ timestamp: 0, durationMs: 0, checks: [] }),
      };
      manager.setHeartbeat(mockHeartbeat as never);

      const prompt = manager.composeSoulPrompt();
      expect(prompt).toContain('## Body');
      expect(prompt).toContain('Your Body is your form');
      expect(prompt).toContain('system_health: [ok] All good');
    });

    it('should omit ## Body when no heartbeat is set', () => {
      const prompt = manager.composeSoulPrompt();
      expect(prompt).not.toContain('## Body');
    });

    it('should truncate when exceeding max prompt tokens', () => {
      const mgr = new SoulManager(storage, defaultConfig({ maxPromptTokens: 200 }), deps); // 800 chars max
      const p = mgr.createPersonality({
        ...TEST_PERSONALITY,
        systemPrompt: 'A'.repeat(2000),
      });
      mgr.setPersonality(p.id);

      const prompt = mgr.composeSoulPrompt();
      expect(prompt.length).toBeLessThanOrEqual(800);
    });
  });

  describe('tool collection', () => {
    it('should return empty array when disabled', () => {
      const mgr = new SoulManager(storage, defaultConfig({ enabled: false }), deps);
      expect(mgr.getActiveTools()).toEqual([]);
    });

    it('should collect tools from enabled skills', () => {
      const tool = {
        name: 'search',
        description: 'Search tool',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      };
      manager.createSkill({ ...TEST_SKILL, tools: [tool] });

      const tools = manager.getActiveTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('search');
    });

    it('should not collect tools from disabled skills', () => {
      const tool = {
        name: 'search',
        description: 'Search tool',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      };
      const s = manager.createSkill({ ...TEST_SKILL, tools: [tool] });
      manager.disableSkill(s.id);

      expect(manager.getActiveTools()).toEqual([]);
    });
  });

  describe('usage tracking', () => {
    it('should increment skill usage', () => {
      const s = manager.createSkill(TEST_SKILL);
      manager.incrementSkillUsage(s.id);
      manager.incrementSkillUsage(s.id);

      const updated = manager.getSkill(s.id);
      expect(updated?.usageCount).toBe(2);
    });
  });
});
