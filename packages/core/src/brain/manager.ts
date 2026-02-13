/**
 * BrainManager — Memory, knowledge, and skill management for FRIDAY.
 *
 * The Brain is the cognitive infrastructure: memory, knowledge, skills,
 * and learned patterns. The Soul composes the final prompt from Brain
 * knowledge + Soul personality.
 */

import type { BrainStorage } from './storage.js';
import type {
  Memory,
  MemoryType,
  MemoryCreate,
  MemoryQuery,
  KnowledgeEntry,
  KnowledgeQuery,
  SkillFilter,
  BrainManagerDeps,
  BrainStats,
} from './types.js';
import type { AuditQueryOptions, AuditQueryResult } from '../logging/sqlite-storage.js';
import type { Skill, SkillCreate, SkillUpdate, Tool, BrainConfig } from '@friday/shared';

export class BrainManager {
  private readonly storage: BrainStorage;
  private readonly config: BrainConfig;
  private readonly deps: BrainManagerDeps;

  constructor(storage: BrainStorage, config: BrainConfig, deps: BrainManagerDeps) {
    this.storage = storage;
    this.config = config;
    this.deps = deps;
  }

  // ── Memory Operations ──────────────────────────────────────

  remember(type: MemoryType, content: string, source: string, context?: Record<string, string>, importance?: number): Memory {
    if (!this.config.enabled) {
      throw new Error('Brain is not enabled');
    }

    const count = this.storage.getMemoryCount();
    if (count >= this.config.maxMemories) {
      // Prune lowest-importance memory before adding new one
      const lowest = this.storage.queryMemories({ limit: 1, minImportance: 0 });
      const toPrune = lowest[lowest.length - 1];
      if (toPrune) {
        this.storage.deleteMemory(toPrune.id);
      }
    }

    const data: MemoryCreate = {
      type,
      content,
      source,
      context,
      importance,
    };

    // Episodic memories get an expiration based on retention config
    if (type === 'episodic') {
      data.expiresAt = Date.now() + this.config.memoryRetentionDays * 86_400_000;
    }

    return this.storage.createMemory(data);
  }

  recall(query: MemoryQuery): Memory[] {
    if (!this.config.enabled) {
      return [];
    }

    const memories = this.storage.queryMemories(query);

    // Batch-touch accessed memories to keep them alive (single query instead of N)
    if (memories.length > 0) {
      this.storage.touchMemories(memories.map(m => m.id));
    }

    return memories;
  }

  forget(id: string): void {
    this.storage.deleteMemory(id);
  }

  getMemory(id: string): Memory | null {
    return this.storage.getMemory(id);
  }

  // ── Knowledge Operations ───────────────────────────────────

  learn(topic: string, content: string, source: string, confidence?: number): KnowledgeEntry {
    if (!this.config.enabled) {
      throw new Error('Brain is not enabled');
    }

    const count = this.storage.getKnowledgeCount();
    if (count >= this.config.maxKnowledge) {
      throw new Error(`Maximum knowledge limit reached (${this.config.maxKnowledge})`);
    }

    return this.storage.createKnowledge({
      topic,
      content,
      source,
      confidence,
    });
  }

  lookup(topic: string): KnowledgeEntry[] {
    if (!this.config.enabled) {
      return [];
    }
    return this.storage.queryKnowledge({ topic });
  }

  queryKnowledge(query: KnowledgeQuery): KnowledgeEntry[] {
    if (!this.config.enabled) {
      return [];
    }
    return this.storage.queryKnowledge(query);
  }

  updateKnowledge(id: string, data: { content?: string; confidence?: number; supersedes?: string }): KnowledgeEntry {
    return this.storage.updateKnowledge(id, data);
  }

  deleteKnowledge(id: string): void {
    this.storage.deleteKnowledge(id);
  }

  // ── Prompt Integration ─────────────────────────────────────

  getRelevantContext(input: string, limit?: number): string {
    if (!this.config.enabled) {
      return '';
    }

    const maxItems = limit ?? this.config.contextWindowMemories;
    const contentParts: string[] = [];

    // Search memories relevant to the input
    const memories = this.storage.queryMemories({
      search: input,
      limit: Math.ceil(maxItems / 2),
    });

    if (memories.length > 0) {
      // Batch-touch all memories in a single query instead of N individual updates
      this.storage.touchMemories(memories.map(m => m.id));
      const memLines = ['### Memories'];
      for (const memory of memories) {
        memLines.push(`- [${memory.type}] ${memory.content}`);
      }
      contentParts.push(memLines.join('\n'));
    }

    // Search knowledge relevant to the input
    const knowledge = this.storage.queryKnowledge({
      search: input,
      limit: Math.floor(maxItems / 2) || 1,
    });

    if (knowledge.length > 0) {
      const knowLines = ['### Knowledge'];
      for (const entry of knowledge) {
        knowLines.push(`- [${entry.topic}] ${entry.content}`);
      }
      contentParts.push(knowLines.join('\n'));
    }

    if (contentParts.length === 0) {
      return '';
    }

    const header = '## Brain\nYour Brain is your mind — the accumulated memories and learned knowledge that inform your understanding. Draw on what is relevant; let the rest rest.\n';
    return header + '\n' + contentParts.join('\n\n');
  }

  // ── Skill Operations (moved from SoulManager) ──────────────

  createSkill(data: SkillCreate): Skill {
    return this.storage.createSkill(data);
  }

  updateSkill(id: string, data: SkillUpdate): Skill {
    return this.storage.updateSkill(id, data);
  }

  deleteSkill(id: string): void {
    this.storage.deleteSkill(id);
  }

  getSkill(id: string): Skill | null {
    return this.storage.getSkill(id);
  }

  listSkills(filter?: SkillFilter): Skill[] {
    return this.storage.listSkills(filter);
  }

  enableSkill(id: string): void {
    this.storage.updateSkill(id, { enabled: true });
  }

  disableSkill(id: string): void {
    this.storage.updateSkill(id, { enabled: false });
  }

  approveSkill(id: string): Skill {
    const skill = this.storage.getSkill(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    return this.storage.updateSkill(id, { status: 'active' });
  }

  rejectSkill(id: string): void {
    const skill = this.storage.getSkill(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (skill.status !== 'pending_approval') {
      throw new Error(`Skill is not pending approval (status: ${skill.status})`);
    }
    this.storage.deleteSkill(id);
  }

  incrementSkillUsage(skillId: string): void {
    this.storage.incrementUsage(skillId);
  }

  getActiveSkills(): Skill[] {
    if (!this.config.enabled) {
      return [];
    }
    return this.storage.getEnabledSkills();
  }

  getActiveTools(): Tool[] {
    if (!this.config.enabled) {
      return [];
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

  getSkillCount(): number {
    return this.storage.getSkillCount();
  }

  getPendingSkills(): Skill[] {
    return this.storage.getPendingSkills();
  }

  getEnabledSkills(): Skill[] {
    return this.storage.getEnabledSkills();
  }

  // ── Audit Log Bridge ─────────────────────────────────────

  async queryAuditLogs(opts: AuditQueryOptions = {}): Promise<AuditQueryResult> {
    if (!this.deps.auditStorage) {
      throw new Error('Audit storage is not available in BrainManager');
    }
    return this.deps.auditStorage.query(opts);
  }

  async searchAuditLogs(query: string, opts?: { limit?: number; offset?: number }): Promise<AuditQueryResult> {
    if (!this.deps.auditStorage) {
      throw new Error('Audit storage is not available in BrainManager');
    }
    return this.deps.auditStorage.searchFullText(query, opts);
  }

  hasAuditStorage(): boolean {
    return !!this.deps.auditStorage;
  }

  // ── Maintenance ────────────────────────────────────────────

  runMaintenance(): { decayed: number; pruned: number } {
    const decayed = this.storage.decayMemories(this.config.importanceDecayRate);
    const pruned = this.storage.pruneExpiredMemories();

    this.deps.logger.debug('Brain maintenance completed', { decayed, pruned });

    return { decayed, pruned };
  }

  // ── Stats ──────────────────────────────────────────────────

  getStats(): BrainStats {
    return this.storage.getStats();
  }

  // ── Config ─────────────────────────────────────────────────

  getConfig(): BrainConfig {
    return this.config;
  }

  // ── Cleanup ────────────────────────────────────────────────

  close(): void {
    this.storage.close();
  }
}
