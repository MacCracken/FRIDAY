/**
 * Soul Module — Internal Types
 *
 * Re-exports shared types and defines internal interfaces.
 */

export type {
  Personality,
  PersonalityCreate,
  PersonalityUpdate,
  Skill,
  SkillCreate,
  SkillUpdate,
  SkillSource,
  SkillStatus,
  LearningMode,
  SoulConfig,
  UserProfile,
  UserProfileCreate,
  UserProfileUpdate,
  UserRelationship,
  HeartbeatConfig,
  HeartbeatCheck,
  HeartbeatCheckType,
  ExternalBrainConfig,
  ExternalBrainProvider,
} from '@friday/shared';

export type { Tool } from '@friday/shared';

import type { AuditChain } from '../logging/audit-chain.js';
import type { SecureLogger } from '../logging/logger.js';
import type { BrainManager } from '../brain/manager.js';

export interface SoulManagerDeps {
  auditChain: AuditChain;
  logger: SecureLogger;
}

export interface SoulManagerWithBrainDeps extends SoulManagerDeps {
  brain?: BrainManager;
}

export interface SkillFilter {
  status?: string;
  source?: string;
  enabled?: boolean;
}
