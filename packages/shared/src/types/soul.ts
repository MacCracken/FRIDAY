/**
 * Soul Types for FRIDAY
 *
 * Personality and Skills system that composes into AI system prompts.
 * Personalities define character traits; Skills define learnable capabilities.
 */

import { z } from 'zod';
import { ToolSchema } from './ai.js';

// ─── Personality ──────────────────────────────────────────────

export const DefaultModelSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
  })
  .nullable()
  .default(null);

export type DefaultModel = z.infer<typeof DefaultModelSchema>;

// ─── Body Config (owns Heart) ───────────────────────────────

export const BodyCapabilitySchema = z.enum(['vision', 'limb_movement', 'auditory', 'haptic']);
export type BodyCapability = z.infer<typeof BodyCapabilitySchema>;

export const CreationConfigSchema = z
  .object({
    skills: z.boolean().default(false),
    tasks: z.boolean().default(false),
    personalities: z.boolean().default(false),
    experiments: z.boolean().default(false),
  })
  .default({});

export type CreationConfig = z.infer<typeof CreationConfigSchema>;

export const BodyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    capabilities: z.array(BodyCapabilitySchema).default([]),
    heartEnabled: z.boolean().default(true),
    creationConfig: CreationConfigSchema.default({}),
  })
  .default({});

export type BodyConfig = z.infer<typeof BodyConfigSchema>;

// ─── Personality ─────────────────────────────────────────────

export const PersonalitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  systemPrompt: z.string().max(8000).default(''),
  traits: z.record(z.string(), z.string()).default({}),
  sex: z.enum(['male', 'female', 'non-binary', 'unspecified']).default('unspecified'),
  voice: z.string().max(200).default(''),
  preferredLanguage: z.string().max(100).default(''),
  defaultModel: DefaultModelSchema,
  includeArchetypes: z.boolean().default(true),
  isActive: z.boolean().default(false),
  body: BodyConfigSchema.default({}),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Personality = z.infer<typeof PersonalitySchema>;

export const PersonalityCreateSchema = PersonalitySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  isActive: true,
});

export type PersonalityCreate = z.infer<typeof PersonalityCreateSchema>;

export const PersonalityUpdateSchema = PersonalityCreateSchema.partial();
export type PersonalityUpdate = z.infer<typeof PersonalityUpdateSchema>;

// ─── Skill Triggers ─────────────────────────────────────────────

export const TriggerTypeSchema = z.enum(['message', 'tool_use', 'event', 'condition']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const MatchModeSchema = z.enum(['exact', 'contains', 'regex', 'startsWith']);
export type MatchMode = z.infer<typeof MatchModeSchema>;

export const MessageTriggerSchema = z.object({
  type: z.literal('message'),
  patterns: z.array(z.string().max(500)).min(1),
  matchMode: MatchModeSchema.default('contains'),
  caseSensitive: z.boolean().default(false),
});

export const ToolUseTriggerSchema = z.object({
  type: z.literal('tool_use'),
  toolNames: z.array(z.string()).min(1),
  before: z.boolean().default(false),
  after: z.boolean().default(true),
});

export const EventTypeSchema = z.enum([
  'session_start',
  'session_end',
  'skill_installed',
  'skill_uninstalled',
  'personality_changed',
  'error_occurred',
  'heartbeat_check',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const EventTriggerSchema = z.object({
  type: z.literal('event'),
  events: z.array(EventTypeSchema).min(1),
});

export const ConditionOperatorSchema = z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'between']);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const ConditionTriggerSchema = z.object({
  type: z.literal('condition'),
  conditions: z
    .array(
      z.object({
        field: z.string(),
        operator: ConditionOperatorSchema,
        value: z.unknown(),
      })
    )
    .min(1),
  logical: z.enum(['AND', 'OR']).default('AND'),
});

export const SkillTriggerSchema = z.object({
  id: z.string().min(1),
  type: TriggerTypeSchema,
  message: MessageTriggerSchema.optional(),
  toolUse: ToolUseTriggerSchema.optional(),
  event: EventTriggerSchema.optional(),
  condition: ConditionTriggerSchema.optional(),
  timing: z.enum(['before', 'after', 'instead']).default('after'),
  actionId: z.string().optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  cooldownMs: z.number().int().positive().default(0),
  contextTemplate: z.string().max(2000).optional(),
});

export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;
export type MessageTrigger = z.infer<typeof MessageTriggerSchema>;
export type ToolUseTrigger = z.infer<typeof ToolUseTriggerSchema>;
export type EventTrigger = z.infer<typeof EventTriggerSchema>;
export type ConditionTrigger = z.infer<typeof ConditionTriggerSchema>;

// ─── Skill Actions ──────────────────────────────────────────────

export const SkillActionTypeSchema = z.enum(['code', 'http', 'shell']);
export type SkillActionType = z.infer<typeof SkillActionTypeSchema>;

export const CodeActionSchema = z.object({
  type: z.literal('code'),
  language: z.enum(['javascript', 'python']),
  code: z.string().max(10000),
  timeoutMs: z.number().int().positive().max(300000).default(30000),
  memoryLimitMb: z.number().int().positive().default(256),
});

export const HttpActionSchema = z.object({
  type: z.literal('http'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  url: z.string().url().max(2000),
  headers: z.record(z.string()).optional(),
  body: z.string().max(50000).optional(),
  timeoutMs: z.number().int().positive().default(30000),
  retryCount: z.number().int().min(0).max(3).default(0),
});

export const ShellActionSchema = z.object({
  type: z.literal('shell'),
  command: z.string().max(2000),
  timeoutMs: z.number().int().positive().default(30000),
  cwd: z.string().optional(),
  allowedPaths: z.array(z.string()).optional(),
});

export const SkillActionSchema = z.object({
  id: z.string().min(1),
  type: SkillActionTypeSchema,
  code: CodeActionSchema.optional(),
  http: HttpActionSchema.optional(),
  shell: ShellActionSchema.optional(),
  requireApproval: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(30000),
});

export type SkillAction = z.infer<typeof SkillActionSchema>;
export type CodeAction = z.infer<typeof CodeActionSchema>;
export type HttpAction = z.infer<typeof HttpActionSchema>;
export type ShellAction = z.infer<typeof ShellActionSchema>;

// ─── Skill ────────────────────────────────────────────────────

export const SkillSourceSchema = z.enum(['user', 'ai_proposed', 'ai_learned', 'marketplace']);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const SkillStatusSchema = z.enum(['active', 'pending_approval', 'disabled']);
export type SkillStatus = z.infer<typeof SkillStatusSchema>;

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  instructions: z.string().max(8000).default(''),
  tools: z.array(ToolSchema).default([]),
  triggerPatterns: z.array(z.string().max(500)).default([]),

  // Actions (ADR 021)
  actions: z.array(SkillActionSchema).default([]),

  // Triggers (ADR 022)
  triggers: z.array(SkillTriggerSchema).default([]),

  // Dependencies (ADR 021)
  dependencies: z.array(z.string()).default([]),
  provides: z.array(z.string()).default([]),

  // Security
  requireApproval: z.boolean().default(false),
  allowedPermissions: z.array(z.string()).default([]),

  enabled: z.boolean().default(true),
  source: SkillSourceSchema.default('user'),
  status: SkillStatusSchema.default('active'),
  usageCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Skill = z.infer<typeof SkillSchema>;

export const SkillCreateSchema = SkillSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  usageCount: true,
  lastUsedAt: true,
});

export type SkillCreate = z.infer<typeof SkillCreateSchema>;

export const SkillUpdateSchema = SkillCreateSchema.partial();
export type SkillUpdate = z.infer<typeof SkillUpdateSchema>;

// ─── Soul Config ──────────────────────────────────────────────

export const LearningModeSchema = z.enum(['user_authored', 'ai_proposed', 'autonomous']);
export type LearningMode = z.infer<typeof LearningModeSchema>;

export const SoulConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    learningMode: z.array(LearningModeSchema).default(['user_authored']),
    maxSkills: z.number().int().positive().max(200).default(50),
    maxPromptTokens: z.number().int().positive().max(32000).default(4096),
  })
  .default({});

export type SoulConfig = z.infer<typeof SoulConfigSchema>;

// ─── Brain Config ────────────────────────────────────────────

export const MemoryTypeSchema = z.enum(['episodic', 'semantic', 'procedural', 'preference']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const BrainConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxMemories: z.number().min(100).max(100000).default(10000),
    maxKnowledge: z.number().min(100).max(50000).default(5000),
    memoryRetentionDays: z.number().min(1).max(365).default(90),
    importanceDecayRate: z.number().min(0).max(1).default(0.01),
    contextWindowMemories: z.number().min(0).max(50).default(10),
  })
  .default({});

export type BrainConfig = z.infer<typeof BrainConfigSchema>;

// ─── Spirit Config ──────────────────────────────────────────

export const SpiritConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    maxPassions: z.number().int().positive().max(100).default(20),
    maxInspirations: z.number().int().positive().max(100).default(20),
    maxPains: z.number().int().positive().max(100).default(20),
  })
  .default({});

export type SpiritConfig = z.infer<typeof SpiritConfigSchema>;

// ─── Passion ────────────────────────────────────────────────

export const PassionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  intensity: z.number().min(0).max(1).default(0.5),
  isActive: z.boolean().default(true),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Passion = z.infer<typeof PassionSchema>;

export const PassionCreateSchema = PassionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PassionCreate = z.infer<typeof PassionCreateSchema>;

export const PassionUpdateSchema = PassionCreateSchema.partial();
export type PassionUpdate = z.infer<typeof PassionUpdateSchema>;

// ─── Inspiration ────────────────────────────────────────────

export const InspirationSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  impact: z.number().min(0).max(1).default(0.5),
  isActive: z.boolean().default(true),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Inspiration = z.infer<typeof InspirationSchema>;

export const InspirationCreateSchema = InspirationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InspirationCreate = z.infer<typeof InspirationCreateSchema>;

export const InspirationUpdateSchema = InspirationCreateSchema.partial();
export type InspirationUpdate = z.infer<typeof InspirationUpdateSchema>;

// ─── Pain ───────────────────────────────────────────────────

export const PainSchema = z.object({
  id: z.string().min(1),
  trigger: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  severity: z.number().min(0).max(1).default(0.5),
  isActive: z.boolean().default(true),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Pain = z.infer<typeof PainSchema>;

export const PainCreateSchema = PainSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PainCreate = z.infer<typeof PainCreateSchema>;

export const PainUpdateSchema = PainCreateSchema.partial();
export type PainUpdate = z.infer<typeof PainUpdateSchema>;

// ─── User Profile ──────────────────────────────────────────

export const UserRelationshipSchema = z.enum(['owner', 'collaborator', 'user', 'guest']);
export type UserRelationship = z.infer<typeof UserRelationshipSchema>;

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  nickname: z.string().max(100).default(''),
  relationship: UserRelationshipSchema.default('user'),
  preferences: z.record(z.string(), z.string()).default({}),
  notes: z.string().max(2000).default(''),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UserProfileCreateSchema = UserProfileSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type UserProfileCreate = z.infer<typeof UserProfileCreateSchema>;

export const UserProfileUpdateSchema = UserProfileCreateSchema.partial();
export type UserProfileUpdate = z.infer<typeof UserProfileUpdateSchema>;

// ─── Heartbeat ─────────────────────────────────────────────

export const HeartbeatCheckTypeSchema = z.enum([
  'system_health',
  'memory_status',
  'log_anomalies',
  'integration_health',
  'reflective_task',
  'llm_analysis', // NEW: LLM-driven analysis check
  'custom',
]);
export type HeartbeatCheckType = z.infer<typeof HeartbeatCheckTypeSchema>;

// Action trigger condition
export const HeartbeatActionConditionSchema = z.enum(['always', 'on_warning', 'on_error', 'on_ok']);
export type HeartbeatActionCondition = z.infer<typeof HeartbeatActionConditionSchema>;

// Action types
export const HeartbeatActionTypeSchema = z.enum([
  'webhook',
  'notify',
  'remember',
  'execute',
  'llm_analyze',
]);
export type HeartbeatActionType = z.infer<typeof HeartbeatActionTypeSchema>;

// Webhook action configuration
export const WebhookActionConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).default(30000),
  retryCount: z.number().int().min(0).max(5).default(2),
  retryDelayMs: z.number().int().min(100).max(10000).default(1000),
});
export type WebhookActionConfig = z.infer<typeof WebhookActionConfigSchema>;

// Notification action configuration
export const NotifyActionConfigSchema = z.object({
  channel: z.enum(['email', 'slack', 'telegram', 'discord', 'console']),
  recipients: z.array(z.string()).optional(),
  messageTemplate: z.string().optional(),
});
export type NotifyActionConfig = z.infer<typeof NotifyActionConfigSchema>;

// Remember action configuration
export const RememberActionConfigSchema = z.object({
  importance: z.number().min(0).max(1).default(0.5),
  category: z.string().default('heartbeat_alert'),
  memoryType: z.enum(['episodic', 'semantic']).default('episodic'),
});
export type RememberActionConfig = z.infer<typeof RememberActionConfigSchema>;

// Execute action configuration
export const ExecuteActionConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  captureOutput: z.boolean().default(true),
});
export type ExecuteActionConfig = z.infer<typeof ExecuteActionConfigSchema>;

// LLM analyze action configuration
export const LLMAnalyzeActionConfigSchema = z.object({
  prompt: z.string(),
  model: z.string().optional(), // Defaults to cheapest available
  maxTokens: z.number().int().positive().max(10000).default(500),
  temperature: z.number().min(0).max(2).default(0.3),
  expectedOutput: z.enum(['boolean', 'categorize', 'extract', 'summary']).default('summary'),
});
export type LLMAnalyzeActionConfig = z.infer<typeof LLMAnalyzeActionConfigSchema>;

// Heartbeat action trigger
export const HeartbeatActionTriggerSchema = z.object({
  condition: HeartbeatActionConditionSchema,
  action: HeartbeatActionTypeSchema,
  config: z
    .union([
      WebhookActionConfigSchema,
      NotifyActionConfigSchema,
      RememberActionConfigSchema,
      ExecuteActionConfigSchema,
      LLMAnalyzeActionConfigSchema,
      z.record(z.unknown()),
    ])
    .default({}),
});
export type HeartbeatActionTrigger = z.infer<typeof HeartbeatActionTriggerSchema>;

// Conditional scheduling
export const HeartbeatScheduleSchema = z.object({
  daysOfWeek: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
  activeHours: z
    .object({
      start: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/), // HH:mm format
      end: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
      timezone: z.string().default('UTC'),
    })
    .optional(),
});
export type HeartbeatSchedule = z.infer<typeof HeartbeatScheduleSchema>;

export const HeartbeatCheckSchema = z.object({
  name: z.string().min(1).max(100),
  type: HeartbeatCheckTypeSchema,
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().min(30_000).max(86_400_000).optional(),
  schedule: HeartbeatScheduleSchema.optional(), // NEW: Conditional scheduling
  config: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(HeartbeatActionTriggerSchema).default([]), // NEW: Proactive actions
});

export type HeartbeatCheck = z.infer<typeof HeartbeatCheckSchema>;

export const HeartbeatConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().min(5000).max(3_600_000).default(30_000),
    defaultActions: z.array(HeartbeatActionTriggerSchema).default([]), // NEW: Global default actions
    checks: z.array(HeartbeatCheckSchema).default([
      {
        name: 'system_health',
        type: 'system_health',
        enabled: true,
        intervalMs: 300_000,
        config: {},
        actions: [],
      },
      {
        name: 'memory_status',
        type: 'memory_status',
        enabled: true,
        intervalMs: 600_000,
        config: {},
        actions: [],
      },
      {
        name: 'log_anomalies',
        type: 'log_anomalies',
        enabled: true,
        intervalMs: 300_000,
        config: {},
        actions: [],
      },
      {
        name: 'self_reflection',
        type: 'reflective_task',
        enabled: true,
        intervalMs: 1_800_000,
        config: { prompt: 'how can I help my user and improve myself, securely' },
        actions: [],
      },
    ]),
  })
  .default({});

export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;

// ─── External Brain Sync ───────────────────────────────────

export const ExternalBrainProviderSchema = z.enum(['obsidian', 'git_repo', 'filesystem']);
export type ExternalBrainProvider = z.infer<typeof ExternalBrainProviderSchema>;

export const ExternalBrainConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    provider: ExternalBrainProviderSchema.default('obsidian'),
    /** Absolute path to the vault/repo root directory */
    path: z.string().default(''),
    /** Subdirectory within the vault for FRIDAY notes (e.g. "30 - Resources/FRIDAY") */
    subdir: z.string().default(''),
    /** Auto-sync interval in ms (0 = manual only) */
    syncIntervalMs: z.number().int().min(0).max(86_400_000).default(0),
    /** Which memory types to sync */
    syncMemories: z.boolean().default(true),
    /** Which knowledge entries to sync */
    syncKnowledge: z.boolean().default(true),
    /** Include frontmatter/metadata in exported markdown */
    includeFrontmatter: z.boolean().default(true),
    /** Tag prefix for Obsidian tags (e.g. "friday/" → #friday/memory) */
    tagPrefix: z.string().max(50).default('friday/'),
  })
  .default({});

export type ExternalBrainConfig = z.infer<typeof ExternalBrainConfigSchema>;

// ─── Heart Config ───────────────────────────────────────────

export const HeartConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().min(5000).max(3_600_000).default(30_000),
    checks: z.array(HeartbeatCheckSchema).default([
      {
        name: 'system_health',
        type: 'system_health',
        enabled: true,
        intervalMs: 300_000,
        config: {},
      },
      {
        name: 'memory_status',
        type: 'memory_status',
        enabled: true,
        intervalMs: 600_000,
        config: {},
      },
      {
        name: 'log_anomalies',
        type: 'log_anomalies',
        enabled: true,
        intervalMs: 300_000,
        config: {},
      },
      {
        name: 'self_reflection',
        type: 'reflective_task',
        enabled: true,
        intervalMs: 1_800_000,
        config: { prompt: 'how can I help my user and improve myself, securely' },
      },
    ]),
  })
  .default({});

export type HeartConfig = z.infer<typeof HeartConfigSchema>;

// ─── Comms Config ────────────────────────────────────────────

export const MessageTypeSchema = z.enum([
  'task_request',
  'task_response',
  'knowledge_share',
  'status_update',
  'coordination',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const CommsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    agentName: z.string().default(''),
    listenForPeers: z.boolean().default(true),
    maxPeers: z.number().int().positive().max(100).default(10),
    messageRetentionDays: z.number().int().positive().max(365).default(30),
  })
  .default({});

export type CommsConfig = z.infer<typeof CommsConfigSchema>;
