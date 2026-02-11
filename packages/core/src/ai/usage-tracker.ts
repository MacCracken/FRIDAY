/**
 * Usage Tracker
 *
 * In-memory daily/monthly aggregation of token usage and cost per provider.
 * Enforces configurable daily token limits.
 */

import type { TokenUsage, AIProviderName } from '@friday/shared';

export interface UsageRecord {
  provider: AIProviderName;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  timestamp: number;
}

export interface UsageStats {
  tokensUsedToday: number;
  tokensCachedToday: number;
  costUsdToday: number;
  costUsdMonth: number;
  apiCallsTotal: number;
  apiErrorsTotal: number;
  apiLatencyTotalMs: number;
  apiCallCount: number;
  byProvider: Record<string, ProviderStats>;
}

interface ProviderStats {
  tokensUsed: number;
  costUsd: number;
  calls: number;
  errors: number;
}

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function monthKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 7);
}

export class UsageTracker {
  private readonly records: UsageRecord[] = [];
  private readonly maxTokensPerDay: number | undefined;

  // Aggregate counters
  private apiCallsTotal = 0;
  private apiErrorsTotal = 0;
  private apiLatencyTotalMs = 0;

  constructor(maxTokensPerDay?: number) {
    this.maxTokensPerDay = maxTokensPerDay;
  }

  /**
   * Record a completed AI call.
   */
  record(record: UsageRecord): void {
    this.records.push(record);
    this.apiCallsTotal++;
  }

  /**
   * Record an API call latency.
   */
  recordLatency(ms: number): void {
    this.apiLatencyTotalMs += ms;
  }

  /**
   * Record an API error.
   */
  recordError(): void {
    this.apiErrorsTotal++;
    this.apiCallsTotal++;
  }

  /**
   * Check whether the daily token limit has been exceeded.
   * Returns { allowed: true } if no limit is set or not exceeded.
   */
  checkLimit(): { allowed: boolean; tokensUsedToday: number; limitPerDay?: number } {
    if (this.maxTokensPerDay === undefined) {
      return { allowed: true, tokensUsedToday: this.getTokensToday() };
    }

    const used = this.getTokensToday();
    return {
      allowed: used < this.maxTokensPerDay,
      tokensUsedToday: used,
      limitPerDay: this.maxTokensPerDay,
    };
  }

  /**
   * Get aggregated usage statistics.
   */
  getStats(): UsageStats {
    const now = Date.now();
    const today = dayKey(now);
    const thisMonth = monthKey(now);

    let tokensUsedToday = 0;
    let tokensCachedToday = 0;
    let costUsdToday = 0;
    let costUsdMonth = 0;
    const byProvider: Record<string, ProviderStats> = {};

    for (const r of this.records) {
      const rDay = dayKey(r.timestamp);
      const rMonth = monthKey(r.timestamp);

      // Per-provider aggregation
      if (!byProvider[r.provider]) {
        byProvider[r.provider] = { tokensUsed: 0, costUsd: 0, calls: 0, errors: 0 };
      }
      const providerStats = byProvider[r.provider]!;
      providerStats.tokensUsed += r.usage.totalTokens;
      providerStats.costUsd += r.costUsd;
      providerStats.calls++;

      if (rDay === today) {
        tokensUsedToday += r.usage.totalTokens;
        tokensCachedToday += r.usage.cachedTokens;
        costUsdToday += r.costUsd;
      }

      if (rMonth === thisMonth) {
        costUsdMonth += r.costUsd;
      }
    }

    return {
      tokensUsedToday,
      tokensCachedToday,
      costUsdToday,
      costUsdMonth,
      apiCallsTotal: this.apiCallsTotal,
      apiErrorsTotal: this.apiErrorsTotal,
      apiLatencyTotalMs: this.apiLatencyTotalMs,
      apiCallCount: this.apiCallsTotal - this.apiErrorsTotal,
      byProvider,
    };
  }

  private getTokensToday(): number {
    const today = dayKey(Date.now());
    let total = 0;
    for (const r of this.records) {
      if (dayKey(r.timestamp) === today) {
        total += r.usage.totalTokens;
      }
    }
    return total;
  }
}
