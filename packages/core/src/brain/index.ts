/**
 * Brain Module — Memory, Knowledge, and Skills for FRIDAY
 */

export { BrainStorage } from './storage.js';
export { BrainManager } from './manager.js';
export { HeartbeatManager, type HeartbeatResult, type HeartbeatCheckResult } from './heartbeat.js';
export { ExternalBrainSync, type SyncResult } from './external-sync.js';

export type {
  Memory,
  MemoryType,
  MemoryCreate,
  MemoryQuery,
  KnowledgeEntry,
  KnowledgeCreate,
  KnowledgeQuery,
  SkillFilter,
  BrainManagerDeps,
  BrainStats,
  AuditStorage,
} from './types.js';
