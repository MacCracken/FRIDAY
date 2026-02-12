/**
 * ExternalBrainSync — Exports Brain memories and knowledge to external
 * storage like Obsidian vaults, git repos, or plain filesystem directories.
 *
 * Each memory/knowledge entry is written as a Markdown file with optional
 * YAML frontmatter. Files are organized by type (memories/, knowledge/)
 * within the configured subdirectory.
 *
 * Supports:
 *   - Obsidian vaults (Markdown + frontmatter + tags)
 *   - Git repos (writes files; git operations are left to the user)
 *   - Plain filesystem directories
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainManager } from './manager.js';
import type { Memory, KnowledgeEntry } from './types.js';
import type { SecureLogger } from '../logging/logger.js';
import type { ExternalBrainConfig } from '@friday/shared';

export interface SyncResult {
  memoriesWritten: number;
  memoriesRemoved: number;
  knowledgeWritten: number;
  knowledgeRemoved: number;
  timestamp: number;
  durationMs: number;
}

export class ExternalBrainSync {
  private readonly brain: BrainManager;
  private readonly config: ExternalBrainConfig;
  private readonly logger: SecureLogger;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSync: SyncResult | null = null;

  constructor(brain: BrainManager, config: ExternalBrainConfig, logger: SecureLogger) {
    this.brain = brain;
    this.config = config;
    this.logger = logger;
  }

  /** Start auto-sync if configured with a positive interval. */
  start(): void {
    if (!this.config.enabled) return;
    if (this.config.syncIntervalMs > 0) {
      this.syncTimer = setInterval(() => {
        void this.sync().catch((err: unknown) => {
          this.logger.error('External brain sync failed', {
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
      }, this.config.syncIntervalMs);
      this.logger.info('External brain sync started', {
        provider: this.config.provider,
        path: this.config.path,
        intervalMs: this.config.syncIntervalMs,
      });
    }
  }

  /** Stop auto-sync timer. */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Run a full sync: export all memories and knowledge to the configured path. */
  async sync(): Promise<SyncResult> {
    const start = Date.now();
    const rootDir = this.config.subdir
      ? join(this.config.path, this.config.subdir)
      : this.config.path;

    const memoriesDir = join(rootDir, 'memories');
    const knowledgeDir = join(rootDir, 'knowledge');

    mkdirSync(memoriesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });

    let memoriesWritten = 0;
    let memoriesRemoved = 0;
    let knowledgeWritten = 0;
    let knowledgeRemoved = 0;

    // Sync memories
    if (this.config.syncMemories) {
      const memories = this.brain.recall({ limit: 10000 });
      const memoryIds = new Set<string>();

      for (const memory of memories) {
        const filename = this.sanitizeFilename(`${memory.id}.md`);
        const filepath = join(memoriesDir, filename);
        const content = this.memoryToMarkdown(memory);
        writeFileSync(filepath, content, 'utf-8');
        memoryIds.add(filename);
        memoriesWritten++;
      }

      // Remove stale files
      memoriesRemoved = this.removeStaleFiles(memoriesDir, memoryIds);
    }

    // Sync knowledge
    if (this.config.syncKnowledge) {
      const knowledge = this.brain.queryKnowledge({ limit: 10000 });
      const knowledgeIds = new Set<string>();

      for (const entry of knowledge) {
        const filename = this.sanitizeFilename(`${entry.id}.md`);
        const filepath = join(knowledgeDir, filename);
        const content = this.knowledgeToMarkdown(entry);
        writeFileSync(filepath, content, 'utf-8');
        knowledgeIds.add(filename);
        knowledgeWritten++;
      }

      // Remove stale files
      knowledgeRemoved = this.removeStaleFiles(knowledgeDir, knowledgeIds);
    }

    const result: SyncResult = {
      memoriesWritten,
      memoriesRemoved,
      knowledgeWritten,
      knowledgeRemoved,
      timestamp: start,
      durationMs: Date.now() - start,
    };

    this.lastSync = result;
    this.logger.info('External brain sync completed', {
      memoriesWritten: result.memoriesWritten,
      memoriesRemoved: result.memoriesRemoved,
      knowledgeWritten: result.knowledgeWritten,
      knowledgeRemoved: result.knowledgeRemoved,
      durationMs: result.durationMs,
    });
    return result;
  }

  /** Get the result of the last sync operation. */
  getLastSync(): SyncResult | null {
    return this.lastSync;
  }

  /** Get current status of the external sync system. */
  getStatus(): { enabled: boolean; provider: string; path: string; autoSync: boolean; lastSync: SyncResult | null } {
    return {
      enabled: this.config.enabled,
      provider: this.config.provider,
      path: this.config.path,
      autoSync: this.config.syncIntervalMs > 0,
      lastSync: this.lastSync,
    };
  }

  /** Convert a Memory to Markdown with optional YAML frontmatter. */
  private memoryToMarkdown(memory: Memory): string {
    const parts: string[] = [];
    const tag = this.config.tagPrefix;

    if (this.config.includeFrontmatter) {
      parts.push('---');
      parts.push(`id: "${memory.id}"`);
      parts.push(`type: ${memory.type}`);
      parts.push(`source: "${memory.source}"`);
      parts.push(`importance: ${memory.importance}`);
      parts.push(`access_count: ${memory.accessCount}`);
      parts.push(`created: ${new Date(memory.createdAt).toISOString()}`);
      parts.push(`updated: ${new Date(memory.updatedAt).toISOString()}`);
      if (memory.expiresAt) {
        parts.push(`expires: ${new Date(memory.expiresAt).toISOString()}`);
      }
      const tags = [`${tag}memory`, `${tag}${memory.type}`];
      if (memory.source) tags.push(`${tag}source/${memory.source}`);
      parts.push(`tags: [${tags.map(t => `"#${t}"`).join(', ')}]`);
      parts.push('---');
      parts.push('');
    }

    parts.push(`# Memory: ${memory.type}`);
    parts.push('');
    parts.push(memory.content);

    if (Object.keys(memory.context).length > 0) {
      parts.push('');
      parts.push('## Context');
      for (const [key, value] of Object.entries(memory.context)) {
        parts.push(`- **${key}**: ${value}`);
      }
    }

    parts.push('');
    return parts.join('\n');
  }

  /** Convert a KnowledgeEntry to Markdown with optional YAML frontmatter. */
  private knowledgeToMarkdown(entry: KnowledgeEntry): string {
    const parts: string[] = [];
    const tag = this.config.tagPrefix;

    if (this.config.includeFrontmatter) {
      parts.push('---');
      parts.push(`id: "${entry.id}"`);
      parts.push(`topic: "${entry.topic}"`);
      parts.push(`source: "${entry.source}"`);
      parts.push(`confidence: ${entry.confidence}`);
      parts.push(`created: ${new Date(entry.createdAt).toISOString()}`);
      parts.push(`updated: ${new Date(entry.updatedAt).toISOString()}`);
      if (entry.supersedes) {
        parts.push(`supersedes: "${entry.supersedes}"`);
      }
      const tags = [`${tag}knowledge`, `${tag}topic/${entry.topic.replace(/\s+/g, '-').toLowerCase()}`];
      parts.push(`tags: [${tags.map(t => `"#${t}"`).join(', ')}]`);
      parts.push('---');
      parts.push('');
    }

    parts.push(`# ${entry.topic}`);
    parts.push('');
    parts.push(entry.content);
    parts.push('');
    return parts.join('\n');
  }

  /** Remove files from a directory that are no longer in the active set. */
  private removeStaleFiles(dir: string, activeFiles: Set<string>): number {
    let removed = 0;
    if (!existsSync(dir)) return removed;

    const files = readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.md') && !activeFiles.has(file)) {
        unlinkSync(join(dir, file));
        removed++;
      }
    }
    return removed;
  }

  /** Sanitize a string for use as a filename. */
  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }
}
