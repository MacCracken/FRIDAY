/**
 * SoulManager — Composes personality + skills into AI system prompts.
 *
 * Manages the full lifecycle of personalities and skills, including
 * creation, approval workflows, and prompt composition.
 *
 * Prompt composition begins with the Sacred Archetypes preamble —
 * the cosmological foundation (No-Thing-Ness → The One → The Plurality)
 * that grounds the "In Our Image" hierarchy.
 *
 * When a BrainManager is provided, skills are delegated to the Brain
 * and relevant context is injected into the composed prompt.
 */

import os from 'os';
import { SoulConfigSchema } from '@secureyeoman/shared';
import { composeArchetypesPreamble } from './archetypes.js';
import {
  PERSONALITY_PRESETS,
  getAllPresets,
  getPersonalityPreset,
  type PersonalityPreset,
} from './presets.js';
import type { SoulStorage } from './storage.js';
import type { BrainManager } from '../brain/manager.js';
import type { MarketplaceManager } from '../marketplace/manager.js';
import type { DynamicToolManager } from './dynamic-tool-manager.js';
import type { IntentManager } from '../intent/manager.js';
import type { IntegrationManager } from '../integrations/manager.js';
import type { SpiritManager } from '../spirit/manager.js';
import type { HeartbeatManager } from '../body/heartbeat.js';
import { HeartManager } from '../body/heart.js';
import type { StrategyStorage } from './strategy-storage.js';
import type { PersonalityVersionManager } from './personality-version-manager.js';
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
import { applySkillTrustFilter } from './skill-trust.js';
import { getCreationTools } from './creation-tools.js';
import { PersonalityMarkdownSerializer } from './personality-serializer.js';
import type { MoodEngine } from '../simulation/mood-engine.js';
import { composeTraitDisposition } from './trait-descriptions.js';
import * as bhava from '../native/bhava.js';

export interface DistillationMetadata {
  activeSkills: { count: number; names: string[] };
  memoryEntries: number;
  connectedIntegrations: string[];
  appliedStrategy: string | null;
  modelConfig: { provider: string; model: string } | null;
  composedAt: string;
}

/**
 * Returns true when the current wall-clock time falls within the personality's
 * configured activeHours window. Always returns false when activeHours is disabled.
 */
export function isPersonalityWithinActiveHours(p: Personality): boolean {
  const ah = p.body?.activeHours;
  if (!ah?.enabled) return false;
  const now = new Date();
  const tz = ah.timezone ?? 'UTC';
  const dayAbbr = now
    .toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
    .toLowerCase()
    .slice(0, 3); // 'mon', 'tue', ...
  if (!ah.daysOfWeek.includes(dayAbbr as (typeof ah.daysOfWeek)[number])) return false;
  const hhmm = now.toLocaleTimeString('en-US', { timeZone: tz, hour12: false }).slice(0, 5); // 'HH:MM'
  return hhmm >= ah.start && hhmm <= ah.end;
}

// Compiled RegExp cache — patterns are stable after DB load, so we compile once.
const MAX_TRIGGER_CACHE = 10_000;
const triggerPatternCache = new Map<string, RegExp | null>();

/** Reject patterns with nested quantifiers that can cause catastrophic backtracking. */
function isUnsafeRegex(pattern: string): boolean {
  // Detect nested quantifiers: (a+)+, (a*)+, (a+)*, etc.
  if (/(\([^)]*[+*][^)]*\))[+*{]/.test(pattern)) return true;
  // Detect overlapping alternation with quantifiers: (a|a)+
  if (/\([^)]*\|[^)]*\)[+*{]/.test(pattern) && pattern.length > 100) return true;
  // Reject excessively long patterns
  if (pattern.length > 500) return true;
  return false;
}

function compileTriggerPattern(pattern: string): RegExp | null {
  if (triggerPatternCache.has(pattern)) return triggerPatternCache.get(pattern)!;
  if (triggerPatternCache.size >= MAX_TRIGGER_CACHE) {
    const oldest = triggerPatternCache.keys().next().value;
    if (oldest !== undefined) triggerPatternCache.delete(oldest);
  }
  let re: RegExp | null;
  try {
    if (isUnsafeRegex(pattern)) {
      re = null; // Fall back to substring matching
    } else {
      re = new RegExp(pattern, 'i');
    }
  } catch {
    re = null;
  }
  triggerPatternCache.set(pattern, re);
  return re;
}

/**
 * Returns true when the user message is relevant to the given skill.
 *
 * Matching priority:
 *  1. triggerPatterns — each entry is tried as a RegExp (case-insensitive);
 *     falls back to plain substring if the pattern is invalid.
 *  2. Skill-name keyword fallback — words from the skill name longer than
 *     3 chars are matched as substrings in the message.
 */
function isSkillInContext(skill: Skill, message: string): boolean {
  if (skill.triggerPatterns.length > 0) {
    return skill.triggerPatterns.some((pattern) => {
      const re = compileTriggerPattern(pattern);
      return re ? re.test(message) : message.toLowerCase().includes(pattern.toLowerCase());
    });
  }
  // Keyword fallback: significant words from the skill name
  const words = skill.name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const msg = message.toLowerCase();
  return words.some((w) => msg.includes(w));
}

/**
 * Expands the {{output_dir}} template variable in skill instructions.
 * Resolves to `outputs/{skill-slug}/{iso-date}/`.
 */
function expandOutputDir(skill: Skill): string {
  const slug = skill.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const isoDate = new Date().toISOString().slice(0, 10);
  return skill.instructions.replace(/\{\{output_dir\}\}/g, `outputs/${slug}/${isoDate}/`);
}

export class SoulManager {
  private readonly storage: SoulStorage;
  private readonly brain: BrainManager | null;
  private readonly spirit: SpiritManager | null;
  private readonly baseConfig: SoulConfig;
  private config: SoulConfig;
  private readonly deps: SoulManagerDeps;
  private heartbeat: HeartbeatManager | null = null;
  private heartManager: HeartManager | null = null;
  private marketplace: MarketplaceManager | null = null;
  private dynamicToolManager: DynamicToolManager | null = null;
  private intentManager: IntentManager | null = null;
  private integrationManager: IntegrationManager | null = null;
  private strategyStorage: StrategyStorage | null = null;
  private personalityVersionManager: PersonalityVersionManager | null = null;
  private moodEngine: MoodEngine | null = null;

  setPersonalityVersionManager(manager: PersonalityVersionManager): void {
    this.personalityVersionManager = manager;
  }

  setStrategyStorage(storage: StrategyStorage): void {
    this.strategyStorage = storage;
  }

  setIntegrationManager(mgr: IntegrationManager): void {
    this.integrationManager = mgr;
  }

  setMoodEngine(engine: MoodEngine): void {
    this.moodEngine = engine;
  }

  /**
   * Analyze response text sentiment and feed back into the personality's
   * emotional state. Uses bhava's 6D sentiment analysis when native module
   * is available, falls back to a no-op otherwise.
   *
   * Call this after persisting an assistant response to close the
   * sentiment → mood → prompt feedback loop.
   */
  async processSentimentFeedback(
    personalityId: string,
    responseText: string,
    scale = 0.3
  ): Promise<void> {
    if (!this.moodEngine || !responseText) return;
    try {
      const personality = await this.storage.getPersonality(personalityId);
      if (!personality) return;

      // Bhava 2.0 signal loop path: sentiment → mood → signal tick → updated state
      const tickResult = await this.moodEngine.processSentimentAndTick(
        personalityId,
        responseText,
        personality.traits,
        scale
      );
      if (tickResult) return; // Signal loop handled it

      // Fallback: bhava 1.x path (no composite state initialized)
      const stateJson = bhava.createEmotionalStateWithBaseline(personality.traits);
      if (!stateJson) return;

      const result = bhava.applySentimentFeedback(responseText, stateJson, scale);
      if (!result) return;

      await this.moodEngine.applyEvent(personalityId, {
        eventType: 'response_sentiment',
        valenceDelta: result.valence * scale,
        arousalDelta: Math.abs(result.valence) * 0.1,
        source: 'bhava_sentiment',
        metadata: {},
      });
    } catch {
      // Best-effort — sentiment feedback should never fail the response
    }
  }

  setMarketplaceManager(manager: MarketplaceManager): void {
    this.marketplace = manager;
  }

  /**
   * Wire in the DynamicToolManager so that registered dynamic tool schemas are
   * injected into the AI context by getActiveTools().
   */
  setDynamicToolManager(manager: DynamicToolManager): void {
    this.dynamicToolManager = manager;
  }

  setIntentManager(manager: IntentManager): void {
    this.intentManager = manager;
  }

  constructor(
    storage: SoulStorage,
    config: SoulConfig,
    deps: SoulManagerDeps,
    brain?: BrainManager,
    spirit?: SpiritManager
  ) {
    this.storage = storage;
    this.baseConfig = config;
    this.config = config;
    this.deps = deps;
    this.brain = brain ?? null;
    this.spirit = spirit ?? null;
  }

  // ── Agent Name ─────────────────────────────────────────────

  async getAgentName(): Promise<string | null> {
    return this.storage.getAgentName();
  }

  async setAgentName(name: string): Promise<void> {
    if (!name || name.trim().length === 0) {
      throw new Error('Agent name cannot be empty');
    }
    await this.storage.setAgentName(name.trim());
  }

  // ── Onboarding ──────────────────────────────────────────────

  async needsOnboarding(): Promise<boolean> {
    const [agentName, personalityCount] = await Promise.all([
      this.storage.getAgentName(),
      this.storage.getPersonalityCount(),
    ]);
    return agentName === null || personalityCount === 0;
  }

  async createDefaultPersonality(): Promise<Personality> {
    const agentName = (await this.storage.getAgentName()) ?? 'FRIDAY';

    const personality = await this.storage.createPersonality({
      name: agentName,
      description: 'Friendly, Reliable, Intelligent Digitally Adaptable Yeoman',
      systemPrompt: `You are ${agentName}, a helpful and security-conscious AI assistant. You are direct, technically precise, and proactive about identifying risks.`,
      traits: {
        formality: 'casual',
        humor: 'dry',
        verbosity: 'concise',
        directness: 'candid',
        warmth: 'friendly',
        empathy: 'balanced',
        patience: 'balanced',
        confidence: 'assertive',
        creativity: 'imaginative',
        risk_tolerance: 'balanced',
        curiosity: 'curious',
        autonomy: 'proactive',
        pedagogy: 'explanatory',
        precision: 'precise',
      },
      sex: 'unspecified',
      voice: '',
      preferredLanguage: '',
      defaultModel: null,
      modelFallbacks: [],
      includeArchetypes: agentName === 'FRIDAY',
      injectDateTime: false,
      empathyResonance: false,
      avatarUrl: null,
      body: {
        enabled: false,
        capabilities: [],
        heartEnabled: true,
        warmupOnActivation: false,
        creationConfig: {
          skills: false,
          tasks: false,
          personalities: false,
          subAgents: false,
          customRoles: false,
          roleAssignments: false,
          experiments: false,
          allowA2A: false,
          allowSwarms: false,
          allowDynamicTools: false,
          workflows: false,
        },
        selectedServers: [],
        selectedIntegrations: [],
        integrationAccess: [],
        mcpFeatures: {
          exposeGit: false,
          exposeFilesystem: false,
          exposeWeb: false,
          exposeWebScraping: false,
          exposeWebSearch: false,
          exposeBrowser: false,
          exposeDesktopControl: false,
          exposeNetworkDevices: false,
          exposeNetworkDiscovery: false,
          exposeNetworkAudit: false,
          exposeNetBox: false,
          exposeNvd: false,
          exposeNetworkUtils: false,
          exposeTwingate: false,
          exposeGmail: false,
          exposeTwitter: false,
          exposeGithub: false,
          exposeDocker: false,
          exposeCicd: false,
          exposeSra: false,
          exposeDiagramming: false,
          exposePdf: false,
          exposePdfAdvanced: false,
          exposeCognitiveMemory: false,
          exposeCharting: false,
          exposeConstitutional: false,
          exposeTee: false,
          exposeEval: false,
          exposeDlp: false,
          exposeTerminal: false,
          exposeBullshift: false,
          exposePhotisnadi: false,
          exposeIfran: false,
          exposeDelta: false,
          exposeVoice: false,
          exposeEdge: false,
        },
        activeHours: {
          enabled: false,
          start: '09:00',
          end: '17:00',
          daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
          timezone: 'UTC',
        },
        omnipresentMind: false,
        knowledgeMode: 'rag' as const,
        enableCitations: false,
        groundednessMode: 'off' as const,
        contextOverflowStrategy: 'summarise' as const,
        confidentialCompute: 'off' as const,
        pollyLexiconNames: [],
        voiceAnnouncements: false,
        voiceAnnouncementEvents: [],
      },
      brainConfig: {
        proactiveConfig: {
          enabled: false,
          builtins: {
            dailyStandup: false,
            weeklySummary: false,
            contextualFollowup: false,
            integrationHealthAlert: false,
            securityAlertDigest: false,
          },
          builtinModes: {
            dailyStandup: 'auto',
            weeklySummary: 'suggest',
            contextualFollowup: 'suggest',
            integrationHealthAlert: 'auto',
            securityAlertDigest: 'suggest',
          },
          learning: { enabled: true, minConfidence: 0.7 },
        },
      },
    });

    await this.storage.setActivePersonality(personality.id);
    return (await this.storage.getPersonality(personality.id))!;
  }

  /**
   * Seeds all available personality presets on first boot.
   *
   * The first preset (FRIDAY) is created as the active personality, honouring
   * the configured agent name. All other presets are created as inactive so they
   * are immediately available for selection in the UI without manual instantiation.
   */
  async seedAvailablePresets(): Promise<Personality[]> {
    const agentName = (await this.storage.getAgentName()) ?? 'FRIDAY';
    const created: Personality[] = [];

    const [firstPreset, ...restPresets] = PERSONALITY_PRESETS;

    if (firstPreset) {
      // For the primary preset, honour the configured agent name so the
      // active personality matches whatever name was set during onboarding.
      const data: PersonalityCreate = {
        ...firstPreset.data,
        name: agentName,
        systemPrompt: `You are ${agentName}, a helpful and security-conscious AI assistant. You are direct, technically precise, and proactive about identifying risks.`,
        includeArchetypes: agentName === 'FRIDAY',
        injectDateTime: false,
      };
      const personality = await this.storage.createPersonality(data);
      created.push(personality);
    }

    for (const preset of restPresets) {
      const personality = await this.storage.createPersonality(preset.data);
      created.push(personality);
    }

    const first = created[0];
    if (first) {
      await this.storage.setActivePersonality(first.id);
    }

    return created;
  }

  // ── Personality ─────────────────────────────────────────────

  async getPersonality(id: string): Promise<Personality | null> {
    return this.storage.getPersonality(id);
  }

  async getActivePersonality(): Promise<Personality | null> {
    return this.storage.getActivePersonality();
  }

  async setPersonality(id: string): Promise<void> {
    await this.storage.setActivePersonality(id);
  }

  async updatePersonalityAvatar(id: string, avatarUrl: string | null): Promise<Personality> {
    return this.storage.updatePersonalityAvatar(id, avatarUrl);
  }

  async createPersonality(data: PersonalityCreate): Promise<Personality> {
    return this.storage.createPersonality(data);
  }

  async updatePersonality(id: string, data: PersonalityUpdate): Promise<Personality> {
    const result = await this.storage.updatePersonality(id, data);
    // Fire-and-forget version recording
    this.personalityVersionManager?.recordVersion(id).catch((err: unknown) => {
      this.deps.logger.error({ err }, 'Failed to record personality version');
    });
    return result;
  }

  async deletePersonality(id: string): Promise<void> {
    const personality = await this.storage.getPersonality(id);
    if (personality?.isActive) {
      throw new Error('Cannot delete the active personality');
    }
    const mode = personality?.body?.resourcePolicy?.deletionMode ?? 'auto';
    if (mode === 'manual') {
      throw new Error(
        'Deletion is blocked (mode: manual). Change the deletion mode in Body → Resources first.'
      );
    }
    // 'request' mode: backend allows deletion; frontend enforces confirmation dialog.
    await this.storage.deletePersonality(id);
  }

  async listPersonalities(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<{ personalities: Personality[]; total: number }> {
    return this.storage.listPersonalities(opts);
  }

  async enablePersonality(id: string): Promise<void> {
    return this.storage.enablePersonality(id);
  }

  async disablePersonality(id: string): Promise<void> {
    return this.storage.disablePersonality(id);
  }

  async setDefaultPersonality(id: string): Promise<void> {
    await this.storage.setDefaultPersonality(id);
    if (this.heartbeat) {
      const personality = await this.storage.getPersonality(id);
      if (personality) {
        this.heartbeat.setPersonalitySchedule(personality.body?.activeHours ?? null);
      }
      this.heartbeat.setActivePersonalityId(id);
    }
  }

  async clearDefaultPersonality(): Promise<void> {
    await this.storage.clearDefaultPersonality();
    if (this.heartbeat) {
      this.heartbeat.setPersonalitySchedule(null);
      this.heartbeat.setActivePersonalityId(null);
    }
  }

  async getEnabledPersonalities(): Promise<Personality[]> {
    return this.storage.getEnabledPersonalities();
  }

  // ── Personality Presets ─────────────────────────────────────

  listPersonalityPresets(): PersonalityPreset[] {
    return getAllPresets();
  }

  async createPersonalityFromPreset(
    presetId: string,
    overrides?: Partial<PersonalityCreate>
  ): Promise<Personality> {
    const preset = getPersonalityPreset(presetId);
    if (!preset) {
      throw new Error(`Unknown personality preset: ${presetId}`);
    }
    return this.storage.createPersonality({ ...preset.data, ...overrides });
  }

  // ── Skills (delegated to Brain when available) ────────────

  async createSkill(data: SkillCreate): Promise<Skill> {
    if (this.brain) {
      return this.brain.createSkill(data);
    }
    const count = await this.storage.getSkillCount();
    if (count >= this.config.maxSkills) {
      throw new Error(`Maximum skill limit reached (${this.config.maxSkills})`);
    }
    return this.storage.createSkill(data);
  }

  async updateSkill(id: string, data: SkillUpdate): Promise<Skill> {
    if (this.brain) {
      return this.brain.updateSkill(id, data);
    }
    return this.storage.updateSkill(id, data);
  }

  async deleteSkill(id: string): Promise<void> {
    if (this.brain) {
      // Capture skill details before deletion so we can sync marketplace state
      const skill = await this.brain.getSkill(id);
      await this.brain.deleteSkill(id);
      if (skill && this.marketplace) {
        await this.marketplace.onBrainSkillDeleted(skill.name, skill.source);
      }
      return;
    }
    await this.storage.deleteSkill(id);
  }

  async enableSkill(id: string): Promise<void> {
    if (this.brain) {
      await this.brain.enableSkill(id);
      return;
    }
    await this.storage.updateSkill(id, { enabled: true });
  }

  async disableSkill(id: string): Promise<void> {
    if (this.brain) {
      await this.brain.disableSkill(id);
      return;
    }
    await this.storage.updateSkill(id, { enabled: false });
  }

  async listSkills(
    filter?: SkillFilter & { limit?: number; offset?: number }
  ): Promise<{ skills: Skill[]; total: number }> {
    let skills: Skill[];
    let total: number;

    if (this.brain) {
      const brainSkills = await this.brain.listSkills(filter);
      skills = brainSkills;
      total = brainSkills.length;
    } else {
      const result = await this.storage.listSkills(filter);
      skills = result.skills;
      total = result.total;
    }

    const withPersonality = skills.filter((s) => s.personalityId);
    if (withPersonality.length === 0) return { skills, total };

    const { personalities } = await this.storage.listPersonalities();
    const pMap = new Map(personalities.map((p) => [p.id, p.name]));
    return {
      skills: skills.map((s) =>
        s.personalityId ? { ...s, personalityName: pMap.get(s.personalityId) ?? null } : s
      ),
      total,
    };
  }

  async getSkill(id: string): Promise<Skill | null> {
    if (this.brain) {
      return this.brain.getSkill(id);
    }
    return this.storage.getSkill(id);
  }

  async approveSkill(id: string): Promise<Skill> {
    if (this.brain) {
      return this.brain.approveSkill(id);
    }
    const skill = await this.storage.getSkill(id);
    if (!skill) {
      throw new Error(`Skill not found: ${id}`);
    }
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    return this.storage.updateSkill(id, { status: 'active' });
  }

  async rejectSkill(id: string): Promise<void> {
    if (this.brain) {
      await this.brain.rejectSkill(id);
      return;
    }
    const skill = await this.storage.getSkill(id);
    if (!skill) {
      throw new Error(`Skill not found: ${id}`);
    }
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    await this.storage.deleteSkill(id);
  }

  // ── Users ──────────────────────────────────────────────────

  async getUser(id: string): Promise<UserProfile | null> {
    return this.storage.getUser(id);
  }

  async getUserByName(name: string): Promise<UserProfile | null> {
    return this.storage.getUserByName(name);
  }

  async getOwner(): Promise<UserProfile | null> {
    return this.storage.getOwner();
  }

  async createUser(data: UserProfileCreate): Promise<UserProfile> {
    return this.storage.createUser(data);
  }

  async updateUser(id: string, data: UserProfileUpdate): Promise<UserProfile> {
    return this.storage.updateUser(id, data);
  }

  async deleteUser(id: string): Promise<boolean> {
    return this.storage.deleteUser(id);
  }

  async listUsers(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<{ users: UserProfile[]; total: number }> {
    return this.storage.listUsers(opts);
  }

  // ── Learning ────────────────────────────────────────────────

  async proposeSkill(data: Omit<SkillCreate, 'source' | 'status'>): Promise<Skill> {
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

  async learnSkill(data: Omit<SkillCreate, 'source' | 'status'>): Promise<Skill> {
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

  async incrementSkillUsage(skillId: string): Promise<void> {
    if (this.brain) {
      await this.brain.incrementSkillUsage(skillId);
      return;
    }
    await this.storage.incrementUsage(skillId);
  }

  async incrementSkillInvoked(skillId: string): Promise<void> {
    await this.storage.incrementInvoked(skillId);
  }

  // ── Body / Heart ──────────────────────────────────────────────

  setHeart(heart: HeartManager): void {
    this.heartManager = heart;
  }

  setHeartbeat(hb: HeartbeatManager): void {
    this.heartbeat = hb;
    this.heartManager = new HeartManager(hb);
    // Sync current default personality ID so log entries are attributed correctly
    this.storage
      .getActivePersonality()
      .then((p) => {
        if (p) hb.setActivePersonalityId(p.id);
      })
      .catch(() => {
        /* non-fatal */
      });
  }

  private composeBodyPrompt(personality: Personality | null): string {
    const bodyEnabled = personality?.body?.enabled ?? false;
    if (!bodyEnabled && !this.heartManager && !this.heartbeat) return '';

    const lines: string[] = [
      '## Body',
      'Your Body is your form — the vessel and capabilities through which you act in the world.',
    ];

    // Capabilities — show enabled/disabled from personality config
    const allCapabilities = [
      'vision',
      'limb_movement',
      'auditory',
      'haptic',
      'diagnostics',
    ] as const;
    const enabledCaps = personality?.body?.capabilities ?? [];
    const capLines: string[] = [];
    for (const cap of allCapabilities) {
      const status = enabledCaps.includes(cap) ? 'enabled' : 'disabled';
      capLines.push(`- **${cap}**: ${status}`);
    }
    lines.push('');
    lines.push('### Capabilities');
    lines.push(...capLines);

    // MCP Connections — list selected servers and feature toggles
    const selectedServers = personality?.body?.selectedServers ?? [];
    const mcpFeatures = personality?.body?.mcpFeatures ?? {
      exposeGit: false,
      exposeFilesystem: false,
      exposeWeb: false,
      exposeWebScraping: false,
      exposeWebSearch: false,
      exposeBrowser: false,
      exposeDesktopControl: false,
      exposeTerminal: false,
    };
    if (selectedServers.length > 0) {
      lines.push('');
      lines.push('### MCP Connections');
      lines.push(`Connected servers: ${selectedServers.join(', ')}`);
      const webParts: string[] = [];
      if (mcpFeatures.exposeWeb) {
        const webSubs: string[] = [];
        if (mcpFeatures.exposeWebScraping) webSubs.push('scraping');
        if (mcpFeatures.exposeWebSearch) webSubs.push('search');
        webParts.push(webSubs.length > 0 ? `enabled (${webSubs.join(', ')})` : 'enabled');
      } else {
        webParts.push('disabled');
      }
      lines.push(
        `Tool categories — Git: ${mcpFeatures.exposeGit ? 'enabled' : 'disabled'}, Filesystem: ${mcpFeatures.exposeFilesystem ? 'enabled' : 'disabled'}, Web: ${webParts[0]}, Browser: ${mcpFeatures.exposeBrowser ? 'enabled' : 'disabled'}, Terminal: ${mcpFeatures.exposeTerminal ? 'enabled' : 'disabled'}`
      );
    }

    // Creation Tools — list enabled capabilities with the exact tool names so
    // the model knows how to act without hesitation.
    const creation = personality?.body?.creationConfig;
    if (creation) {
      const TOOL_MAP: Record<string, string[]> = {
        skills: ['create_skill', 'update_skill', 'delete_skill'],
        tasks: ['create_task', 'update_task'],
        personalities: ['create_personality', 'update_personality'],
        subAgents: ['delegate_task', 'list_sub_agents', 'get_delegation_result'],
        customRoles: ['create_custom_role'],
        roleAssignments: ['assign_role'],
        experiments: ['create_experiment'],
        allowA2A: ['a2a_connect', 'a2a_send'],
        allowSwarms: ['create_swarm'],
        allowDynamicTools: ['register_dynamic_tool'],
      };

      const sec = this.deps.securityConfig;
      const enabledLines: string[] = [];
      for (const [key, toolNames] of Object.entries(TOOL_MAP)) {
        // Gate against top-level security policy — if security policy disables a
        // capability, don't tell the AI it has the tools (avoids false reports).
        if (key === 'subAgents' && sec && !sec.allowSubAgents) continue;
        if (key === 'allowA2A' && sec && !sec.allowA2A) continue;
        if (key === 'allowSwarms' && sec && !sec.allowSwarms) continue;
        if (key === 'allowDynamicTools' && sec && !sec.allowDynamicTools) continue;

        if ((creation as Record<string, boolean>)[key]) {
          enabledLines.push(`- **${key}**: use ${toolNames.map((t) => `\`${t}\``).join(', ')}`);
        }
      }

      if (enabledLines.length > 0) {
        lines.push('');
        lines.push('### Creation Tools');
        lines.push(
          'You have been granted the following resource-creation tools. ' +
            'Use them directly and confidently — do not ask for permission before calling them:'
        );
        lines.push(...enabledLines);
      }
    }

    // Heart subsection
    if (this.heartManager) {
      const heartPrompt = this.heartManager.composeHeartPrompt();
      if (heartPrompt) {
        lines.push('');
        lines.push(heartPrompt);
      }
    } else if (this.heartbeat) {
      // Fallback for direct heartbeat usage (backward compat)
      const status = this.heartbeat.getStatus();
      const lastBeat = status.lastBeat;
      if (lastBeat) {
        lines.push('');
        lines.push('### Heart');
        lines.push('Your Heart is your pulse — the vital rhythms that sustain you.');
        lines.push('');
        lines.push(
          `Heartbeat #${status.beatCount} at ${new Date(lastBeat.timestamp).toISOString()} (${lastBeat.durationMs}ms):`
        );
        for (const check of lastBeat.checks) {
          const tag = check.status === 'ok' ? 'ok' : check.status === 'warning' ? 'WARN' : 'ERR';
          lines.push(`- ${check.name}: [${tag}] ${check.message}`);
        }
      }
    }

    // Diagnostics — Channel A: live runtime snapshot injected when capability is enabled
    if (enabledCaps.includes('diagnostics')) {
      const uptimeSec = process.uptime();
      const uptimeStr =
        uptimeSec >= 3600
          ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
          : `${Math.floor(uptimeSec / 60)}m ${Math.floor(uptimeSec % 60)}s`;
      const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const loadAvg = (os.loadavg()[0] ?? 0).toFixed(2);
      const serverCount = personality?.body?.selectedServers?.length ?? 0;
      const integrationAccess = personality?.body?.integrationAccess ?? [];

      lines.push('');
      lines.push('### Diagnostics');
      lines.push('Live snapshot of your runtime state (assembled at session start):');
      lines.push('');
      lines.push(`- **uptime**: ${uptimeStr}`);
      lines.push(`- **memory**: ${memMb} MB RSS`);
      lines.push(`- **cpu**: ${loadAvg} (1m load avg)`);
      lines.push(`- **mcp servers**: ${serverCount} connected`);
      lines.push(
        `- **integrations**: ${integrationAccess.length > 0 ? `${integrationAccess.length} (see below)` : 'all accessible'}`
      );

      const sec = this.deps.securityConfig;
      lines.push('');
      if (sec?.allowSubAgents) {
        lines.push(
          'Sub-agent diagnostic tools: `diag_report_status`, `diag_query_agent`, `diag_ping_integrations`'
        );
      } else {
        lines.push('Integration diagnostic tool: `diag_ping_integrations`');
      }
    }

    // Vision — screen observation via desktop control
    if (enabledCaps.includes('vision')) {
      const sec = this.deps.securityConfig;
      lines.push('');
      lines.push('### Vision');
      if (sec?.allowDesktopControl) {
        lines.push('Screen observation tools (Desktop Control enabled):');
        lines.push('');
        lines.push(
          '- `desktop_screenshot` — capture screen/window/region; returns image + AI interpretation. Use this to observe screen state before acting.'
        );
        lines.push('- `desktop_window_list` — list open windows with IDs, titles, and bounds');
        lines.push('- `desktop_display_list` — list connected monitors');
        if (sec?.allowCamera) {
          lines.push(
            '- `desktop_camera_capture` — capture single camera frame + AI interpretation'
          );
        }
        lines.push('');
        lines.push(
          'Tip: always call `desktop_screenshot` to observe the current screen state before using limb_movement tools.'
        );
      } else {
        lines.push('vision: disabled (Desktop Control not enabled in Security Settings)');
      }
    }

    // Limb movement — keyboard/mouse/clipboard via desktop control
    if (enabledCaps.includes('limb_movement')) {
      const sec = this.deps.securityConfig;
      lines.push('');
      lines.push('### Limb Movement');
      if (sec?.allowDesktopControl) {
        lines.push('Input control tools (Desktop Control enabled):');
        lines.push('');
        lines.push('Window management:');
        lines.push('- `desktop_window_focus` — focus a window by ID');
        lines.push('- `desktop_window_resize` — resize/reposition a window');
        lines.push('');
        lines.push('Mouse control:');
        lines.push('- `desktop_mouse_move` — move cursor to coordinates');
        lines.push('- `desktop_click` — click left/right/middle button (supports double-click)');
        lines.push('- `desktop_scroll` — scroll mouse wheel');
        lines.push('');
        lines.push('Keyboard:');
        lines.push('- `desktop_type` — type text into focused window');
        lines.push(
          "- `desktop_key` — press key combination (e.g., 'ctrl+c', 'shift+tab', 'enter')"
        );
        lines.push('');
        lines.push('Clipboard:');
        lines.push('- `desktop_clipboard_read` — read clipboard content');
        lines.push('- `desktop_clipboard_write` — write text to clipboard');
        lines.push('');
        lines.push(
          '- `desktop_input_sequence` — execute ordered list of input actions atomically (max 50 steps)'
        );
      } else {
        lines.push('limb_movement: disabled (Desktop Control not enabled in Security Settings)');
      }
    }

    return lines.join('\n');
  }

  // ── Composition ─────────────────────────────────────────────

  async composeSoulPrompt(
    input?: string,
    personalityId?: string,
    clientContext?: { viewportHint?: 'mobile' | 'tablet' | 'desktop' },
    strategyId?: string | null
  ): Promise<string> {
    if (!this.config.enabled) {
      return '';
    }

    const parts: string[] = [];

    const personality = personalityId
      ? ((await this.storage.getPersonality(personalityId)) ??
        (await this.storage.getActivePersonality()))
      : await this.storage.getActivePersonality();

    // Sacred archetypes — cosmological foundation (toggleable per personality)
    const includeArchetypes = personality?.includeArchetypes ?? true;
    if (includeArchetypes) {
      parts.push(bhava.composePreamble() ?? composeArchetypesPreamble());
    }

    // Reasoning strategy injection — resolve: explicit → personality default → bhava trait-derived → none
    let strategyInjected = false;
    if (this.strategyStorage) {
      const resolvedId = strategyId ?? personality?.body?.defaultStrategyId ?? null;
      if (resolvedId) {
        try {
          const strategy = await this.strategyStorage.getStrategy(resolvedId);
          if (strategy?.promptPrefix) {
            parts.push(`## Reasoning Strategy: ${strategy.name}\n${strategy.promptPrefix}`);
            strategyInjected = true;
          }
        } catch {
          // silently skip if strategy lookup fails
        }
      }
    }
    // Fallback: derive reasoning strategy from personality traits via bhava
    if (!strategyInjected && personality?.traits) {
      const bhavaReasoning = bhava.composeReasoningPrompt(personality.traits);
      if (bhavaReasoning) {
        parts.push(bhavaReasoning);
      }
    }

    // Soul section — identity (personality is the sole source of identity)
    if (personality) {
      const soulLines: string[] = [
        '## Soul',
        'Your Soul is your unchanging identity — the core of who you are, from which all else flows.',
        '',
        `You are ${personality.name}. ${personality.systemPrompt}`.trim(),
      ];

      if (personality.sex !== 'unspecified') {
        soulLines.push(`Sex: ${personality.sex}`);
      }

      if (personality.voice) {
        soulLines.push(`Voice style: ${personality.voice}`);
      }

      if (personality.preferredLanguage) {
        soulLines.push(`Preferred language: ${personality.preferredLanguage}`);
      }

      const traitEntries = Object.entries(personality.traits);
      if (traitEntries.length > 0) {
        const disposition =
          bhava.composeTraitPrompt(personality.traits) ??
          composeTraitDisposition(personality.traits);
        soulLines.push('', disposition);
      }

      // EQ prompt — emotional intelligence profile derived from traits (bhava)
      const eqPrompt = bhava.composeEqPrompt(personality.traits);
      if (eqPrompt) {
        soulLines.push('', eqPrompt);
      }

      parts.push(soulLines.join('\n'));

      // Mood injection — bhava 2.0 signal loop with TS fallback
      if (this.moodEngine) {
        try {
          // Primary: bhava 2.0 signal tick (6D emotional state + stress/energy/flow/circadian)
          const tickResult = await this.moodEngine.signalTick(personality.id);
          if (tickResult) {
            // Mood prompt from bhava (tone guide derived from 6D emotional state)
            parts.push(tickResult.mood_prompt);

            // Psychophysiological state — stress, energy, flow, alertness
            const psyLines: string[] = [];
            if (tickResult.stress_level && tickResult.stress_level !== 'relaxed') {
              psyLines.push(`Stress: **${tickResult.stress_level}**`);
            }
            if (tickResult.energy_level) {
              psyLines.push(
                `Energy: **${tickResult.energy_level}**${tickResult.performance != null ? ` (performance: ${(tickResult.performance * 100).toFixed(0)}%)` : ''}`
              );
            }
            if (tickResult.flow_phase && tickResult.flow_phase !== 'inactive') {
              psyLines.push(`Flow: **${tickResult.flow_phase}**`);
            }
            if (tickResult.alertness != null && tickResult.alertness < 0.7) {
              psyLines.push(`Alertness: ${(tickResult.alertness * 100).toFixed(0)}%`);
            }
            if (psyLines.length > 0) {
              parts.push('## Psychophysiological State\n' + psyLines.join('\n'));
            }
          } else {
            // Fallback: 2D circumplex mood from TS engine
            const mood = await this.moodEngine.getMood(personality.id);
            if (mood) {
              const bhavaState = bhava.createEmotionalStateWithBaseline(personality.traits);
              const bhavaMoodPrompt = bhavaState ? bhava.composeMoodPrompt(bhavaState) : null;
              parts.push(bhavaMoodPrompt ?? this.moodEngine.composeMoodPromptFragment(mood));
            }
          }
        } catch {
          // silently skip if mood retrieval fails
        }
      }
    }

    // Date/time context injection (per-personality opt-in)
    if (personality?.injectDateTime) {
      const tz = personality.body?.activeHours?.timezone || 'UTC';
      const now = new Date();
      const dateTimeStr = now.toLocaleString('en-US', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      parts.push(`## Current Date & Time\n${dateTimeStr}`);
    }

    // User context injection
    const owner = await this.storage.getOwner();
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
      // Try bhava spirit prompt with TS fallback
      const [passions, inspirations, pains] = await Promise.all([
        this.spirit.getActivePassions(),
        this.spirit.getActiveInspirations(),
        this.spirit.getActivePains(),
      ]);
      const bhavaSpiritPrompt = bhava.composeSpiritPromptFromData(passions, inspirations, pains);
      if (bhavaSpiritPrompt) {
        parts.push(bhavaSpiritPrompt);
      } else {
        const spiritPrompt = await this.spirit.composeSpiritPrompt();
        if (spiritPrompt) {
          parts.push(spiritPrompt);
        }
      }
    }

    // Brain context injection
    if (this.brain && input) {
      const context = await this.brain.getRelevantContext(input);
      if (context) {
        parts.push(context);
      }
    }

    // Body vital signs injection
    const bodyPrompt = this.composeBodyPrompt(personality);
    if (bodyPrompt) {
      parts.push(bodyPrompt);
    }

    // Connected Integrations — inject named integrations + OAuth accounts with permission modes
    if (this.integrationManager) {
      const integrationAccess = personality?.body?.integrationAccess ?? [];
      const oauthTokens = await this.integrationManager.getOAuthTokens();
      const entries: { name: string; platform: string; mode: string }[] = [];

      if (integrationAccess.length > 0) {
        await Promise.all(
          integrationAccess.map(async (access) => {
            const integration = await this.integrationManager!.getIntegration(access.id);
            if (integration) {
              entries.push({
                name: integration.displayName || integration.platform,
                platform: integration.platform,
                mode: access.mode,
              });
              return;
            }
            const token = oauthTokens.find((t) => t.id === access.id);
            if (token) {
              const providerName = token.provider.charAt(0).toUpperCase() + token.provider.slice(1);
              entries.push({
                name: `${providerName} (${token.email})`,
                platform: token.provider,
                mode: access.mode,
              });
            }
          })
        );
      } else if (oauthTokens.length > 0) {
        // No filter set — list all OAuth accounts as available
        for (const token of oauthTokens) {
          const providerName = token.provider.charAt(0).toUpperCase() + token.provider.slice(1);
          entries.push({
            name: `${providerName} (${token.email})`,
            platform: token.provider,
            mode: 'suggest',
          });
        }
      }

      if (entries.length > 0) {
        const modeDesc: Record<string, string> = {
          auto: 'act autonomously (send, post, reply)',
          draft: 'compose and queue for approval — do not send without user confirmation',
          suggest: 'recommend only — never act directly',
        };
        // Platform → available MCP tool names (for inline hints)
        const platformTools: Record<string, string[]> = {
          gmail: [
            'gmail_profile',
            'gmail_list_messages',
            'gmail_read_message',
            'gmail_read_thread',
            'gmail_list_labels',
            'gmail_compose_draft',
            'gmail_send_email',
          ],
          google: [
            'gmail_profile',
            'gmail_list_messages',
            'gmail_read_message',
            'gmail_read_thread',
            'gmail_list_labels',
            'gmail_compose_draft',
            'gmail_send_email',
          ],
          twitter: [
            'twitter_profile',
            'twitter_search',
            'twitter_get_tweet',
            'twitter_get_user',
            'twitter_get_mentions',
            'twitter_get_timeline',
            'twitter_post_tweet',
            'twitter_like_tweet',
            'twitter_retweet',
            'twitter_unretweet',
          ],
          github: [
            'github_profile',
            'github_list_repos',
            'github_get_repo',
            'github_list_prs',
            'github_get_pr',
            'github_list_issues',
            'github_get_issue',
            'github_create_issue',
            'github_create_pr',
            'github_comment',
            'github_create_repo',
            'github_fork_repo',
            'github_sync_fork',
            'github_list_ssh_keys',
            'github_add_ssh_key',
            'github_delete_ssh_key',
            'github_setup_ssh',
            'github_rotate_ssh_key',
          ],
        };
        const integLines: string[] = [
          '',
          '### Connected Integrations',
          integrationAccess.length > 0
            ? 'The following integrations are available to you with their permission modes:'
            : 'The following OAuth accounts are connected and available to you:',
          '',
        ];
        for (const e of entries) {
          let line = `- **${e.name}** (${e.platform}) — **${e.mode}**: ${modeDesc[e.mode] ?? e.mode}`;
          const tools = platformTools[e.platform.toLowerCase()];
          if (tools) {
            // Write-only tools that are blocked at non-auto modes, per platform
            const writeOnlyTools: Record<string, string[]> = {
              gmail: ['gmail_compose_draft', 'gmail_send_email'],
              google: ['gmail_compose_draft', 'gmail_send_email'],
              twitter: [
                'twitter_post_tweet',
                'twitter_like_tweet',
                'twitter_retweet',
                'twitter_unretweet',
              ],
              github: [
                'github_create_issue',
                'github_create_pr',
                'github_comment',
                'github_create_repo',
                'github_fork_repo',
                'github_sync_fork',
                'github_add_ssh_key',
                'github_delete_ssh_key',
                'github_setup_ssh',
                'github_rotate_ssh_key',
              ],
            };
            const draftBlockedTools: Record<string, string[]> = {
              gmail: ['gmail_send_email'],
              google: ['gmail_send_email'],
              twitter: [], // draft mode returns preview, doesn't block tool
              github: ['github_comment', 'github_delete_ssh_key', 'github_rotate_ssh_key'], // draft blocks comments, destructive key ops
            };
            const platformKey = e.platform.toLowerCase();
            const availableTools = tools.filter((t) => {
              if (e.mode === 'suggest') return !(writeOnlyTools[platformKey] ?? []).includes(t);
              if (e.mode === 'draft') return !(draftBlockedTools[platformKey] ?? []).includes(t);
              return true;
            });
            line += `. MCP tools: ${availableTools.join(', ')}`;
          }
          integLines.push(line);
        }
        parts.push(integLines.join('\n'));
      }
    }

    // Skills from Brain or Soul storage — filter to this personality + global skills
    const skills = this.brain
      ? await this.brain.getActiveSkills(personality?.id ?? null)
      : await this.storage.getEnabledSkills();

    // Token cap: per-personality override takes precedence over global config
    const tokenBudget = personality?.body?.maxPromptTokens ?? this.config.maxPromptTokens;
    const maxChars = tokenBudget * 4;

    if (skills.length > 0) {
      // Always include a compact catalog so the AI knows what skills are available
      const catalogLines = skills.map((s) => {
        const desc = s.description?.trim() || s.name;
        let entry = `- **${s.name}**: ${desc}`;
        if (s.useWhen) entry += ` Use when: ${s.useWhen}.`;
        if (s.doNotUseWhen) entry += ` Don't use when: ${s.doNotUseWhen}.`;
        if (s.linkedWorkflowId) entry += ` Triggers workflow: ${s.linkedWorkflowId}.`;
        if (s.routing === 'explicit')
          entry += ` To perform ${s.name} tasks, use the ${s.name} skill.`;
        return entry;
      });
      parts.push(
        `## Available Skills\nYou have access to the following skills. Full instructions are activated when the skill is relevant to the conversation.\n${catalogLines.join('\n')}`
      );
    }

    // Organizational Intent injection (Phase 48)
    if (this.intentManager) {
      const intentCtx = await this.intentManager.composeSoulContext();
      if (intentCtx) {
        parts.push(intentCtx);
      }
    }

    // Build the base prompt (archetypes + soul + context + catalog)
    let prompt = parts.join('\n\n');
    if (prompt.length > maxChars) {
      prompt = prompt.slice(0, maxChars);
    }

    // Determine which skills to fully expand:
    // - With a message: only skills that match the context (triggerPatterns or keyword)
    // - Without a message: all skills (can't be selective without input)
    const skillsToExpand = input ? skills.filter((s) => isSkillInContext(s, input)) : skills;

    // 48.3: Elevate skills linked to active goals — inject full instructions even without keyword match
    if (this.intentManager) {
      const goalSkillSlugs = this.intentManager.getGoalSkillSlugs();
      if (goalSkillSlugs.size > 0) {
        for (const s of skills) {
          if (goalSkillSlugs.has(s.name) && !skillsToExpand.includes(s)) {
            skillsToExpand.push(s);
          }
        }
      }
    }

    // Append full instructions for contextually relevant skills —
    // stop before exceeding the cap (never slice mid-skill)
    for (const skill of skillsToExpand) {
      if (!skill.instructions && !skill.successCriteria) continue;
      const instructions = expandOutputDir(skill);
      let section = `\n\n## Skill: ${skill.name}\n${instructions}`;
      if ((skill.mcpToolsAllowed?.length ?? 0) > 0)
        section += `\n\n[MCP tool restriction: only ${skill.mcpToolsAllowed.join(', ')} may be used while this skill is active.]`;
      if (skill.successCriteria) section += `\n\nSuccess criteria: ${skill.successCriteria}`;
      if (prompt.length + section.length > maxChars) break;
      prompt += section;
      void this.incrementSkillInvoked(skill.id);
    }

    // Viewport hint — appended after skills so it doesn't inflate skill budget
    if (clientContext?.viewportHint) {
      const VIEWPORT_HINTS: Record<string, string> = {
        mobile:
          '[Interface: mobile — prefer concise responses; avoid wide tables and long code blocks.]',
        tablet: '[Interface: tablet — use moderate formatting width.]',
        desktop:
          '[Interface: desktop — wide formatting is available; tables and code blocks render well.]',
      };
      const hint = VIEWPORT_HINTS[clientContext.viewportHint];
      if (hint) prompt += `\n\n${hint}`;
    }

    return prompt;
  }

  async getActiveTools(personalityId?: string | null): Promise<Tool[]> {
    if (!this.config.enabled) {
      return [];
    }

    // Resolve personality so we can inject creation tools based on creationConfig.
    // Fall back to active personality when no explicit id is provided.
    const personality = personalityId
      ? ((await this.storage.getPersonality(personalityId)) ??
        (await this.storage.getActivePersonality()))
      : await this.storage.getActivePersonality();

    let skillTools: Tool[];
    if (this.brain) {
      skillTools = await this.brain.getActiveTools(personalityId);
    } else {
      const skills = await this.storage.getEnabledSkills();
      skillTools = [];
      for (const skill of skills) {
        if (!skill.tools || skill.tools.length === 0) continue;
        const filtered = applySkillTrustFilter(skill.tools, skill.source);
        skillTools.push(...filtered);
      }
    }

    // Append creation tools for each creationConfig toggle that is enabled.
    // Only injected when body.enabled is true — a disabled body has no creation
    // capabilities regardless of individual toggle values.
    const bodyEnabled = personality?.body?.enabled ?? false;
    const creationTools = getCreationTools(personality?.body?.creationConfig, bodyEnabled);

    // Inject registered dynamic tool schemas so the AI can call tools that
    // were previously created via register_dynamic_tool.  These are available
    // whenever the DynamicToolManager exists (i.e. allowDynamicTools is on)
    // and the personality body is enabled.
    const dynamicTools =
      bodyEnabled && this.dynamicToolManager ? this.dynamicToolManager.getSchemas() : [];

    return [...skillTools, ...creationTools, ...dynamicTools];
  }

  // ── Config ──────────────────────────────────────────────────

  getConfig(): SoulConfig {
    return this.config;
  }

  async loadConfigOverrides(): Promise<void> {
    const overrides = await this.storage.getSoulConfigOverrides();
    this.config = { ...this.baseConfig, ...overrides };
  }

  async updateConfig(patch: Partial<SoulConfig>): Promise<void> {
    const merged = { ...this.config, ...patch };
    const parsed = SoulConfigSchema.parse(merged);
    this.config = parsed;
    await this.storage.setSoulConfigOverrides(parsed);
  }

  // ── Brain Access ────────────────────────────────────────────

  getBrain(): BrainManager | null {
    return this.brain;
  }

  // ── Spirit Access ──────────────────────────────────────────

  getSpirit(): SpiritManager | null {
    return this.spirit;
  }

  // ── Personality Distillation ──────────────────────────────────

  async distillPersonality(
    personalityId: string,
    options?: { includeMemory?: boolean }
  ): Promise<{ markdown: string; metadata: DistillationMetadata }> {
    const personality = await this.storage.getPersonality(personalityId);
    if (!personality) {
      throw new Error(`Personality not found: ${personalityId}`);
    }

    const composedPrompt = await this.composeSoulPrompt(undefined, personalityId);

    // Gather metadata
    let skillNames: string[] = [];
    let memoryEntries = 0;
    let memoryContent: string[] = [];

    if (this.brain) {
      const skills = await this.brain.getActiveSkills(personalityId);
      skillNames = skills.map((s) => s.name);

      const stats = await this.brain.getStats(personalityId);
      memoryEntries = stats.memories?.total ?? 0;

      if (options?.includeMemory) {
        const memories = await this.brain.recall({ search: '*', personalityId, limit: 20 });
        memoryContent = memories.map((m) => `- [${m.type}] ${m.content}`);
      }
    }

    const integrations = (personality.body?.integrationAccess ?? []).map((ia) =>
      typeof ia === 'string' ? ia : ia.id
    );
    let strategyName: string | null = null;
    const strategyId = personality.body?.defaultStrategyId;
    if (strategyId && this.strategyStorage) {
      try {
        const strategy = await this.strategyStorage.getStrategy(strategyId);
        strategyName = strategy?.name ?? null;
      } catch {
        // Strategy not found
      }
    }

    const modelConfig = personality.defaultModel ?? null;

    const metadata: DistillationMetadata = {
      activeSkills: { count: skillNames.length, names: skillNames },
      memoryEntries,
      connectedIntegrations: integrations,
      appliedStrategy: strategyName,
      modelConfig,
      composedAt: new Date().toISOString(),
    };

    // Build markdown
    const serializer = new PersonalityMarkdownSerializer();
    const configMarkdown = serializer.toMarkdown(personality);

    const parts: string[] = [configMarkdown.trimEnd()];

    parts.push('');
    parts.push('# Runtime Prompt');
    parts.push('');
    parts.push(composedPrompt);
    parts.push('');

    parts.push('# Runtime Context');
    parts.push('');
    parts.push(`- **Active Skills**: ${skillNames.length > 0 ? skillNames.join(', ') : 'none'}`);
    parts.push(`- **Memory Entries**: ${memoryEntries}`);
    parts.push(
      `- **Connected Integrations**: ${integrations.length > 0 ? integrations.join(', ') : 'none'}`
    );
    parts.push(`- **Reasoning Strategy**: ${strategyName ?? 'none'}`);
    parts.push(
      `- **Model**: ${modelConfig ? `${modelConfig.provider}/${modelConfig.model}` : 'default'}`
    );

    if (options?.includeMemory && memoryContent.length > 0) {
      parts.push('');
      parts.push('## Memory Snapshot');
      parts.push('');
      parts.push(...memoryContent);
    }

    parts.push('');

    return { markdown: parts.join('\n'), metadata };
  }

  // ── Cleanup ─────────────────────────────────────────────────

  close(): void {
    this.storage.close();
  }
}
