/**
 * HistoryCompressor — 3-tier progressive history compression.
 *
 * Manages message → topic → bulk compression with configurable budgets.
 * - Messages (50%): Raw recent messages
 * - Topics (30%): AI-summarized topic segments
 * - Bulk (20%): AI-merged topic summaries
 */

import type { CompressionStorage } from './storage.js';
import type { HistoryEntry, CompressedContext, HistoryCompressorConfig } from './types.js';
import { isTopicBoundary, type TopicBoundaryConfig } from './topic-detector.js';
import { countTokens } from './token-counter.js';
import { summarizeTopic, summarizeBulk, type SummarizerDeps } from './summarizer.js';
import type { SecureLogger } from '../../logging/logger.js';

export interface HistoryCompressorDeps {
  storage: CompressionStorage;
  summarizer?: SummarizerDeps;
  logger: SecureLogger;
}

export class HistoryCompressor {
  private readonly storage: CompressionStorage;
  private readonly config: HistoryCompressorConfig;
  private readonly summarizer?: SummarizerDeps;
  private readonly logger: SecureLogger;
  private lastTimestamps = new Map<string, number>();
  private currentTopicTokens = new Map<string, number>();

  constructor(config: HistoryCompressorConfig, deps: HistoryCompressorDeps) {
    this.config = config;
    this.storage = deps.storage;
    this.summarizer = deps.summarizer;
    this.logger = deps.logger;
  }

  /**
   * Add a message to the compression system.
   * Detects topic boundaries and triggers compression when needed.
   */
  async addMessage(
    conversationId: string,
    message: { role: string; content: string; timestamp?: number }
  ): Promise<void> {
    const timestamp = message.timestamp ?? Date.now();
    const tokenCount = countTokens(message.content);
    const content = `${message.role}: ${message.content}`;

    // Check for topic boundary
    const prevTimestamp = this.lastTimestamps.get(conversationId);
    const topicTokens = this.currentTopicTokens.get(conversationId) ?? 0;

    const boundaryResult = isTopicBoundary(
      {
        content: message.content,
        timestamp,
        previousTimestamp: prevTimestamp,
        currentTopicTokens: topicTokens,
      },
      this.config.topicBoundary
    );

    if (boundaryResult.isBoundary) {
      await this.compressCurrentTopic(conversationId);
    }

    // Store the message
    const sequence = await this.storage.getNextSequence(conversationId, 'message');
    await this.storage.createEntry({
      conversationId,
      tier: 'message',
      content,
      tokenCount,
      sequence,
    });

    // Update tracking
    this.lastTimestamps.set(conversationId, timestamp);
    this.currentTopicTokens.set(
      conversationId,
      (boundaryResult.isBoundary ? 0 : topicTokens) + tokenCount
    );

    // Check if we need to escalate
    await this.compressIfNeeded(conversationId);
  }

  /**
   * Get compressed context for a conversation within a token budget.
   */
  async getContext(conversationId: string, maxTokens: number): Promise<CompressedContext> {
    const messageBudget = Math.floor((maxTokens * this.config.tiers.messagePct) / 100);
    const topicBudget = Math.floor((maxTokens * this.config.tiers.topicPct) / 100);
    const bulkBudget = Math.floor((maxTokens * this.config.tiers.bulkPct) / 100);

    const allEntries = await this.storage.getEntriesByConversation(conversationId);

    const messages = this.fitToBudget(
      allEntries.filter((e) => e.tier === 'message'),
      messageBudget
    );

    const topics = this.fitToBudget(
      allEntries.filter((e) => e.tier === 'topic'),
      topicBudget
    );

    const bulk = this.fitToBudget(
      allEntries.filter((e) => e.tier === 'bulk'),
      bulkBudget
    );

    return {
      messages,
      topics,
      bulk,
      totalTokens: [...messages, ...topics, ...bulk].reduce((sum, e) => sum + e.tokenCount, 0),
      tokenBudget: {
        messages: messageBudget,
        topics: topicBudget,
        bulk: bulkBudget,
      },
    };
  }

  /**
   * Manually seal the current topic for a conversation.
   */
  async sealCurrentTopic(conversationId: string): Promise<void> {
    await this.compressCurrentTopic(conversationId);
    this.currentTopicTokens.set(conversationId, 0);
  }

  /**
   * Get all history entries for a conversation.
   */
  async getHistory(conversationId: string): Promise<HistoryEntry[]> {
    return this.storage.getEntriesByConversation(conversationId);
  }

  // ── Private Methods ──────────────────────────────────────────

  private fitToBudget(entries: HistoryEntry[], budget: number): HistoryEntry[] {
    // Take most recent entries that fit within budget
    const result: HistoryEntry[] = [];
    let tokens = 0;

    // Iterate from newest to oldest
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!;
      if (tokens + entry.tokenCount > budget) break;
      result.unshift(entry);
      tokens += entry.tokenCount;
    }

    return result;
  }

  private async compressIfNeeded(conversationId: string): Promise<void> {
    const tokenCounts = await this.storage.getTokenCountByTier(conversationId);

    // Escalate messages to topics if message tier exceeds budget
    if (tokenCounts.message > this.config.maxMessageChars / 4) {
      await this.escalateTopics(conversationId);
    }

    // Escalate topics to bulk if topic tier is large
    if (tokenCounts.topic > this.config.topicSummaryTokens * this.config.bulkMergeSize) {
      await this.escalateBulk(conversationId);
    }
  }

  private async compressCurrentTopic(conversationId: string): Promise<void> {
    if (!this.summarizer) return;

    // Get unsealed messages
    const messages = await this.storage.getEntriesByConversation(conversationId, 'message');
    const unsealedMessages = messages.filter((m) => !m.sealedAt);

    if (unsealedMessages.length < 2) return;

    try {
      const parsedMessages = unsealedMessages.map((m) => {
        const colonIdx = m.content.indexOf(': ');
        return {
          role: colonIdx > -1 ? m.content.substring(0, colonIdx) : 'unknown',
          content: colonIdx > -1 ? m.content.substring(colonIdx + 2) : m.content,
        };
      });

      const summary = await summarizeTopic(parsedMessages, this.summarizer);
      const tokenCount = countTokens(summary);
      const sequence = await this.storage.getNextSequence(conversationId, 'topic');

      await this.storage.createEntry({
        conversationId,
        tier: 'topic',
        content: summary,
        tokenCount,
        sequence,
      });

      // Seal the processed messages
      for (const msg of unsealedMessages) {
        await this.storage.sealEntry(msg.id);
      }

      this.logger.debug(
        {
          conversationId,
          messages: unsealedMessages.length,
          summaryTokens: tokenCount,
        },
        'Topic compressed'
      );
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Topic compression failed');
    }
  }

  private async escalateTopics(conversationId: string): Promise<void> {
    if (!this.summarizer) return;

    const topics = await this.storage.getEntriesByConversation(conversationId, 'topic');
    const unsealedTopics = topics.filter((t) => !t.sealedAt);

    if (unsealedTopics.length < this.config.bulkMergeSize) return;

    // Take the oldest batch of unsealed topics to merge
    const batch = unsealedTopics.slice(0, this.config.bulkMergeSize);

    try {
      const topicTexts = batch.map((t) => t.content);
      const _summary = await summarizeBulk(topicTexts, this.summarizer);

      // This is a recursive escalation — topics become bulk
      await this.escalateBulk(conversationId);
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Topic escalation failed');
    }
  }

  private async escalateBulk(conversationId: string): Promise<void> {
    if (!this.summarizer) return;

    const topics = await this.storage.getEntriesByConversation(conversationId, 'topic');
    const unsealedTopics = topics.filter((t) => !t.sealedAt);

    if (unsealedTopics.length < this.config.bulkMergeSize) return;

    const batch = unsealedTopics.slice(0, this.config.bulkMergeSize);

    try {
      const topicTexts = batch.map((t) => t.content);
      const summary = await summarizeBulk(topicTexts, this.summarizer);
      const tokenCount = countTokens(summary);
      const sequence = await this.storage.getNextSequence(conversationId, 'bulk');

      await this.storage.createEntry({
        conversationId,
        tier: 'bulk',
        content: summary,
        tokenCount,
        sequence,
      });

      // Seal the processed topics
      for (const topic of batch) {
        await this.storage.sealEntry(topic.id);
      }

      this.logger.debug(
        {
          conversationId,
          topics: batch.length,
          summaryTokens: tokenCount,
        },
        'Bulk summary created'
      );
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Bulk escalation failed');
    }
  }
}
