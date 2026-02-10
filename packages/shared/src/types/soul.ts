/**
 * Soul Types for FRIDAY
 *
 * Personality and Skills system that composes into AI system prompts.
 * Personalities define character traits; Skills define learnable capabilities.
 */

import { z } from 'zod';
import { ToolSchema } from './ai.js';

// ─── Personality ──────────────────────────────────────────────

export const PersonalitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).default(''),
  systemPrompt: z.string().max(8000).default(''),
  traits: z.record(z.string(), z.string()).default({}),
  sex: z.enum(['male', 'female', 'non-binary', 'unspecified']).default('unspecified'),
  voice: z.string().max(200).default(''),
  preferredLanguage: z.string().max(100).default(''),
  isActive: z.boolean().default(false),
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

// ─── Skill ────────────────────────────────────────────────────

export const SkillSourceSchema = z.enum(['user', 'ai_proposed', 'ai_learned']);
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

export const SoulConfigSchema = z.object({
  enabled: z.boolean().default(true),
  learningMode: z.array(LearningModeSchema).default(['user_authored']),
  maxSkills: z.number().int().positive().max(200).default(50),
  maxPromptTokens: z.number().int().positive().max(32000).default(4096),
}).default({});

export type SoulConfig = z.infer<typeof SoulConfigSchema>;
