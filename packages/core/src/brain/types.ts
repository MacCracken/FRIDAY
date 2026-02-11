/**
 * Brain Module — Internal Types
 *
 * Re-exports shared types and defines internal interfaces.
 */

export type {
  Skill,
  SkillCreate,
  SkillUpdate,
  Tool,
} from '@friday/shared';

import type { AuditChain } from '../logging/audit-chain.js';
import type { SecureLogger } from '../logging/logger.js';

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  source: string;
  context: Record<string, string>;
  importance: number;
  accessCount: number;
  lastAccessedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'preference';

export interface MemoryCreate {
  type: MemoryType;
  content: string;
  source: string;
  context?: Record<string, string>;
  importance?: number;
  expiresAt?: number | null;
}

export interface MemoryQuery {
  type?: MemoryType;
  source?: string;
  context?: Record<string, string>;
  minImportance?: number;
  limit?: number;
  search?: string;
}

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  source: string;
  confidence: number;
  supersedes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCreate {
  topic: string;
  content: string;
  source: string;
  confidence?: number;
}

export interface KnowledgeQuery {
  topic?: string;
  search?: string;
  minConfidence?: number;
  limit?: number;
}

export interface SkillFilter {
  status?: string;
  source?: string;
  enabled?: boolean;
}

export interface BrainManagerDeps {
  auditChain: AuditChain;
  logger: SecureLogger;
}

export interface BrainStats {
  memories: {
    total: number;
    byType: Record<string, number>;
  };
  knowledge: {
    total: number;
  };
  skills: {
    total: number;
  };
}
