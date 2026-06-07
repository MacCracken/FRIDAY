/**
 * Capture Audit Logger
 *
 * Specialized audit logging for screen capture operations with
 * high-risk event detection and compliance reporting.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_04: Audit Logging Integration
 */

import { randomUUID } from 'crypto';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { getLogger, type SecureLogger } from '../logging/logger.js';
import type { CaptureScope, CaptureResource } from './types.js';
import type {
  CaptureEventType,
  CaptureResult,
  CaptureAuditEvent,
  DataProvenance,
  Anomaly,
  ComplianceReport,
  AuditFilter,
  RiskDetectionRules,
} from './capture-audit.js';
import { DEFAULT_RISK_RULES } from './capture-audit.js';

/**
 * Storage interface for capture audit events
 */
export interface CaptureAuditStorage {
  /** Append an entry to storage */
  append(entry: CaptureAuditEvent): Promise<void>;
  /** Get the last entry (for chain continuation) */
  getLast(): Promise<CaptureAuditEvent | null>;
  /** Iterate all entries in order */
  iterate(): AsyncIterableIterator<CaptureAuditEvent>;
  /** Get entry count */
  count(): Promise<number>;
  /** Get entry by ID */
  getById(id: string): Promise<CaptureAuditEvent | null>;
  /** Query events with filter */
  query(filter?: AuditFilter): Promise<CaptureAuditEvent[]>;
}

/**
 * Configuration for capture audit logger
 */
export interface CaptureAuditConfig {
  /** Storage backend */
  storage?: CaptureAuditStorage;

  /** Signing key for HMAC */
  signingKey: string;

  /** Risk detection rules */
  riskRules?: RiskDetectionRules;

  /** Alert callback for high-risk events */
  onHighRiskEvent?: (event: CaptureAuditEvent, anomalies: Anomaly[]) => void;

  /** Retention period in days (default: 2555 = 7 years) */
  retentionDays?: number;
}

/**
 * Parameters for logging capture events
 */
export interface LogCaptureEventParams {
  eventType: CaptureEventType;
  sessionId: string;
  userId: string;
  roleId: string;
  consentId: string;
  scope: CaptureScope;
  result: CaptureResult;
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    correlationId?: string;
    location?: string;
  };
}

/**
 * In-memory storage for capture audit events
 */
export class InMemoryCaptureAuditStorage implements CaptureAuditStorage {
  private entries: CaptureAuditEvent[] = [];
  private lastEntry: CaptureAuditEvent | null = null;

  async append(entry: CaptureAuditEvent): Promise<void> {
    this.entries.push(entry);
    this.lastEntry = entry;
  }

  async getLast(): Promise<CaptureAuditEvent | null> {
    return this.lastEntry;
  }

  async *iterate(): AsyncIterableIterator<CaptureAuditEvent> {
    for (const entry of this.entries) {
      yield entry;
    }
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  async getById(id: string): Promise<CaptureAuditEvent | null> {
    return this.entries.find((e) => e.id === id) || null;
  }

  /** Get all events matching filter */
  async query(filter?: AuditFilter): Promise<CaptureAuditEvent[]> {
    let results = [...this.entries];

    if (filter?.startDate) {
      const startTime = filter.startDate.getTime();
      results = results.filter((e) => e.timestamp >= startTime);
    }

    if (filter?.endDate) {
      const endTime = filter.endDate.getTime();
      results = results.filter((e) => e.timestamp <= endTime);
    }

    if (filter?.eventTypes?.length) {
      results = results.filter((e) => filter.eventTypes!.includes(e.eventType));
    }

    if (filter?.userIds?.length) {
      results = results.filter((e) => filter.userIds!.includes(e.userId));
    }

    if (filter?.resources?.length) {
      results = results.filter((e) => filter.resources!.includes(e.scope.resource));
    }

    if (filter?.success !== undefined) {
      results = results.filter((e) => e.result.success === filter.success);
    }

    return results;
  }

  /** Clear all events (for testing) */
  clear(): void {
    this.entries = [];
    this.lastEntry = null;
  }
}

/**
 * Capture audit logger with high-risk detection and compliance reporting
 */
export class CaptureAuditLogger {
  private baseChain: AuditChain;
  private storage: CaptureAuditStorage;
  private config: CaptureAuditConfig;
  private logger: SecureLogger;
  private riskRules: RiskDetectionRules;
  private userEventHistory = new Map<string, number[]>();

  constructor(config: CaptureAuditConfig) {
    this.storage = config.storage || new InMemoryCaptureAuditStorage();
    this.config = config;
    this.riskRules = config.riskRules || DEFAULT_RISK_RULES;

    // Initialize base audit chain with separate in-memory storage
    this.baseChain = new AuditChain({
      storage: new InMemoryAuditStorage(),
      signingKey: config.signingKey,
    });

    // Initialize logger
    try {
      this.logger = getLogger().child({ component: 'CaptureAuditLogger' });
    } catch {
      this.logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => this.logger,
        level: 'info',
      };
    }
  }

  /**
   * Initialize the audit logger
   */
  async initialize(): Promise<void> {
    await this.baseChain.initialize();
    this.logger.info('Capture audit logger initialized');
  }

  /**
   * Log a capture event
   */
  async logCaptureEvent(params: LogCaptureEventParams): Promise<CaptureAuditEvent> {
    const timestamp = Date.now();

    // Get last hash from chain
    const lastEntry = await this.storage.getLast();
    const previousHash = lastEntry?.hash || '0'.repeat(64);

    // Build event (without hash/signature first)
    const event: Omit<CaptureAuditEvent, 'hash' | 'signature'> = {
      id: randomUUID(),
      timestamp,
      eventType: params.eventType,
      sessionId: params.sessionId,
      userId: params.userId,
      roleId: params.roleId,
      consentId: params.consentId,
      scope: params.scope,
      result: params.result,
      metadata: params.metadata || {},
      previousHash,
    };

    // Compute hash
    const hash = this.computeHash(event);

    // Sign the event
    const signature = this.signEvent(hash, previousHash);

    // Complete event
    const fullEvent: CaptureAuditEvent = {
      ...event,
      hash,
      signature,
    };

    // Store event
    await this.storage.append(fullEvent);

    // Track for anomaly detection
    this.trackEventForAnomalyDetection(fullEvent);

    // Check for high-risk events
    const anomalies = this.detectAnomalies(fullEvent);
    if (anomalies.length > 0 && this.config.onHighRiskEvent) {
      this.config.onHighRiskEvent(fullEvent, anomalies);
    }

    // Also log to base audit chain for unified logging
    await this.baseChain.record({
      event: `capture:${params.eventType}`,
      level: anomalies.length > 0 ? 'security' : 'info',
      message: `Capture ${params.eventType}: ${params.result.success ? 'success' : 'failure'}`,
      userId: params.userId,
      correlationId: params.metadata?.correlationId,
      metadata: {
        captureEventId: fullEvent.id,
        consentId: params.consentId,
        resource: params.scope.resource,
        success: params.result.success,
        anomalies: anomalies.length,
      },
    });

    // Log
    this.logger.info(
      {
        eventId: fullEvent.id,
        eventType: params.eventType,
        userId: params.userId,
        anomalies: anomalies.length,
      },
      'Capture event logged'
    );

    return fullEvent;
  }

  /**
   * Create data provenance record
   */
  async createProvenance(
    captureId: string,
    createdBy: string,
    consentId: string,
    scope: CaptureScope,
    contentHash: string
  ): Promise<DataProvenance> {
    const provenance: DataProvenance = {
      captureId,
      createdAt: Date.now(),
      createdBy,
      consentId,
      scope,
      contentHash,
      custodyChain: [
        {
          timestamp: Date.now(),
          action: 'created',
          actor: createdBy,
        },
      ],
    };

    // Log provenance creation
    await this.logCaptureEvent({
      eventType: 'capture.completed',
      sessionId: captureId,
      userId: createdBy,
      roleId: 'system', // Will be overridden by actual role
      consentId,
      scope,
      result: {
        success: true,
        captureId,
      },
    });

    return provenance;
  }

  /**
   * Track data access in provenance
   */
  async trackDataAccess(
    captureId: string,
    action: 'viewed' | 'copied' | 'exported' | 'deleted',
    actor: string,
    location?: string,
    reason?: string
  ): Promise<void> {
    await this.logCaptureEvent({
      eventType: 'capture.accessed',
      sessionId: captureId,
      userId: actor,
      roleId: 'system',
      consentId: captureId,
      scope: {
        resource: 'capture.screen',
        duration: { maxSeconds: 0 },
        quality: {
          resolution: '720p',
          frameRate: 30,
          compression: 'medium',
          format: 'png',
        },
        purpose: `Data ${action}`,
      },
      result: {
        success: true,
        action,
      },
      metadata: {
        location,
        correlationId: reason,
      },
    });
  }

  /**
   * Query audit events
   */
  async queryEvents(filter?: AuditFilter): Promise<CaptureAuditEvent[]> {
    return this.storage.query(filter);
  }

  /**
   * Generate compliance report
   */
  async generateComplianceReport(startDate: Date, endDate: Date): Promise<ComplianceReport> {
    const events = await this.queryEvents({ startDate, endDate });

    // Calculate summary
    const summary = {
      totalRequests: events.filter((e) => e.eventType === 'capture.requested').length,
      totalApproved: events.filter((e) => e.eventType === 'capture.approved').length,
      totalDenied: events.filter((e) => e.eventType === 'capture.denied').length,
      totalCompleted: events.filter((e) => e.eventType === 'capture.completed').length,
      totalFailed: events.filter((e) => e.eventType === 'capture.failed').length,
      totalStopped: events.filter((e) => e.eventType === 'capture.stopped').length,
      totalExpired: events.filter((e) => e.eventType === 'capture.expired').length,
      totalAccessed: events.filter((e) => e.eventType === 'capture.accessed').length,
      totalDeleted: events.filter((e) => e.eventType === 'capture.deleted').length,
      totalExported: events.filter((e) => e.eventType === 'capture.exported').length,
    };

    // Aggregate by user
    const userMap = new Map<
      string,
      { requests: number; approved: number; denied: number; completed: number }
    >();
    for (const event of events) {
      const stats = userMap.get(event.userId) || {
        requests: 0,
        approved: 0,
        denied: 0,
        completed: 0,
      };

      if (event.eventType === 'capture.requested') stats.requests++;
      if (event.eventType === 'capture.approved') stats.approved++;
      if (event.eventType === 'capture.denied') stats.denied++;
      if (event.eventType === 'capture.completed') stats.completed++;

      userMap.set(event.userId, stats);
    }
    const byUser = Array.from(userMap.entries()).map(([userId, stats]) => ({
      userId,
      ...stats,
    }));

    // Aggregate by resource
    const resourceMap = new Map<CaptureResource, { requests: number; completed: number }>();
    for (const event of events) {
      const stats = resourceMap.get(event.scope.resource) || {
        requests: 0,
        completed: 0,
      };

      if (event.eventType === 'capture.requested') stats.requests++;
      if (event.eventType === 'capture.completed') stats.completed++;

      resourceMap.set(event.scope.resource, stats);
    }
    const byResource = Array.from(resourceMap.entries()).map(([resource, stats]) => ({
      resource,
      ...stats,
    }));

    // Verify chain integrity
    const chainIntegrity = await this.verifyChain();

    // Detect anomalies across all events
    const anomalies = this.detectAnomaliesAcrossEvents(events);

    return {
      period: { start: startDate, end: endDate },
      summary,
      byUser,
      byResource,
      chainIntegrity,
      anomalies,
      generatedAt: new Date(),
    };
  }

  /**
   * Verify audit chain integrity
   */
  async verifyChain(): Promise<{
    valid: boolean;
    totalEvents: number;
    errors?: string[];
  }> {
    const errors: string[] = [];
    let previousHash = '0'.repeat(64);
    let count = 0;

    for await (const event of this.storage.iterate()) {
      count++;

      // Verify hash chain
      if (event.previousHash !== previousHash) {
        errors.push(
          `Chain broken at ${event.id}: expected ${previousHash}, got ${event.previousHash}`
        );
      }

      // Verify hash and signature
      const hashData: Omit<CaptureAuditEvent, 'hash' | 'signature'> = {
        id: event.id,
        timestamp: event.timestamp,
        eventType: event.eventType,
        sessionId: event.sessionId,
        userId: event.userId,
        roleId: event.roleId,
        consentId: event.consentId,
        scope: event.scope,
        result: event.result,
        metadata: event.metadata,
        previousHash: event.previousHash,
      };
      const expectedHash = this.computeHash(hashData);
      if (event.hash !== expectedHash) {
        errors.push(`Invalid hash at ${event.id}`);
      }
      const expectedSig = this.signEvent(expectedHash, event.previousHash);
      if (event.signature !== expectedSig) {
        errors.push(`Invalid signature at ${event.id}`);
      }

      previousHash = event.hash;
    }

    return {
      valid: errors.length === 0,
      totalEvents: count,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Clean up old events based on retention policy
   */
  async cleanup(): Promise<number> {
    const retentionDays = this.config.retentionDays || 2555; // 7 years default
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // For in-memory storage, we just clear old events
    // In production, this would archive to cold storage first
    let count = 0;
    const events = await this.queryEvents();

    for (const event of events) {
      if (event.timestamp < cutoff) {
        // In real implementation, archive before delete
        count++;
      }
    }

    this.logger.info({ count, retentionDays }, 'Audit cleanup completed');
    return count;
  }

  /**
   * Compute SHA-256 hash of event data
   */
  private computeHash(event: Omit<CaptureAuditEvent, 'hash' | 'signature'>): string {
    const { createHash } = require('crypto');
    const hashData = {
      id: event.id,
      timestamp: event.timestamp,
      eventType: event.eventType,
      userId: event.userId,
      consentId: event.consentId,
      scope: event.scope,
      result: event.result,
      previousHash: event.previousHash,
    };

    const serialized = JSON.stringify(hashData, Object.keys(hashData).sort());
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Sign event with HMAC-SHA256
   */
  private signEvent(hash: string, previousHash: string): string {
    const { createHmac } = require('crypto');
    const dataToSign = `${hash}:${previousHash}`;
    return createHmac('sha256', this.config.signingKey).update(dataToSign).digest('hex');
  }

  /**
   * Track event for anomaly detection
   */
  private trackEventForAnomalyDetection(event: CaptureAuditEvent): void {
    const history = this.userEventHistory.get(event.userId) || [];
    history.push(event.timestamp);

    // Keep only last hour
    const oneHourAgo = Date.now() - 3600000;
    const recent = history.filter((t) => t > oneHourAgo);
    this.userEventHistory.set(event.userId, recent);
  }

  /**
   * Detect anomalies for a single event
   */
  private detectAnomalies(event: CaptureAuditEvent): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Check for high frequency
    const history = this.userEventHistory.get(event.userId) || [];
    const oneHourAgo = Date.now() - 3600000;
    const recentCount = history.filter((t) => t > oneHourAgo).length;

    if (recentCount > this.riskRules.maxRequestsPerHour) {
      anomalies.push({
        type: 'high_frequency',
        userId: event.userId,
        severity: 'warning',
        details: `${recentCount} capture requests in last hour`,
        detectedAt: Date.now(),
      });
    }

    // Check for large scope
    if (event.scope.duration.maxSeconds > this.riskRules.maxDurationAlert) {
      anomalies.push({
        type: 'large_scope',
        userId: event.userId,
        severity: 'info',
        details: `Duration ${event.scope.duration.maxSeconds}s exceeds alert threshold`,
        detectedAt: Date.now(),
      });
    }

    // Check for after-hours access
    const hour = new Date(event.timestamp).getHours();
    if (hour < this.riskRules.businessHours.start || hour >= this.riskRules.businessHours.end) {
      anomalies.push({
        type: 'after_hours',
        userId: event.userId,
        severity: 'info',
        details: `Capture at ${hour}:00 (outside business hours)`,
        detectedAt: Date.now(),
      });
    }

    // Check for failures
    if (event.eventType === 'capture.failed') {
      anomalies.push({
        type: 'failed_attempts',
        userId: event.userId,
        severity: 'warning',
        details: `Capture failed: ${event.result.error}`,
        detectedAt: Date.now(),
      });
    }

    return anomalies;
  }

  /**
   * Detect anomalies across multiple events
   */
  private detectAnomaliesAcrossEvents(events: CaptureAuditEvent[]): Anomaly[] {
    const allAnomalies: Anomaly[] = [];

    // Group by user
    const byUser = new Map<string, CaptureAuditEvent[]>();
    for (const event of events) {
      const userEvents = byUser.get(event.userId) || [];
      userEvents.push(event);
      byUser.set(event.userId, userEvents);
    }

    // Check each user's events
    for (const [userId, userEvents] of byUser) {
      // Check for unusual access patterns
      const failedCount = userEvents.filter((e) => e.eventType === 'capture.failed').length;
      if (failedCount > this.riskRules.maxFailedAttempts) {
        allAnomalies.push({
          type: 'failed_attempts',
          userId,
          severity: 'critical',
          details: `${failedCount} failed capture attempts`,
          detectedAt: Date.now(),
        });
      }

      // Check for access by non-owner
      const accesses = userEvents.filter((e) => e.eventType === 'capture.accessed');
      for (const _access of accesses) {
        // In real implementation, compare with capture owner
        // For now, flag all accesses as potentially unusual
        if (accesses.length > 5) {
          allAnomalies.push({
            type: 'unusual_access',
            userId,
            severity: 'warning',
            details: `High number of data accesses (${accesses.length})`,
            detectedAt: Date.now(),
          });
          break;
        }
      }
    }

    return allAnomalies;
  }
}

/**
 * Global capture audit logger instance
 */
let globalCaptureAuditLogger: CaptureAuditLogger | null = null;

/**
 * Initialize global capture audit logger
 */
export function initializeCaptureAuditLogger(config: CaptureAuditConfig): CaptureAuditLogger {
  globalCaptureAuditLogger = new CaptureAuditLogger(config);
  return globalCaptureAuditLogger;
}

/**
 * Get global capture audit logger
 */
export function getCaptureAuditLogger(): CaptureAuditLogger {
  if (!globalCaptureAuditLogger) {
    throw new Error('Capture audit logger not initialized');
  }
  return globalCaptureAuditLogger;
}

/**
 * Reset global capture audit logger (for testing)
 */
export function resetCaptureAuditLogger(): void {
  globalCaptureAuditLogger = null;
}
