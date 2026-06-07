/**
 * DataCurationManager — snapshot conversation datasets for ML pipelines.
 *
 * Scans ConversationStorage with configurable filters (personality IDs,
 * date range, minimum turns, quality thresholds) and writes a JSONL
 * snapshot to disk. Returns a dataset descriptor that the workflow engine
 * passes to downstream training and evaluation steps.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SecureLogger } from '../logging/logger.js';
import type { ConversationStorage } from '../chat/conversation-storage.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CurationConfig {
  /** Filter to specific personality IDs (empty = all). */
  personalityIds?: string[];
  /** Include only conversations whose first message is after this timestamp (ms). */
  fromTs?: number;
  /** Include only conversations whose last message is before this timestamp (ms). */
  toTs?: number;
  /** Minimum number of turns (user+assistant message pairs) to include a conversation. */
  minTurns?: number;
  /** Maximum conversations to include in snapshot. */
  maxConversations?: number;
  /** Directory to write the snapshot JSONL into. */
  outputDir: string;
}

export interface DatasetDescriptor {
  datasetId: string;
  path: string;
  sampleCount: number;
  conversationCount: number;
  filters: Omit<CurationConfig, 'outputDir'>;
  snapshotAt: number;
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class DataCurationManager {
  constructor(
    private readonly conversationStorage: ConversationStorage,
    private readonly logger: SecureLogger
  ) {}

  /**
   * Curate a dataset snapshot and write it to disk as JSONL.
   * Each line is a ShareGPT-format conversation object.
   */
  async curateDataset(config: CurationConfig): Promise<DatasetDescriptor> {
    const datasetId = randomUUID();
    const path = `${config.outputDir}/dataset_${datasetId}.jsonl`;
    mkdirSync(dirname(path), { recursive: true });

    const minTurns = config.minTurns ?? 1;
    const maxConversations = config.maxConversations ?? 5000;

    this.logger.info({ datasetId, config }, 'DataCuration: starting snapshot');

    // Use ConversationStorage.listConversations API.
    // We collect from all requested personalities (or all if none specified).
    const personalityIds = config.personalityIds ?? [];

    // Build an iterable of conversations.
    const conversationBatches: { id: string; personalityId: string | null }[] = [];

    if (personalityIds.length > 0) {
      for (const pid of personalityIds) {
        const { conversations } = await this.conversationStorage.listConversations({
          personalityId: pid,
          limit: maxConversations,
        });
        for (const c of conversations) {
          conversationBatches.push({ id: c.id, personalityId: pid });
        }
      }
    } else {
      const { conversations } = await this.conversationStorage.listConversations({
        limit: maxConversations,
      });
      for (const c of conversations) {
        conversationBatches.push({ id: c.id, personalityId: c.personalityId ?? null });
      }
    }

    let sampleCount = 0;
    let conversationCount = 0;

    // Write empty file first
    writeFileSync(path, '');

    for (const conv of conversationBatches) {
      if (conversationCount >= maxConversations) break;

      const messages = await this.conversationStorage.getMessages(conv.id);
      if (!messages || messages.length === 0) continue;

      // Filter by date range
      if (config.fromTs != null && messages[0] != null) {
        if (messages[0].createdAt < config.fromTs) continue;
      }
      if (config.toTs != null && messages[messages.length - 1] != null) {
        const lastMsg = messages[messages.length - 1]!;
        if (lastMsg.createdAt > config.toTs) continue;
      }

      // Count turns (user+assistant pairs)
      const userMsgs = messages.filter((m) => m.role === 'user');
      if (userMsgs.length < minTurns) continue;

      // Write ShareGPT-format line
      const sample = {
        id: conv.id,
        personality_id: conv.personalityId,
        conversations: messages.map((m) => ({
          from: m.role === 'user' ? 'human' : 'gpt',
          value: m.content,
        })),
      };
      appendFileSync(path, JSON.stringify(sample) + '\n');

      sampleCount += userMsgs.length; // count individual turn pairs
      conversationCount++;
    }

    const descriptor: DatasetDescriptor = {
      datasetId,
      path,
      sampleCount,
      conversationCount,
      filters: {
        personalityIds: config.personalityIds,
        fromTs: config.fromTs,
        toTs: config.toTs,
        minTurns: config.minTurns,
        maxConversations: config.maxConversations,
      },
      snapshotAt: Date.now(),
    };

    this.logger.info(
      {
        datasetId,
        conversationCount,
        sampleCount,
        path,
      },
      'DataCuration: snapshot complete'
    );

    return descriptor;
  }
}
