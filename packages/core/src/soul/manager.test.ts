import { describe, it, expect, vi } from 'vitest';

// Partially mock bhava: override only the functions whose output changed format
// so tests exercise TS fallback paths for trait disposition and mood prompts.
vi.mock('../native/bhava.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../native/bhava.js')>();
  return {
    ...actual,
    composeTraitPrompt: () => null,
    createEmotionalStateWithBaseline: () => null,
    composeMoodPrompt: () => null,
    composeSpiritPromptFromData: () => null,
    applySentimentFeedback: () => null,
  };
});

import { SoulManager } from './manager.js';

const makeLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: 'info',
});

const PERSONALITY = {
  id: 'p-1',
  name: 'FRIDAY',
  description: 'Test personality',
  systemPrompt: 'You are FRIDAY.',
  traits: { formality: 'balanced' },
  sex: 'unspecified',
  voice: '',
  preferredLanguage: '',
  isActive: false,
  includeArchetypes: true,
  defaultModel: null,
  modelFallbacks: [],
  body: {
    enabled: false,
    capabilities: [],
    heartEnabled: true,
    creationConfig: {},
    selectedServers: [],
    selectedIntegrations: [],
    mcpFeatures: {
      exposeGit: false,
      exposeFilesystem: false,
      exposeWeb: false,
      exposeWebScraping: false,
      exposeWebSearch: false,
      exposeBrowser: false,
    },
  },
  brainConfig: {
    proactiveConfig: {
      enabled: false,
      builtins: {},
      builtinModes: {},
      learning: { enabled: true, minConfidence: 0.7 },
    },
  },
  createdAt: 1000,
  updatedAt: 1000,
};

const SKILL = {
  id: 'skill-1',
  name: 'Test Skill',
  description: 'A test',
  status: 'active',
  enabled: true,
  source: 'user',
  triggerPatterns: [],
  tools: [],
  personalityId: null,
  createdAt: 1000,
  updatedAt: 1000,
};
const USER = {
  id: 'user-1',
  name: 'Alice',
  isOwner: false,
  preferences: {},
  createdAt: 1000,
  updatedAt: 1000,
};

function makeStorage(overrides: any = {}) {
  return {
    getAgentName: vi.fn().mockResolvedValue('FRIDAY'),
    setAgentName: vi.fn().mockResolvedValue(undefined),
    getSoulConfigOverrides: vi.fn().mockResolvedValue({}),
    setSoulConfigOverrides: vi.fn().mockResolvedValue(undefined),
    getPersonalityCount: vi.fn().mockResolvedValue(1),
    getPersonality: vi.fn().mockResolvedValue(PERSONALITY),
    getActivePersonality: vi.fn().mockResolvedValue(PERSONALITY),
    setActivePersonality: vi.fn().mockResolvedValue(undefined),
    createPersonality: vi.fn().mockResolvedValue(PERSONALITY),
    updatePersonality: vi.fn().mockResolvedValue(PERSONALITY),
    deletePersonality: vi.fn().mockResolvedValue(undefined),
    listPersonalities: vi.fn().mockResolvedValue({ personalities: [PERSONALITY], total: 1 }),
    getSkillCount: vi.fn().mockResolvedValue(0),
    createSkill: vi.fn().mockResolvedValue(SKILL),
    getSkill: vi.fn().mockResolvedValue(SKILL),
    updateSkill: vi.fn().mockResolvedValue({ ...SKILL, enabled: false }),
    deleteSkill: vi.fn().mockResolvedValue(undefined),
    listSkills: vi.fn().mockResolvedValue({ skills: [SKILL], total: 1 }),
    getEnabledSkills: vi.fn().mockResolvedValue([SKILL]),
    approveSkill: vi.fn().mockResolvedValue({ ...SKILL, status: 'active' }),
    incrementUsage: vi.fn().mockResolvedValue(undefined),
    incrementInvoked: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue(USER),
    getUserByName: vi.fn().mockResolvedValue(USER),
    getOwner: vi.fn().mockResolvedValue(null),
    createUser: vi.fn().mockResolvedValue(USER),
    updateUser: vi.fn().mockResolvedValue(USER),
    deleteUser: vi.fn().mockResolvedValue(true),
    listUsers: vi.fn().mockResolvedValue({ users: [USER], total: 1 }),
    close: vi.fn(),
    ...overrides,
  };
}

function makeConfig(overrides: any = {}) {
  return {
    enabled: true,
    maxSkills: 100,
    maxPromptTokens: 2000,
    learningMode: ['ai_proposed', 'autonomous'],
    ...overrides,
  };
}

function makeManager(
  storageOverrides: any = {},
  configOverrides: any = {},
  brain?: any,
  spirit?: any
) {
  const storage = makeStorage(storageOverrides);
  const logger = makeLogger();
  const config = makeConfig(configOverrides);
  const deps = { logger: logger as any };
  const manager = new SoulManager(storage as any, config as any, deps, brain, spirit);
  return { manager, storage, logger, config };
}

describe('SoulManager', () => {
  describe('getAgentName / setAgentName', () => {
    it('returns agent name from storage', async () => {
      const { manager } = makeManager();
      expect(await manager.getAgentName()).toBe('FRIDAY');
    });

    it('sets agent name in storage', async () => {
      const { manager, storage } = makeManager();
      await manager.setAgentName('Jarvis');
      expect(storage.setAgentName).toHaveBeenCalledWith('Jarvis');
    });

    it('throws when name is empty', async () => {
      const { manager } = makeManager();
      await expect(manager.setAgentName('')).rejects.toThrow('Agent name cannot be empty');
    });

    it('trims whitespace from name', async () => {
      const { manager, storage } = makeManager();
      await manager.setAgentName('  Jarvis  ');
      expect(storage.setAgentName).toHaveBeenCalledWith('Jarvis');
    });
  });

  describe('needsOnboarding', () => {
    it('returns false when agent name set and personalities exist', async () => {
      const { manager } = makeManager();
      expect(await manager.needsOnboarding()).toBe(false);
    });

    it('returns true when agent name is null', async () => {
      const { manager } = makeManager({ getAgentName: vi.fn().mockResolvedValue(null) });
      expect(await manager.needsOnboarding()).toBe(true);
    });

    it('returns true when no personalities', async () => {
      const { manager } = makeManager({ getPersonalityCount: vi.fn().mockResolvedValue(0) });
      expect(await manager.needsOnboarding()).toBe(true);
    });
  });

  describe('createDefaultPersonality', () => {
    it('creates a personality and sets it active', async () => {
      const { manager, storage } = makeManager();
      await manager.createDefaultPersonality();
      expect(storage.createPersonality).toHaveBeenCalled();
      expect(storage.setActivePersonality).toHaveBeenCalledWith('p-1');
    });

    it('uses FRIDAY as default name when agent name is null', async () => {
      const { manager, storage } = makeManager({ getAgentName: vi.fn().mockResolvedValue(null) });
      await manager.createDefaultPersonality();
      const call = storage.createPersonality.mock.calls[0][0];
      expect(call.name).toBe('FRIDAY');
    });
  });

  describe('seedAvailablePresets', () => {
    it('creates one personality per preset and activates the first', async () => {
      const { manager, storage } = makeManager();
      const results = await manager.seedAvailablePresets();
      // PERSONALITY_PRESETS has 2 entries (FRIDAY + T.Ron)
      expect(storage.createPersonality).toHaveBeenCalledTimes(2);
      expect(storage.setActivePersonality).toHaveBeenCalledWith('p-1');
      expect(results).toHaveLength(2);
    });

    it('names the first preset after the configured agent name', async () => {
      const { manager, storage } = makeManager({
        getAgentName: vi.fn().mockResolvedValue('Jarvis'),
      });
      await manager.seedAvailablePresets();
      const firstCall = storage.createPersonality.mock.calls[0][0];
      expect(firstCall.name).toBe('Jarvis');
      expect(firstCall.systemPrompt).toContain('Jarvis');
    });

    it('uses FRIDAY as default name when agent name is null', async () => {
      const { manager, storage } = makeManager({ getAgentName: vi.fn().mockResolvedValue(null) });
      await manager.seedAvailablePresets();
      const firstCall = storage.createPersonality.mock.calls[0][0];
      expect(firstCall.name).toBe('FRIDAY');
    });

    it('enables archetypes for FRIDAY agent name only', async () => {
      const { manager: fridayManager, storage: fridayStorage } = makeManager();
      await fridayManager.seedAvailablePresets();
      const fridayCall = fridayStorage.createPersonality.mock.calls[0][0];
      expect(fridayCall.includeArchetypes).toBe(true);

      const { manager: customManager, storage: customStorage } = makeManager({
        getAgentName: vi.fn().mockResolvedValue('Max'),
      });
      await customManager.seedAvailablePresets();
      const customCall = customStorage.createPersonality.mock.calls[0][0];
      expect(customCall.includeArchetypes).toBe(false);
    });
  });

  describe('personality CRUD', () => {
    it('getPersonality delegates to storage', async () => {
      const { manager } = makeManager();
      const p = await manager.getPersonality('p-1');
      expect(p?.id).toBe('p-1');
    });

    it('getActivePersonality delegates to storage', async () => {
      const { manager } = makeManager();
      const p = await manager.getActivePersonality();
      expect(p?.id).toBe('p-1');
    });

    it('setPersonality calls setActivePersonality', async () => {
      const { manager, storage } = makeManager();
      await manager.setPersonality('p-1');
      expect(storage.setActivePersonality).toHaveBeenCalledWith('p-1');
    });

    it('createPersonality delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.createPersonality({ name: 'New' } as any);
      expect(storage.createPersonality).toHaveBeenCalled();
    });

    it('updatePersonality delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.updatePersonality('p-1', { name: 'Updated' });
      expect(storage.updatePersonality).toHaveBeenCalledWith('p-1', { name: 'Updated' });
    });

    it('deletePersonality deletes non-active personality', async () => {
      const { manager, storage } = makeManager({
        getPersonality: vi.fn().mockResolvedValue({ ...PERSONALITY, isActive: false }),
      });
      await manager.deletePersonality('p-1');
      expect(storage.deletePersonality).toHaveBeenCalledWith('p-1');
    });

    it('deletePersonality throws when personality is active', async () => {
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue({ ...PERSONALITY, isActive: true }),
      });
      await expect(manager.deletePersonality('p-1')).rejects.toThrow(
        'Cannot delete the active personality'
      );
    });

    it('deletePersonality throws when deletionMode is manual', async () => {
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue({
          ...PERSONALITY,
          isActive: false,
          body: { ...PERSONALITY.body, resourcePolicy: { deletionMode: 'manual' } },
        }),
      });
      await expect(manager.deletePersonality('p-1')).rejects.toThrow(
        'Deletion is blocked (mode: manual)'
      );
    });

    it('deletePersonality succeeds when deletionMode is request (backend allows, frontend confirms)', async () => {
      const mockDelete = vi.fn().mockResolvedValue(true);
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue({
          ...PERSONALITY,
          isActive: false,
          body: { ...PERSONALITY.body, resourcePolicy: { deletionMode: 'request' } },
        }),
        deletePersonality: mockDelete,
      });
      await manager.deletePersonality('p-1');
      expect(mockDelete).toHaveBeenCalledWith('p-1');
    });

    it('deletePersonality succeeds when deletionMode is auto', async () => {
      const mockDelete = vi.fn().mockResolvedValue(true);
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue({
          ...PERSONALITY,
          isActive: false,
          body: { ...PERSONALITY.body, resourcePolicy: { deletionMode: 'auto' } },
        }),
        deletePersonality: mockDelete,
      });
      await manager.deletePersonality('p-1');
      expect(mockDelete).toHaveBeenCalledWith('p-1');
    });

    it('listPersonalities delegates to storage', async () => {
      const { manager } = makeManager();
      const result = await manager.listPersonalities();
      expect(result.personalities).toHaveLength(1);
    });

    it('enablePersonality delegates to storage', async () => {
      const enablePersonality = vi.fn().mockResolvedValue(undefined);
      const { manager } = makeManager({ enablePersonality });
      await manager.enablePersonality('p-1');
      expect(enablePersonality).toHaveBeenCalledWith('p-1');
    });

    it('disablePersonality delegates to storage', async () => {
      const disablePersonality = vi.fn().mockResolvedValue(undefined);
      const { manager } = makeManager({ disablePersonality });
      await manager.disablePersonality('p-1');
      expect(disablePersonality).toHaveBeenCalledWith('p-1');
    });

    it('setDefaultPersonality delegates to storage', async () => {
      const setDefaultPersonality = vi.fn().mockResolvedValue(undefined);
      const { manager } = makeManager({ setDefaultPersonality });
      await manager.setDefaultPersonality('p-1');
      expect(setDefaultPersonality).toHaveBeenCalledWith('p-1');
    });

    it('clearDefaultPersonality delegates to storage', async () => {
      const clearDefaultPersonality = vi.fn().mockResolvedValue(undefined);
      const { manager } = makeManager({ clearDefaultPersonality });
      await manager.clearDefaultPersonality();
      expect(clearDefaultPersonality).toHaveBeenCalled();
    });

    it('getEnabledPersonalities delegates to storage', async () => {
      const getEnabledPersonalities = vi.fn().mockResolvedValue([PERSONALITY]);
      const { manager } = makeManager({ getEnabledPersonalities });
      const result = await manager.getEnabledPersonalities();
      expect(result).toHaveLength(1);
    });

    it('setDynamicToolManager sets the internal manager', () => {
      const { manager } = makeManager();
      const dtm = {} as any;
      expect(() => manager.setDynamicToolManager(dtm)).not.toThrow();
    });

    it('setIntentManager sets the internal manager', () => {
      const { manager } = makeManager();
      const im = {} as any;
      expect(() => manager.setIntentManager(im)).not.toThrow();
    });
  });

  describe('skill operations (without brain)', () => {
    it('createSkill throws when max limit reached', async () => {
      const { manager } = makeManager(
        { getSkillCount: vi.fn().mockResolvedValue(100) },
        { maxSkills: 100 }
      );
      await expect(manager.createSkill({ name: 'New' } as any)).rejects.toThrow(
        'Maximum skill limit reached'
      );
    });

    it('createSkill creates skill when under limit', async () => {
      const { manager, storage } = makeManager();
      await manager.createSkill({ name: 'New' } as any);
      expect(storage.createSkill).toHaveBeenCalled();
    });

    it('updateSkill delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.updateSkill('skill-1', { enabled: false });
      expect(storage.updateSkill).toHaveBeenCalledWith('skill-1', { enabled: false });
    });

    it('deleteSkill delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.deleteSkill('skill-1');
      expect(storage.deleteSkill).toHaveBeenCalledWith('skill-1');
    });

    it('enableSkill updates enabled=true', async () => {
      const { manager, storage } = makeManager();
      await manager.enableSkill('skill-1');
      expect(storage.updateSkill).toHaveBeenCalledWith('skill-1', { enabled: true });
    });

    it('disableSkill updates enabled=false', async () => {
      const { manager, storage } = makeManager();
      await manager.disableSkill('skill-1');
      expect(storage.updateSkill).toHaveBeenCalledWith('skill-1', { enabled: false });
    });

    it('getSkill delegates to storage', async () => {
      const { manager } = makeManager();
      const skill = await manager.getSkill('skill-1');
      expect(skill?.id).toBe('skill-1');
    });

    it('approveSkill throws when skill not found', async () => {
      const { manager } = makeManager({ getSkill: vi.fn().mockResolvedValue(null) });
      await expect(manager.approveSkill('missing')).rejects.toThrow('Skill not found');
    });

    it('approveSkill throws when not pending', async () => {
      const { manager } = makeManager({
        getSkill: vi.fn().mockResolvedValue({ ...SKILL, status: 'active' }),
      });
      await expect(manager.approveSkill('skill-1')).rejects.toThrow('not pending approval');
    });

    it('approveSkill sets status to active', async () => {
      const { manager, storage } = makeManager({
        getSkill: vi.fn().mockResolvedValue({ ...SKILL, status: 'pending_approval' }),
      });
      await manager.approveSkill('skill-1');
      expect(storage.updateSkill).toHaveBeenCalledWith('skill-1', { status: 'active' });
    });

    it('rejectSkill throws when skill not found', async () => {
      const { manager } = makeManager({ getSkill: vi.fn().mockResolvedValue(null) });
      await expect(manager.rejectSkill('missing')).rejects.toThrow('Skill not found');
    });

    it('rejectSkill deletes pending skill', async () => {
      const { manager, storage } = makeManager({
        getSkill: vi.fn().mockResolvedValue({ ...SKILL, status: 'pending_approval' }),
      });
      await manager.rejectSkill('skill-1');
      expect(storage.deleteSkill).toHaveBeenCalledWith('skill-1');
    });

    it('listSkills includes personality name when personalityId set', async () => {
      const skillWithPersonality = { ...SKILL, personalityId: 'p-1' };
      const { manager } = makeManager({
        listSkills: vi.fn().mockResolvedValue({ skills: [skillWithPersonality], total: 1 }),
      });
      const result = await manager.listSkills();
      expect(result.skills[0].personalityName).toBe('FRIDAY');
    });

    it('listSkills returns skills without personality enrichment when none have personalityId', async () => {
      const { manager } = makeManager();
      const result = await manager.listSkills();
      expect(result.skills).toHaveLength(1);
    });
  });

  describe('skill operations (with brain)', () => {
    const makeBrain = (overrides: any = {}) => ({
      createSkill: vi.fn().mockResolvedValue(SKILL),
      updateSkill: vi.fn().mockResolvedValue(SKILL),
      deleteSkill: vi.fn().mockResolvedValue(undefined),
      enableSkill: vi.fn().mockResolvedValue(undefined),
      disableSkill: vi.fn().mockResolvedValue(undefined),
      getSkill: vi.fn().mockResolvedValue(SKILL),
      listSkills: vi.fn().mockResolvedValue([SKILL]),
      approveSkill: vi.fn().mockResolvedValue(SKILL),
      rejectSkill: vi.fn().mockResolvedValue(undefined),
      incrementSkillUsage: vi.fn().mockResolvedValue(undefined),
      getActiveSkills: vi.fn().mockResolvedValue([SKILL]),
      getActiveTools: vi.fn().mockResolvedValue([]),
      ...overrides,
    });

    it('createSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.createSkill({ name: 'New' } as any);
      expect(brain.createSkill).toHaveBeenCalled();
    });

    it('deleteSkill calls brain.deleteSkill and marketplace.onBrainSkillDeleted when both present', async () => {
      const brain = makeBrain();
      const marketplace = { onBrainSkillDeleted: vi.fn().mockResolvedValue(undefined) };
      const { manager } = makeManager({}, {}, brain);
      manager.setMarketplaceManager(marketplace as any);
      await manager.deleteSkill('skill-1');
      expect(brain.deleteSkill).toHaveBeenCalled();
      expect(marketplace.onBrainSkillDeleted).toHaveBeenCalledWith(SKILL.name, SKILL.source);
    });

    it('enableSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.enableSkill('skill-1');
      expect(brain.enableSkill).toHaveBeenCalledWith('skill-1');
    });

    it('updateSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.updateSkill('skill-1', { enabled: false });
      expect(brain.updateSkill).toHaveBeenCalledWith('skill-1', { enabled: false });
    });

    it('disableSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.disableSkill('skill-1');
      expect(brain.disableSkill).toHaveBeenCalledWith('skill-1');
    });

    it('getSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      const skill = await manager.getSkill('skill-1');
      expect(brain.getSkill).toHaveBeenCalledWith('skill-1');
      expect(skill?.id).toBe('skill-1');
    });

    it('approveSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.approveSkill('skill-1');
      expect(brain.approveSkill).toHaveBeenCalledWith('skill-1');
    });

    it('rejectSkill delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.rejectSkill('skill-1');
      expect(brain.rejectSkill).toHaveBeenCalledWith('skill-1');
    });

    it('incrementSkillUsage delegates to brain', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      await manager.incrementSkillUsage('skill-1');
      expect(brain.incrementSkillUsage).toHaveBeenCalledWith('skill-1');
    });

    it('listSkills uses brain results', async () => {
      const brain = makeBrain();
      const { manager } = makeManager({}, {}, brain);
      const result = await manager.listSkills();
      expect(brain.listSkills).toHaveBeenCalled();
      expect(result.skills).toHaveLength(1);
    });
  });

  describe('user operations', () => {
    it('getUser delegates to storage', async () => {
      const { manager } = makeManager();
      const user = await manager.getUser('user-1');
      expect(user?.id).toBe('user-1');
    });

    it('getUserByName delegates to storage', async () => {
      const { manager } = makeManager();
      const user = await manager.getUserByName('Alice');
      expect(user?.name).toBe('Alice');
    });

    it('getOwner returns null when no owner', async () => {
      const { manager } = makeManager();
      expect(await manager.getOwner()).toBeNull();
    });

    it('createUser delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.createUser({ name: 'Bob', isOwner: false } as any);
      expect(storage.createUser).toHaveBeenCalled();
    });

    it('updateUser delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.updateUser('user-1', { name: 'Updated' });
      expect(storage.updateUser).toHaveBeenCalledWith('user-1', { name: 'Updated' });
    });

    it('deleteUser returns boolean', async () => {
      const { manager } = makeManager();
      expect(await manager.deleteUser('user-1')).toBe(true);
    });

    it('listUsers delegates to storage', async () => {
      const { manager } = makeManager();
      const result = await manager.listUsers();
      expect(result.users).toHaveLength(1);
    });
  });

  describe('learning', () => {
    it('proposeSkill throws when ai_proposed not in learningMode', async () => {
      const { manager } = makeManager({}, { learningMode: [] });
      await expect(manager.proposeSkill({ name: 'New' } as any)).rejects.toThrow(
        'AI-proposed learning mode is not enabled'
      );
    });

    it('proposeSkill creates skill with pending_approval', async () => {
      const { manager, storage } = makeManager();
      await manager.proposeSkill({ name: 'New', triggerPatterns: [] } as any);
      const call = storage.createSkill.mock.calls[0][0];
      expect(call.source).toBe('ai_proposed');
      expect(call.status).toBe('pending_approval');
    });

    it('learnSkill throws when autonomous not in learningMode', async () => {
      const { manager } = makeManager({}, { learningMode: [] });
      await expect(manager.learnSkill({ name: 'New' } as any)).rejects.toThrow(
        'Autonomous learning mode is not enabled'
      );
    });

    it('learnSkill creates active skill', async () => {
      const { manager, storage } = makeManager();
      await manager.learnSkill({ name: 'New', triggerPatterns: [] } as any);
      const call = storage.createSkill.mock.calls[0][0];
      expect(call.source).toBe('ai_learned');
      expect(call.status).toBe('active');
      expect(call.enabled).toBe(true);
    });

    it('incrementSkillUsage delegates to storage', async () => {
      const { manager, storage } = makeManager();
      await manager.incrementSkillUsage('skill-1');
      expect(storage.incrementUsage).toHaveBeenCalledWith('skill-1');
    });
  });

  describe('composeSoulPrompt', () => {
    it('returns empty string when disabled', async () => {
      const { manager } = makeManager({}, { enabled: false });
      expect(await manager.composeSoulPrompt()).toBe('');
    });

    it('includes personality name in prompt', async () => {
      const { manager } = makeManager();
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('FRIDAY');
    });

    it('includes archetypes when includeArchetypes=true', async () => {
      const { manager } = makeManager();
      const prompt = await manager.composeSoulPrompt();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('excludes archetypes when includeArchetypes=false', async () => {
      const noArchetypePersonality = { ...PERSONALITY, includeArchetypes: false };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(noArchetypePersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      // Should still contain soul section but not archetypes
      expect(prompt).toContain('FRIDAY');
    });

    it('includes user context when owner exists', async () => {
      const owner = {
        ...USER,
        isOwner: true,
        name: 'Alice',
        nickname: 'Ali',
        notes: 'VIP',
        preferences: { theme: 'dark' },
      };
      const { manager } = makeManager({ getOwner: vi.fn().mockResolvedValue(owner) });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Alice');
      expect(prompt).toContain('Ali');
      expect(prompt).toContain('VIP');
    });

    it('injects brain context when brain available and input provided', async () => {
      const brain = {
        getRelevantContext: vi.fn().mockResolvedValue('## Brain\nsome memory'),
        getActiveSkills: vi.fn().mockResolvedValue([]),
      };
      const { manager } = makeManager({}, {}, brain);
      const prompt = await manager.composeSoulPrompt('hello world');
      expect(prompt).toContain('some memory');
    });

    it('expands skills that match trigger patterns', async () => {
      const triggerSkill = {
        ...SKILL,
        name: 'Code Review',
        triggerPatterns: ['code'],
        instructions: 'Review the code carefully.',
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([triggerSkill]),
      });
      const prompt = await manager.composeSoulPrompt('please code review this');
      expect(prompt).toContain('Review the code carefully');
    });

    it('does not expand skills that do not match trigger patterns', async () => {
      const triggerSkill = {
        ...SKILL,
        name: 'Code Review',
        triggerPatterns: ['code'],
        instructions: 'Review the code carefully.',
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([triggerSkill]),
      });
      const prompt = await manager.composeSoulPrompt('tell me a joke');
      expect(prompt).not.toContain('Review the code carefully');
    });

    it('includes MCP tool restriction when mcpToolsAllowed is non-empty', async () => {
      const restrictedSkill = {
        ...SKILL,
        name: 'Restricted Skill',
        instructions: 'Use only allowed tools.',
        mcpToolsAllowed: ['web_search', 'web_scrape'],
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([restrictedSkill]),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('MCP tool restriction');
      expect(prompt).toContain('web_search, web_scrape');
    });

    it('does not include MCP tool restriction when mcpToolsAllowed is null', async () => {
      const nullToolSkill = {
        ...SKILL,
        name: 'Unrestricted Skill',
        instructions: 'Do anything.',
        mcpToolsAllowed: null as any,
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([nullToolSkill]),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).not.toContain('MCP tool restriction');
    });

    it('includes spirit prompt when spirit available', async () => {
      const spirit = {
        getActivePassions: vi.fn().mockResolvedValue([]),
        getActiveInspirations: vi.fn().mockResolvedValue([]),
        getActivePains: vi.fn().mockResolvedValue([]),
        composeSpiritPrompt: vi.fn().mockResolvedValue('## Spirit\nPassion: music'),
      };
      const { manager } = makeManager({}, {}, undefined, spirit);
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('music');
    });

    it('includes diagnostics section when diagnostics capability enabled', async () => {
      const diagPersonality = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, enabled: true, capabilities: ['diagnostics'] },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(diagPersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Diagnostics');
      expect(prompt).toContain('diag_ping_integrations');
    });

    it('includes diagnostics section with allowSubAgents path', async () => {
      const diagPersonality = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, enabled: true, capabilities: ['diagnostics'] },
      };
      const storage = makeStorage({
        getActivePersonality: vi.fn().mockResolvedValue(diagPersonality),
      });
      const logger = makeLogger();
      const manager = new SoulManager(storage as any, makeConfig() as any, {
        logger: logger as any,
        securityConfig: { allowSubAgents: true } as any,
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Diagnostics');
      expect(prompt).toContain('diag_report_status');
    });

    it('includes vision section with desktop control and camera enabled', async () => {
      const visionPersonality = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, enabled: true, capabilities: ['vision', 'limb_movement'] },
      };
      const storage = makeStorage({
        getActivePersonality: vi.fn().mockResolvedValue(visionPersonality),
      });
      const logger = makeLogger();
      const manager = new SoulManager(storage as any, makeConfig() as any, {
        logger: logger as any,
        securityConfig: { allowDesktopControl: true, allowCamera: true } as any,
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Vision');
      expect(prompt).toContain('desktop_screenshot');
      expect(prompt).toContain('desktop_camera_capture');
    });

    it('includes vision and limb_movement disabled when desktop control not enabled', async () => {
      const visionPersonality = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, enabled: true, capabilities: ['vision', 'limb_movement'] },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(visionPersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Vision');
      expect(prompt).toContain('disabled');
    });

    it('includes injectDateTime section when personality has injectDateTime enabled', async () => {
      const datePersonality = {
        ...PERSONALITY,
        injectDateTime: true,
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(datePersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Current Date');
    });

    it('appends viewport hint when clientContext has viewportHint', async () => {
      const { manager } = makeManager();
      const prompt = await manager.composeSoulPrompt(undefined, undefined, {
        viewportHint: 'mobile',
      });
      expect(prompt).toContain('[Interface: mobile');
    });

    it('includes skill with routing=explicit in catalog', async () => {
      const routedSkill = {
        ...SKILL,
        name: 'Routed Skill',
        routing: 'explicit',
        instructions: 'Use this skill explicitly.',
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([routedSkill]),
      });
      const prompt = await manager.composeSoulPrompt('please routed skill');
      expect(prompt).toContain('Routed Skill');
    });

    it('includes MCP connections with exposeWeb disabled path', async () => {
      const bodyPersonality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          selectedServers: ['YEOMAN MCP'],
          mcpFeatures: {
            exposeGit: false,
            exposeFilesystem: false,
            exposeWeb: false,
            exposeWebScraping: false,
            exposeWebSearch: false,
            exposeBrowser: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(bodyPersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('MCP Connections');
    });

    it('composeSoulPrompt with personalityId fetches specific personality', async () => {
      const { manager } = makeManager();
      const prompt = await manager.composeSoulPrompt(undefined, 'p-1');
      expect(prompt).toContain('FRIDAY');
    });

    it('composeSoulPrompt injects intent context when intentManager returns content', async () => {
      const { manager } = makeManager();
      const mockIntentManager = {
        composeSoulContext: vi.fn().mockResolvedValue('## Intent\nGoal: be helpful'),
        getGoalSkillSlugs: vi.fn().mockReturnValue(new Set()),
      };
      manager.setIntentManager(mockIntentManager as any);
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('be helpful');
    });

    it('composeSoulPrompt elevates goal-linked skills via intentManager', async () => {
      const goalSkill = {
        ...SKILL,
        name: 'Goal Skill',
        instructions: 'Follow this goal.',
        triggerPatterns: [],
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([goalSkill]),
      });
      const mockIntentManager = {
        composeSoulContext: vi.fn().mockResolvedValue(null),
        getGoalSkillSlugs: vi.fn().mockReturnValue(new Set(['Goal Skill'])),
      };
      manager.setIntentManager(mockIntentManager as any);
      // input doesn't match the skill name but intentManager forces it in
      const prompt = await manager.composeSoulPrompt('xyz xyz xyz');
      expect(prompt).toContain('Follow this goal');
    });
  });

  describe('getActiveTools', () => {
    it('returns empty when disabled', async () => {
      const { manager } = makeManager({}, { enabled: false });
      expect(await manager.getActiveTools()).toEqual([]);
    });

    it('extracts tools from enabled skills', async () => {
      const toolSkill = {
        ...SKILL,
        tools: [{ name: 'search', description: 'search', parameters: {} }],
      };
      const { manager } = makeManager({ getEnabledSkills: vi.fn().mockResolvedValue([toolSkill]) });
      const tools = await manager.getActiveTools();
      expect(tools).toHaveLength(1);
    });

    it('delegates to brain when brain available', async () => {
      const brain = { getActiveTools: vi.fn().mockResolvedValue([{ name: 'search' }]) };
      const { manager } = makeManager({}, {}, brain);
      const tools = await manager.getActiveTools();
      expect(brain.getActiveTools).toHaveBeenCalled();
      expect(tools).toHaveLength(1);
    });

    // ── Creation tool injection ───────────────────────────────────────

    it('does not inject creation tools when body.enabled is false', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: false,
          creationConfig: {
            skills: true,
            tasks: true,
            personalities: true,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      expect(tools.map((t) => t.name)).not.toContain('create_skill');
      expect(tools.map((t) => t.name)).not.toContain('create_task');
      expect(tools.map((t) => t.name)).not.toContain('create_personality');
    });

    it('injects skill creation tools when body.enabled and creationConfig.skills are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: true,
            tasks: false,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_skill');
      expect(names).toContain('update_skill');
      expect(names).toContain('delete_skill');
      expect(names).not.toContain('create_task');
      expect(names).not.toContain('create_personality');
    });

    it('injects task tools when body.enabled and creationConfig.tasks are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: true,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_task');
      expect(names).toContain('update_task');
      expect(names).not.toContain('create_skill');
    });

    it('injects delegation tools when body.enabled and creationConfig.subAgents are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: false,
            personalities: false,
            subAgents: true,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('delegate_task');
      expect(names).toContain('list_sub_agents');
      expect(names).toContain('get_delegation_result');
    });

    it('injects experiment tools when body.enabled and creationConfig.experiments are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: false,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: true,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_experiment');
      expect(names).toContain('delete_experiment');
    });

    it('injects personality tools when body.enabled and creationConfig.personalities are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: false,
            personalities: true,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_personality');
      expect(names).toContain('update_personality');
      expect(names).toContain('delete_personality');
      expect(names).not.toContain('create_skill');
    });

    it('injects custom role tools when body.enabled and creationConfig.customRoles are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: false,
            personalities: false,
            subAgents: false,
            customRoles: true,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_custom_role');
      expect(names).toContain('delete_custom_role');
      expect(names).not.toContain('create_skill');
    });

    it('injects role assignment tools when body.enabled and creationConfig.roleAssignments are true', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: false,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: true,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('assign_role');
      expect(names).toContain('revoke_role');
      expect(names).not.toContain('create_skill');
    });

    it('combines skill-based tools and creation tools', async () => {
      const toolSkill = {
        ...SKILL,
        tools: [{ name: 'web_search', description: 'search', parameters: {} }],
        source: 'user',
      };
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: false,
            tasks: true,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
        getPersonality: vi.fn().mockResolvedValue(personality),
        getEnabledSkills: vi.fn().mockResolvedValue([toolSkill]),
      });
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('web_search');
      expect(names).toContain('create_task');
    });

    it('injects creation tools alongside brain skill tools', async () => {
      const brain = { getActiveTools: vi.fn().mockResolvedValue([{ name: 'brain_tool' }]) };
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: true,
            tasks: false,
            personalities: false,
            subAgents: false,
            customRoles: false,
            roleAssignments: false,
            experiments: false,
            allowA2A: false,
            allowSwarms: false,
            allowDynamicTools: false,
          },
        },
      };
      const { manager } = makeManager(
        {
          getActivePersonality: vi.fn().mockResolvedValue(personality),
          getPersonality: vi.fn().mockResolvedValue(personality),
        },
        {},
        brain
      );
      const tools = await manager.getActiveTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain('brain_tool');
      expect(names).toContain('create_skill');
    });
  });

  describe('getConfig / getBrain / getSpirit / close', () => {
    it('getConfig returns config', () => {
      const { manager, config } = makeManager();
      expect(manager.getConfig()).toEqual(config);
    });

    it('getBrain returns null when no brain', () => {
      const { manager } = makeManager();
      expect(manager.getBrain()).toBeNull();
    });

    it('getBrain returns brain when provided', () => {
      const brain = { getActiveTools: vi.fn() };
      const { manager } = makeManager({}, {}, brain);
      expect(manager.getBrain()).toBe(brain);
    });

    it('getSpirit returns null when no spirit', () => {
      const { manager } = makeManager();
      expect(manager.getSpirit()).toBeNull();
    });

    it('close calls storage.close', () => {
      const { manager, storage } = makeManager();
      manager.close();
      expect(storage.close).toHaveBeenCalled();
    });
  });

  describe('isSkillInContext (tested via composeSoulPrompt)', () => {
    it('uses keyword fallback when triggerPatterns is empty', async () => {
      // Skill with no triggerPatterns, name "Search Helper" → keyword "search" (>3 chars)
      const keywordSkill = {
        ...SKILL,
        name: 'Search Helper',
        triggerPatterns: [],
        instructions: 'I help you search.',
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([keywordSkill]),
      });
      const prompt = await manager.composeSoulPrompt('please search for dogs');
      expect(prompt).toContain('I help you search');
    });

    it('uses catch block when triggerPattern is an invalid regex', async () => {
      // Invalid regex — falls back to includes()
      const invalidRegexSkill = {
        ...SKILL,
        name: 'Broken',
        triggerPatterns: ['[invalid'],
        instructions: 'Broken regex skill.',
      };
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue([invalidRegexSkill]),
      });
      // The literal string "[invalid" IS included in the message
      const prompt = await manager.composeSoulPrompt('[invalid pattern test');
      expect(prompt).toContain('Broken regex skill');
    });
  });

  describe('triggerPatternCache eviction (Phase 103)', () => {
    it('compiles and caches trigger patterns without growing unbounded', async () => {
      // Use many unique trigger patterns to exercise caching
      const skills = Array.from({ length: 50 }, (_, i) => ({
        ...SKILL,
        name: `Skill ${i}`,
        triggerPatterns: [`unique_pattern_${i}`],
        instructions: `Skill ${i} instructions`,
      }));
      const { manager } = makeManager({
        getEnabledSkills: vi.fn().mockResolvedValue(skills),
      });

      // First call populates cache
      await manager.composeSoulPrompt('unique_pattern_0 match');
      // Second call uses cache
      await manager.composeSoulPrompt('unique_pattern_0 match again');

      // Just verify no errors and consistent behavior
      const prompt = await manager.composeSoulPrompt('unique_pattern_0');
      expect(prompt).toContain('Skill 0 instructions');
    });
  });

  describe('composeBodyPrompt (tested via composeSoulPrompt)', () => {
    it('includes MCP connections section when personality has selectedServers', async () => {
      const bodyPersonality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          selectedServers: ['YEOMAN MCP'],
          mcpFeatures: {
            exposeGit: true,
            exposeFilesystem: false,
            exposeWeb: true,
            exposeWebScraping: true,
            exposeWebSearch: false,
            exposeBrowser: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(bodyPersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('MCP Connections');
      expect(prompt).toContain('YEOMAN MCP');
    });

    it('includes creation tools section when personality has enabled creationConfig toggles', async () => {
      const bodyPersonality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: { skills: true, tasks: false },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(bodyPersonality),
      });
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Creation Tools');
      expect(prompt).toContain('create_skill');
      expect(prompt).not.toContain('create_task');
    });

    it('includes Heart section via heartManager', async () => {
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue({
          ...PERSONALITY,
          body: { ...PERSONALITY.body, enabled: true },
        }),
      });
      const mockHeart = {
        composeHeartPrompt: vi.fn().mockReturnValue('### Heart\nBeating steadily.'),
      };
      manager.setHeart(mockHeart as any);
      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Heart');
    });
  });

  describe('personality presets', () => {
    it('listPersonalityPresets returns all built-in presets', () => {
      const { manager } = makeManager();
      const presets = manager.listPersonalityPresets();
      expect(presets.length).toBeGreaterThanOrEqual(2);
      expect(presets.map((p) => p.id)).toContain('friday');
      expect(presets.map((p) => p.id)).toContain('t-ron');
    });

    it('createPersonalityFromPreset creates personality from friday preset', async () => {
      const { manager, storage } = makeManager();
      await manager.createPersonalityFromPreset('friday');
      expect(storage.createPersonality).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'FRIDAY' })
      );
    });

    it('createPersonalityFromPreset creates personality from t-ron preset', async () => {
      const { manager, storage } = makeManager();
      await manager.createPersonalityFromPreset('t-ron');
      expect(storage.createPersonality).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'T.Ron' })
      );
    });

    it('createPersonalityFromPreset applies overrides over preset data', async () => {
      const { manager, storage } = makeManager();
      await manager.createPersonalityFromPreset('t-ron', { name: 'My Guard' });
      expect(storage.createPersonality).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My Guard' })
      );
    });

    it('createPersonalityFromPreset throws for unknown preset id', async () => {
      const { manager } = makeManager();
      await expect(manager.createPersonalityFromPreset('nope')).rejects.toThrow(
        'Unknown personality preset: nope'
      );
    });
  });

  describe('loadConfigOverrides / updateConfig', () => {
    it('getConfig returns the base config initially', () => {
      const { manager, config } = makeManager();
      expect(manager.getConfig()).toEqual(config);
    });

    it('loadConfigOverrides merges DB overrides over baseConfig', async () => {
      const { manager, storage } = makeManager();
      (storage.getSoulConfigOverrides as ReturnType<typeof vi.fn>).mockResolvedValue({
        maxSkills: 150,
      });
      await manager.loadConfigOverrides();
      expect(manager.getConfig().maxSkills).toBe(150);
    });

    it('loadConfigOverrides is a no-op when overrides are empty', async () => {
      const { manager, config } = makeManager();
      await manager.loadConfigOverrides();
      expect(manager.getConfig()).toEqual(config);
    });

    it('updateConfig merges patch and persists', async () => {
      const { manager, storage } = makeManager();
      await manager.updateConfig({ maxSkills: 200 });
      expect(manager.getConfig().maxSkills).toBe(200);
      expect(storage.setSoulConfigOverrides).toHaveBeenCalled();
    });

    it('updateConfig preserves unpached fields', async () => {
      const { manager } = makeManager({}, { maxSkills: 50, maxPromptTokens: 8000 });
      await manager.updateConfig({ maxSkills: 200 });
      expect(manager.getConfig().maxPromptTokens).toBe(8000);
    });

    it('updateConfig throws on invalid maxSkills (> 200)', async () => {
      const { manager } = makeManager();
      await expect(manager.updateConfig({ maxSkills: 999 })).rejects.toThrow();
    });

    it('updateConfig throws on invalid learningMode value', async () => {
      const { manager } = makeManager();
      await expect(
        manager.updateConfig({ learningMode: ['invalid_mode'] as any })
      ).rejects.toThrow();
    });
  });

  // ── Phase 94: Additional prompt composition edge cases ──────────────────────

  describe('composeSoulPrompt — edge cases', () => {
    it('omits body section entirely when body is disabled and no heartbeat', async () => {
      const personality = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, enabled: false },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();

      // Should NOT contain the Body header
      expect(prompt).not.toContain('## Body');
    });

    it('includes personality sex when not "unspecified"', async () => {
      const personality = { ...PERSONALITY, sex: 'female' };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Sex: female');
    });

    it('includes voice style when set', async () => {
      const personality = { ...PERSONALITY, voice: 'warm and calm' };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Voice style: warm and calm');
    });

    it('includes preferred language when set', async () => {
      const personality = { ...PERSONALITY, preferredLanguage: 'Japanese' };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Preferred language: Japanese');
    });

    it('includes traits as Disposition section', async () => {
      const personality = {
        ...PERSONALITY,
        traits: { formality: 'formal', humor: 'dry', verbosity: 'concise' },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('## Disposition');
      expect(prompt).toContain('**formality** (formal)');
      expect(prompt).toContain('**humor** (dry)');
      expect(prompt).toContain('**verbosity** (concise)');
    });

    it('includes mood fragment when mood engine is wired', async () => {
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(PERSONALITY),
      });

      // Wire a mock mood engine
      const mockMoodEngine = {
        signalTick: vi.fn().mockResolvedValue(null),
        getMood: vi.fn().mockResolvedValue({
          id: 'mood-1',
          personalityId: PERSONALITY.id,
          valence: 0.5,
          arousal: 0.3,
          dominance: 0.5,
          label: 'happy',
          decayRate: 0.05,
          baselineValence: 0,
          baselineArousal: 0,
          updatedAt: Date.now(),
        }),
        composeMoodPromptFragment: vi
          .fn()
          .mockReturnValue('## Current Emotional State\nYou are currently feeling **happy**.'),
      };
      manager.setMoodEngine(mockMoodEngine as any);

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('## Current Emotional State');
      expect(prompt).toContain('happy');
      expect(mockMoodEngine.getMood).toHaveBeenCalledWith(PERSONALITY.id);
    });

    it('omits mood fragment when no mood state exists', async () => {
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(PERSONALITY),
      });

      const mockMoodEngine = {
        signalTick: vi.fn().mockResolvedValue(null),
        getMood: vi.fn().mockResolvedValue(null),
        composeMoodPromptFragment: vi.fn(),
      };
      manager.setMoodEngine(mockMoodEngine as any);

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).not.toContain('Current Emotional State');
      expect(mockMoodEngine.composeMoodPromptFragment).not.toHaveBeenCalled();
    });

    it('omits archetypes when personality.includeArchetypes is false', async () => {
      const personality = { ...PERSONALITY, includeArchetypes: false };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      // Should not contain the archetypes cosmological text
      expect(prompt).not.toContain('No-Thing-Ness');
    });

    it('includes MCP feature toggles section with all features disabled', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          selectedServers: ['local-mcp'],
          mcpFeatures: {
            exposeGit: false,
            exposeFilesystem: false,
            exposeWeb: false,
            exposeWebScraping: false,
            exposeWebSearch: false,
            exposeBrowser: false,
          },
        },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('MCP Connections');
      expect(prompt).toContain('local-mcp');
      expect(prompt).toContain('Git: disabled');
      expect(prompt).toContain('Filesystem: disabled');
      expect(prompt).toContain('Web: disabled');
      expect(prompt).toContain('Browser: disabled');
    });

    it('includes creation tools section that respects security policy gates', async () => {
      const personality = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          enabled: true,
          creationConfig: {
            skills: true,
            tasks: true,
            subAgents: true,
            allowA2A: true,
            allowSwarms: true,
            allowDynamicTools: true,
          },
        },
      };
      // Security policy disables subAgents and swarms
      const { manager } = makeManager(
        {
          getActivePersonality: vi.fn().mockResolvedValue(personality),
        },
        {}
      );
      // Set security config via deps
      (manager as any).deps.securityConfig = {
        allowSubAgents: false,
        allowA2A: false,
        allowSwarms: false,
        allowDynamicTools: false,
      };

      const prompt = await manager.composeSoulPrompt();
      // Should include skills and tasks (not security-gated)
      expect(prompt).toContain('create_skill');
      expect(prompt).toContain('create_task');
      // Should NOT include subAgents, A2A, swarms, dynamicTools (security-gated off)
      expect(prompt).not.toContain('delegate_task');
      expect(prompt).not.toContain('a2a_connect');
      expect(prompt).not.toContain('create_swarm');
      expect(prompt).not.toContain('register_dynamic_tool');
    });

    it('falls back to active personality when personalityId not found', async () => {
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue(null),
        getActivePersonality: vi.fn().mockResolvedValue(PERSONALITY),
      });

      const prompt = await manager.composeSoulPrompt('test', 'nonexistent-id');
      expect(prompt).toContain('FRIDAY');
    });

    it('includes owner context with nickname and notes', async () => {
      const owner = {
        ...USER,
        isOwner: true,
        nickname: 'Bob',
        notes: 'Prefers concise answers',
        preferences: { theme: 'dark', lang: 'en' },
      };
      const { manager } = makeManager({
        getOwner: vi.fn().mockResolvedValue(owner),
      });

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Owner: Alice');
      expect(prompt).toContain('Nickname: Bob');
      expect(prompt).toContain('Notes: Prefers concise answers');
      expect(prompt).toContain('theme: dark');
    });

    it('includes empathyResonance in body prompt when enabled', async () => {
      const personality = {
        ...PERSONALITY,
        empathyResonance: true,
        body: { ...PERSONALITY.body, enabled: true },
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personality),
      });

      const prompt = await manager.composeSoulPrompt();
      // Body section should be present
      expect(prompt).toContain('## Body');
    });
  });

  // ── Phase 107-A: Reasoning Strategy Injection ─────────────────────────────

  describe('composeSoulPrompt — strategy injection', () => {
    it('injects strategy promptPrefix when strategyId is passed', async () => {
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockResolvedValue({
          id: 'strat-1',
          name: 'Chain of Thought',
          slug: 'chain-of-thought',
          promptPrefix: 'Think step by step.',
          category: 'chain_of_thought',
          isBuiltin: true,
        }),
      };
      const { manager } = makeManager();
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt(undefined, undefined, undefined, 'strat-1');
      expect(prompt).toContain('Reasoning Strategy: Chain of Thought');
      expect(prompt).toContain('Think step by step.');
    });

    it('skips injection when strategyId is null', async () => {
      const mockStrategyStorage = { getStrategy: vi.fn() };
      const { manager } = makeManager();
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt(undefined, undefined, undefined, null);
      expect(mockStrategyStorage.getStrategy).not.toHaveBeenCalled();
      expect(prompt).not.toContain('Reasoning Strategy');
    });

    it('falls back to personality defaultStrategyId', async () => {
      const personalityWithDefault = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, defaultStrategyId: 'strat-default' },
      };
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockResolvedValue({
          id: 'strat-default',
          name: 'Reflexion',
          slug: 'reflexion',
          promptPrefix: 'Reflect on your answer.',
          category: 'reflexion',
          isBuiltin: true,
        }),
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personalityWithDefault),
      });
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt();
      expect(prompt).toContain('Reasoning Strategy: Reflexion');
      expect(prompt).toContain('Reflect on your answer.');
    });

    it('explicit strategyId overrides personality default', async () => {
      const personalityWithDefault = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, defaultStrategyId: 'strat-default' },
      };
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockResolvedValue({
          id: 'strat-explicit',
          name: 'Tree of Thought',
          slug: 'tree-of-thought',
          promptPrefix: 'Multiple paths.',
          category: 'tree_of_thought',
          isBuiltin: true,
        }),
      };
      const { manager } = makeManager({
        getActivePersonality: vi.fn().mockResolvedValue(personalityWithDefault),
      });
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt(
        undefined,
        undefined,
        undefined,
        'strat-explicit'
      );
      expect(mockStrategyStorage.getStrategy).toHaveBeenCalledWith('strat-explicit');
      expect(prompt).toContain('Tree of Thought');
    });

    it('skips injection when strategy not found', async () => {
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockResolvedValue(null),
      };
      const { manager } = makeManager();
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt(
        undefined,
        undefined,
        undefined,
        'nonexistent'
      );
      expect(prompt).not.toContain('Reasoning Strategy');
    });

    it('skips injection when strategy has empty promptPrefix', async () => {
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockResolvedValue({
          id: 'strat-std',
          name: 'Standard',
          slug: 'standard',
          promptPrefix: '',
          category: 'standard',
          isBuiltin: true,
        }),
      };
      const { manager } = makeManager();
      manager.setStrategyStorage(mockStrategyStorage as any);

      const prompt = await manager.composeSoulPrompt(undefined, undefined, undefined, 'strat-std');
      expect(prompt).not.toContain('Reasoning Strategy');
    });

    it('silently skips on strategy lookup error', async () => {
      const mockStrategyStorage = {
        getStrategy: vi.fn().mockRejectedValue(new Error('DB down')),
      };
      const { manager } = makeManager();
      manager.setStrategyStorage(mockStrategyStorage as any);

      // Should not throw
      const prompt = await manager.composeSoulPrompt(undefined, undefined, undefined, 'strat-1');
      expect(prompt).not.toContain('Reasoning Strategy');
    });

    it('does not inject when no strategyStorage is set', async () => {
      const { manager } = makeManager();
      // No setStrategyStorage call
      const prompt = await manager.composeSoulPrompt(undefined, undefined, undefined, 'strat-1');
      expect(prompt).not.toContain('Reasoning Strategy');
    });
  });

  // ── Phase 94: isPersonalityWithinActiveHours ────────────────────────────────

  describe('isPersonalityWithinActiveHours (exported function)', () => {
    it('returns false when activeHours is not enabled', async () => {
      const { isPersonalityWithinActiveHours } = await import('./manager.js');
      const p = {
        ...PERSONALITY,
        body: {
          ...PERSONALITY.body,
          activeHours: {
            enabled: false,
            start: '09:00',
            end: '17:00',
            daysOfWeek: ['mon'],
            timezone: 'UTC',
          },
        },
      } as any;
      expect(isPersonalityWithinActiveHours(p)).toBe(false);
    });

    it('returns false when activeHours is undefined', async () => {
      const { isPersonalityWithinActiveHours } = await import('./manager.js');
      const p = { ...PERSONALITY, body: { ...PERSONALITY.body, activeHours: undefined } } as any;
      expect(isPersonalityWithinActiveHours(p)).toBe(false);
    });
  });

  // ── Phase 94: deletePersonality edge cases ──────────────────────────────────

  describe('deletePersonality — additional edge cases', () => {
    it('allows deletion when resourcePolicy is undefined (defaults to auto)', async () => {
      const personality = {
        ...PERSONALITY,
        isActive: false,

        body: { ...PERSONALITY.body, resourcePolicy: undefined },
      };
      const { manager, storage } = makeManager({
        getPersonality: vi.fn().mockResolvedValue(personality),
      });

      await manager.deletePersonality('p-1');
      expect(storage.deletePersonality).toHaveBeenCalledWith('p-1');
    });

    it('allows deletion in request mode (backend allows, frontend confirms)', async () => {
      const personality = {
        ...PERSONALITY,
        isActive: false,

        body: { ...PERSONALITY.body, resourcePolicy: { deletionMode: 'request' } },
      };
      const { manager, storage } = makeManager({
        getPersonality: vi.fn().mockResolvedValue(personality),
      });

      await manager.deletePersonality('p-1');
      expect(storage.deletePersonality).toHaveBeenCalledWith('p-1');
    });
  });

  // ── distillPersonality (Phase 107-E) ───────────────────────────

  describe('distillPersonality', () => {
    it('returns markdown with Runtime Prompt section', async () => {
      const brain = {
        getActiveSkills: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue({
          memories: { total: 5, byType: {} },
          knowledge: { total: 0 },
          skills: { total: 0 },
        }),
        recall: vi.fn().mockResolvedValue([]),
      };
      const { manager } = makeManager({}, {}, brain);
      const result = await manager.distillPersonality('p-1');
      expect(result.markdown).toContain('# Runtime Prompt');
      expect(result.markdown).toContain('# Runtime Context');
      expect(result.metadata.memoryEntries).toBe(5);
      expect(result.metadata.activeSkills.count).toBe(0);
    });

    it('includes memory content when includeMemory is true', async () => {
      const brain = {
        getActiveSkills: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue({
          memories: { total: 2, byType: {} },
          knowledge: { total: 0 },
          skills: { total: 0 },
        }),
        recall: vi.fn().mockResolvedValue([
          { id: 'm1', type: 'semantic', content: 'Memory 1' },
          { id: 'm2', type: 'episodic', content: 'Memory 2' },
        ]),
      };
      const { manager } = makeManager({}, {}, brain);
      const result = await manager.distillPersonality('p-1', { includeMemory: true });
      expect(result.markdown).toContain('## Memory Snapshot');
      expect(result.markdown).toContain('Memory 1');
      expect(result.markdown).toContain('Memory 2');
    });

    it('metadata includes skill names', async () => {
      const brain = {
        getActiveSkills: vi.fn().mockResolvedValue([{ name: 'SkillA' }, { name: 'SkillB' }]),
        getStats: vi.fn().mockResolvedValue({
          memories: { total: 0, byType: {} },
          knowledge: { total: 0 },
          skills: { total: 0 },
        }),
        recall: vi.fn().mockResolvedValue([]),
      };
      const { manager } = makeManager({}, {}, brain);
      const result = await manager.distillPersonality('p-1');
      expect(result.metadata.activeSkills.count).toBe(2);
      expect(result.metadata.activeSkills.names).toEqual(['SkillA', 'SkillB']);
    });

    it('throws for nonexistent personality', async () => {
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue(null),
      });
      await expect(manager.distillPersonality('no-such-id')).rejects.toThrow(
        'Personality not found'
      );
    });

    it('metadata includes strategy name when set', async () => {
      const personalityWithStrategy = {
        ...PERSONALITY,
        body: { ...PERSONALITY.body, defaultStrategyId: 'strat-1' },
      };
      const brain = {
        getActiveSkills: vi.fn().mockResolvedValue([]),
        getStats: vi.fn().mockResolvedValue({
          memories: { total: 0, byType: {} },
          knowledge: { total: 0 },
          skills: { total: 0 },
        }),
        recall: vi.fn().mockResolvedValue([]),
      };
      const { manager } = makeManager(
        { getPersonality: vi.fn().mockResolvedValue(personalityWithStrategy) },
        {},
        brain
      );
      // Wire strategy storage
      manager.setStrategyStorage({
        getStrategy: vi.fn().mockResolvedValue({ name: 'Chain of Thought' }),
      } as any);
      const result = await manager.distillPersonality('p-1');
      expect(result.metadata.appliedStrategy).toBe('Chain of Thought');
    });

    it('works without brain manager', async () => {
      const { manager } = makeManager();
      const result = await manager.distillPersonality('p-1');
      expect(result.markdown).toContain('# Runtime Prompt');
      expect(result.metadata.activeSkills.count).toBe(0);
      expect(result.metadata.memoryEntries).toBe(0);
    });

    it('metadata model config is null when no default model', async () => {
      const { manager } = makeManager();
      const result = await manager.distillPersonality('p-1');
      expect(result.metadata.modelConfig).toBeNull();
    });

    it('metadata model config includes provider and model when set', async () => {
      const personalityWithModel = {
        ...PERSONALITY,
        defaultModel: { provider: 'ollama', model: 'llama3' },
      };
      const { manager } = makeManager({
        getPersonality: vi.fn().mockResolvedValue(personalityWithModel),
      });
      const result = await manager.distillPersonality('p-1');
      expect(result.metadata.modelConfig).toEqual({ provider: 'ollama', model: 'llama3' });
    });
  });
});
