/**
 * Request Fingerprinting — Bot detection via header ordering, behavioral
 * heuristics, and request timing analysis.
 *
 * Scores each incoming request with a 0-100 bot score based on:
 *   - Header fingerprint (ordered header names hash)
 *   - Missing browser headers (accept-language, accept-encoding, accept)
 *   - Suspicious or missing user-agent
 *   - Metronomic request timing (< 50ms interval variance)
 *
 * Does NOT block requests — scores feed into the IP reputation system
 * which handles blocking decisions.
 */

import { createHash } from 'node:crypto';
import type { RequestFingerprintConfig } from '@secureyeoman/shared';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { IpReputationManager } from './ip-reputation.js';
import { getLogger, createNoopLogger, type SecureLogger } from '../logging/logger.js';
import { PeriodicCleanup } from './periodic-cleanup.js';

export interface FingerprintRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  url: string;
}

export interface FingerprintResult {
  headerHash: string;
  botScore: number;
  classification: 'human' | 'suspicious' | 'bot';
  signals: string[];
}

interface IpTimingState {
  timestamps: number[];
  lastActivity: number;
}

const BOT_UA_PATTERNS = ['python-requests', 'curl', 'wget', 'go-http-client', 'java'];

/** Maximum number of timestamps to keep per IP. */
const MAX_TIMESTAMPS = 10;

/** Evict timing state after 60s of inactivity. */
const TIMING_EVICTION_MS = 60_000;

export class RequestFingerprinter {
  private readonly config: RequestFingerprintConfig;
  private readonly reputationManager: IpReputationManager | undefined;
  private readonly timingState = new Map<string, IpTimingState>();
  /** Cache header-name strings → SHA256 hash to avoid recomputing per request. */
  private readonly headerHashCache = new Map<string, string>();
  private static readonly MAX_HASH_CACHE = 2000;
  private logger: SecureLogger;
  private readonly cleanupTimer = new PeriodicCleanup();

  // Stats
  private totalFingerprinted = 0;
  private botsDetected = 0;
  private suspiciousDetected = 0;

  constructor(config: RequestFingerprintConfig, reputationManager?: IpReputationManager) {
    this.config = config;
    this.reputationManager = reputationManager;
    try {
      this.logger = getLogger().child({ component: 'RequestFingerprinter' });
    } catch {
      this.logger = createNoopLogger();
    }

    // Periodic cleanup of stale timing entries
    this.cleanupTimer.start(() => {
      this.cleanupTimingState();
    }, 30_000);
  }

  /**
   * Fingerprint a request and return bot score + classification.
   */
  fingerprint(request: FingerprintRequest): FingerprintResult {
    this.totalFingerprinted++;
    const signals: string[] = [];
    let score = 0;

    // ── Header fingerprint (cached to avoid SHA256 per request) ────
    const headerNames = Object.keys(request.headers)
      .map((h) => h.toLowerCase())
      .join(',');
    let headerHash = '';
    if (this.config.headerFingerprint) {
      headerHash = this.headerHashCache.get(headerNames) ?? '';
      if (!headerHash) {
        headerHash = createHash('sha256').update(headerNames).digest('hex').slice(0, 16);
        if (this.headerHashCache.size >= RequestFingerprinter.MAX_HASH_CACHE) {
          // Evict oldest entry (first key in Map iteration order)
          const first = this.headerHashCache.keys().next().value;
          if (first !== undefined) this.headerHashCache.delete(first);
        }
        this.headerHashCache.set(headerNames, headerHash);
      }
    }

    // ── Behavioral heuristics ────────────────────────────────────────
    if (this.config.behavioralHeuristics) {
      const headers = request.headers;

      // Missing browser headers
      if (!headers['accept-language']) {
        score += 20;
        signals.push('missing_accept_language');
      }
      if (!headers['accept-encoding']) {
        score += 15;
        signals.push('missing_accept_encoding');
      }
      if (!headers.accept) {
        score += 10;
        signals.push('missing_accept');
      }

      // Suspicious user-agent
      const ua = headers['user-agent'];
      if (!ua) {
        score += 25;
        signals.push('missing_user_agent');
      } else {
        const uaLower = (Array.isArray(ua) ? (ua[0] ?? '') : ua).toLowerCase();
        for (const pattern of BOT_UA_PATTERNS) {
          if (uaLower.includes(pattern)) {
            score += 15;
            signals.push(`bot_ua_${pattern}`);
            break;
          }
        }
      }

      // Metronomic timing detection
      const timingScore = this.checkTimingRegularity(request.ip);
      if (timingScore > 0) {
        score += timingScore;
        signals.push('metronomic_timing');
      }
    }

    // Cap score at 100
    score = Math.min(score, 100);

    // Classify
    const classification: FingerprintResult['classification'] =
      score >= this.config.botScoreThreshold
        ? 'bot'
        : score >= this.config.suspiciousScoreThreshold
          ? 'suspicious'
          : 'human';

    // Feed reputation system
    if (this.reputationManager) {
      if (classification === 'bot') {
        this.reputationManager.recordViolation(
          request.ip,
          this.config.reputationPenaltyBot,
          'bot_detected'
        );
      } else if (classification === 'suspicious') {
        this.reputationManager.recordViolation(
          request.ip,
          this.config.reputationPenaltySuspicious,
          'suspicious_client'
        );
      }
    }

    // Update stats
    if (classification === 'bot') {
      this.botsDetected++;
      this.logger.warn(
        { ip: request.ip, score, signals, classification },
        'Bot detected via request fingerprinting'
      );
    } else if (classification === 'suspicious') {
      this.suspiciousDetected++;
      this.logger.info(
        { ip: request.ip, score, signals, classification },
        'Suspicious client detected via request fingerprinting'
      );
    }

    return { headerHash, botScore: score, classification, signals };
  }

  /**
   * Track request timestamps per IP and detect metronomic (robotic) timing.
   * Returns 20 if timing is metronomic, 0 otherwise.
   */
  private checkTimingRegularity(ip: string): number {
    const now = Date.now();
    let state = this.timingState.get(ip);

    if (!state) {
      state = { timestamps: [now], lastActivity: now };
      this.timingState.set(ip, state);
      return 0;
    }

    state.timestamps.push(now);
    state.lastActivity = now;

    // Keep only last MAX_TIMESTAMPS entries
    if (state.timestamps.length > MAX_TIMESTAMPS) {
      state.timestamps = state.timestamps.slice(-MAX_TIMESTAMPS);
    }

    // Need at least 5 timestamps to detect metronomic timing
    if (state.timestamps.length < 5) {
      return 0;
    }

    // Calculate intervals between last 5 requests
    const recent = state.timestamps.slice(-5);
    const intervals: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      intervals.push(recent[i]! - recent[i - 1]!);
    }

    // Calculate variance of intervals
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;

    // If variance < 50ms^2 (i.e., < 2500), timing is metronomic
    if (variance < 2500) {
      return 20;
    }

    return 0;
  }

  /** Remove stale IP timing entries with no recent activity or when over hard cap. */
  private cleanupTimingState(): void {
    const now = Date.now();
    const hardCap = 50_000;
    for (const [ip, state] of this.timingState) {
      if (now - state.lastActivity > TIMING_EVICTION_MS || this.timingState.size > hardCap) {
        this.timingState.delete(ip);
      }
    }
  }

  getStats(): {
    totalFingerprinted: number;
    botsDetected: number;
    suspiciousDetected: number;
  } {
    return {
      totalFingerprinted: this.totalFingerprinted,
      botsDetected: this.botsDetected,
      suspiciousDetected: this.suspiciousDetected,
    };
  }

  stop(): void {
    this.cleanupTimer.stop();
    this.timingState.clear();
    this.headerHashCache.clear();
    this.totalFingerprinted = 0;
    this.botsDetected = 0;
    this.suspiciousDetected = 0;
  }
}

/**
 * Create a Fastify onRequest hook that fingerprints each request and
 * decorates it with a botScore. Does NOT block — scoring only.
 */
export function createFingerprintHook(
  fingerprinter: RequestFingerprinter
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const result = fingerprinter.fingerprint({
      ip: request.ip,
      headers: request.headers,
      url: request.url,
    });
    (request as any).botScore = result.botScore;
  };
}
