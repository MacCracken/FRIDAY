/**
 * SoulManager — Composes personality + skills into AI system prompts.
 *
 * Manages the full lifecycle of personalities and skills, including
 * creation, approval workflows, and prompt composition.
 *
 * When a BrainManager is provided, skills are delegated to the Brain
 * and relevant context is injected into the composed prompt.
 */

import type { SoulStorage } from './storage.js';
import type { BrainManager } from '../brain/manager.js';
import type { SpiritManager } from '../spirit/manager.js';
import type {
  Personality,
  PersonalityCreate,
  PersonalityUpdate,
  Skill,
  SkillCreate,
  SkillUpdate,
  SoulConfig,
  Tool,
  SoulManagerDeps,
  SkillFilter,
  UserProfile,
  UserProfileCreate,
  UserProfileUpdate,
} from './types.js';

export class SoulManager {
  private readonly storage: SoulStorage;
  private readonly brain: BrainManager | null;
  private readonly spirit: SpiritManager | null;
  private readonly config: SoulConfig;
  private readonly deps: SoulManagerDeps;

  constructor(storage: SoulStorage, config: SoulConfig, deps: SoulManagerDeps, brain?: BrainManager, spirit?: SpiritManager) {
    this.storage = storage;
    this.config = config;
    this.deps = deps;
    this.brain = brain ?? null;
    this.spirit = spirit ?? null;
  }

  // ── Agent Name ─────────────────────────────────────────────

  getAgentName(): string | null {
    return this.storage.getAgentName();
  }

  setAgentName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new Error('Agent name cannot be empty');
    }
    this.storage.setAgentName(name.trim());
  }

  // ── Onboarding ──────────────────────────────────────────────

  needsOnboarding(): boolean {
    return this.storage.getAgentName() === null || this.storage.getPersonalityCount() === 0;
  }

  createDefaultPersonality(): Personality {
    const agentName = this.storage.getAgentName() ?? 'FRIDAY';

    const personality = this.storage.createPersonality({
      name: agentName,
      description: 'Friendly, Reliable, Intelligent Digital Assistant Yeoman',
      systemPrompt:
        `You are ${agentName}, a helpful and security-conscious AI assistant. You are direct, technically precise, and proactive about identifying risks.`,
      traits: { formality: 'balanced', humor: 'subtle', verbosity: 'concise' },
      sex: 'unspecified',
      voice: '',
      preferredLanguage: '',
    });

    this.storage.setActivePersonality(personality.id);
    return this.storage.getPersonality(personality.id)!;
  }

  // ── Personality ─────────────────────────────────────────────

  getActivePersonality(): Personality | null {
    return this.storage.getActivePersonality();
  }

  setPersonality(id: string): void {
    this.storage.setActivePersonality(id);
  }

  createPersonality(data: PersonalityCreate): Personality {
    return this.storage.createPersonality(data);
  }

  updatePersonality(id: string, data: PersonalityUpdate): Personality {
    return this.storage.updatePersonality(id, data);
  }

  deletePersonality(id: string): void {
    const personality = this.storage.getPersonality(id);
    if (personality?.isActive) {
      throw new Error('Cannot delete the active personality');
    }
    this.storage.deletePersonality(id);
  }

  listPersonalities(): Personality[] {
    return this.storage.listPersonalities();
  }

  // ── Skills (delegated to Brain when available) ────────────

  createSkill(data: SkillCreate): Skill {
    if (this.brain) {
      return this.brain.createSkill(data);
    }
    const count = this.storage.getSkillCount();
    if (count >= this.config.maxSkills) {
      throw new Error(`Maximum skill limit reached (${this.config.maxSkills})`);
    }
    return this.storage.createSkill(data);
  }

  updateSkill(id: string, data: SkillUpdate): Skill {
    if (this.brain) {
      return this.brain.updateSkill(id, data);
    }
    return this.storage.updateSkill(id, data);
  }

  deleteSkill(id: string): void {
    if (this.brain) {
      this.brain.deleteSkill(id);
      return;
    }
    this.storage.deleteSkill(id);
  }

  enableSkill(id: string): void {
    if (this.brain) {
      this.brain.enableSkill(id);
      return;
    }
    this.storage.updateSkill(id, { enabled: true });
  }

  disableSkill(id: string): void {
    if (this.brain) {
      this.brain.disableSkill(id);
      return;
    }
    this.storage.updateSkill(id, { enabled: false });
  }

  listSkills(filter?: SkillFilter): Skill[] {
    if (this.brain) {
      return this.brain.listSkills(filter);
    }
    return this.storage.listSkills(filter);
  }

  getSkill(id: string): Skill | null {
    if (this.brain) {
      return this.brain.getSkill(id);
    }
    return this.storage.getSkill(id);
  }

  approveSkill(id: string): Skill {
    if (this.brain) {
      return this.brain.approveSkill(id);
    }
    const skill = this.storage.getSkill(id);
    if (!skill) {
      throw new Error(`Skill not found: ${id}`);
    }
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    return this.storage.updateSkill(id, { status: 'active' });
  }

  rejectSkill(id: string): void {
    if (this.brain) {
      this.brain.rejectSkill(id);
      return;
    }
    const skill = this.storage.getSkill(id);
    if (!skill) {
      throw new Error(`Skill not found: ${id}`);
    }
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    this.storage.deleteSkill(id);
  }

  // ── Users ──────────────────────────────────────────────────

  getUser(id: string): UserProfile | null {
    return this.storage.getUser(id);
  }

  getUserByName(name: string): UserProfile | null {
    return this.storage.getUserByName(name);
  }

  getOwner(): UserProfile | null {
    return this.storage.getOwner();
  }

  createUser(data: UserProfileCreate): UserProfile {
    return this.storage.createUser(data);
  }

  updateUser(id: string, data: UserProfileUpdate): UserProfile {
    return this.storage.updateUser(id, data);
  }

  deleteUser(id: string): boolean {
    return this.storage.deleteUser(id);
  }

  listUsers(): UserProfile[] {
    return this.storage.listUsers();
  }

  // ── Learning ────────────────────────────────────────────────

  proposeSkill(data: Omit<SkillCreate, 'source' | 'status'>): Skill {
    if (!this.config.learningMode.includes('ai_proposed')) {
      throw new Error('AI-proposed learning mode is not enabled');
    }
    return this.createSkill({
      ...data,
      source: 'ai_proposed',
      status: 'pending_approval',
      enabled: false,
    });
  }

  learnSkill(data: Omit<SkillCreate, 'source' | 'status'>): Skill {
    if (!this.config.learningMode.includes('autonomous')) {
      throw new Error('Autonomous learning mode is not enabled');
    }
    return this.createSkill({
      ...data,
      source: 'ai_learned',
      status: 'active',
      enabled: true,
    });
  }

  incrementSkillUsage(skillId: string): void {
    if (this.brain) {
      this.brain.incrementSkillUsage(skillId);
      return;
    }
    this.storage.incrementUsage(skillId);
  }

  // ── Composition ─────────────────────────────────────────────

  composeSoulPrompt(input?: string): string {
    if (!this.config.enabled) {
      return '';
    }

    const parts: string[] = [];
    const agentName = this.storage.getAgentName();
    const personality = this.storage.getActivePersonality();

    if (agentName && personality?.name !== agentName) {
      parts.push(`Your name is ${agentName}.`);
    }

    if (personality) {
      parts.push(`You are ${personality.name}. ${personality.systemPrompt}`.trim());

      if (personality.sex !== 'unspecified') {
        parts.push(`Sex: ${personality.sex}`);
      }

      if (personality.voice) {
        parts.push(`Voice style: ${personality.voice}`);
      }

      if (personality.preferredLanguage) {
        parts.push(`Preferred language: ${personality.preferredLanguage}`);
      }

      const traitEntries = Object.entries(personality.traits);
      if (traitEntries.length > 0) {
        const traitStr = traitEntries.map(([k, v]) => `${k}: ${v}`).join(', ');
        parts.push(`Traits: ${traitStr}`);
      }
    }

    // User context injection
    const owner = this.storage.getOwner();
    if (owner) {
      const userParts: string[] = [`Owner: ${owner.name}`];
      if (owner.nickname) userParts.push(`Nickname: ${owner.nickname}`);
      if (owner.notes) userParts.push(`Notes: ${owner.notes}`);
      const prefEntries = Object.entries(owner.preferences);
      if (prefEntries.length > 0) {
        userParts.push('Preferences: ' + prefEntries.map(([k, v]) => `${k}: ${v}`).join(', '));
      }
      parts.push('## User Context\n' + userParts.join('\n'));
    }

    // Spirit context injection (passions, inspirations, pains)
    if (this.spirit) {
      const spiritPrompt = this.spirit.composeSpiritPrompt();
      if (spiritPrompt) {
        parts.push(spiritPrompt);
      }
    }

    // Brain context injection
    if (this.brain && input) {
      const context = this.brain.getRelevantContext(input);
      if (context) {
        parts.push('## Relevant Context\n' + context);
      }
    }

    // Skills from Brain or Soul storage
    const skills = this.brain
      ? this.brain.getActiveSkills()
      : this.storage.getEnabledSkills();

    for (const skill of skills) {
      if (skill.instructions) {
        parts.push(`## Skill: ${skill.name}\n${skill.instructions}`);
      }
    }

    let prompt = parts.join('\n\n');

    // Token cap: estimate ~4 chars per token
    const maxChars = this.config.maxPromptTokens * 4;
    if (prompt.length > maxChars) {
      prompt = prompt.slice(0, maxChars);
    }

    return prompt;
  }

  getActiveTools(): Tool[] {
    if (!this.config.enabled) {
      return [];
    }

    if (this.brain) {
      return this.brain.getActiveTools();
    }

    const skills = this.storage.getEnabledSkills();
    const tools: Tool[] = [];
    for (const skill of skills) {
      if (skill.tools && skill.tools.length > 0) {
        tools.push(...skill.tools);
      }
    }
    return tools;
  }

  // ── Config ──────────────────────────────────────────────────

  getConfig(): SoulConfig {
    return this.config;
  }

  // ── Brain Access ────────────────────────────────────────────

  getBrain(): BrainManager | null {
    return this.brain;
  }

  // ── Spirit Access ──────────────────────────────────────────

  getSpirit(): SpiritManager | null {
    return this.spirit;
  }

  // ── Cleanup ─────────────────────────────────────────────────

  close(): void {
    this.storage.close();
  }
}
