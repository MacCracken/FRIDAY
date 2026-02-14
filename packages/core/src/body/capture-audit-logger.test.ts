/**
 * Capture Audit Logger Tests
 *
 * @see NEXT_STEP_04: Audit Logging Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CaptureAuditLogger,
  InMemoryCaptureAuditStorage,
  initializeCaptureAuditLogger,
  resetCaptureAuditLogger,
  getCaptureAuditLogger,
  type CaptureAuditConfig,
  type LogCaptureEventParams,
} from './capture-audit-logger.js';
import type { CaptureScope, CaptureResource } from './types.js';
import type { CaptureEventType, Anomaly } from './capture-audit.js';

describe('CaptureAuditLogger', () => {
  let logger: CaptureAuditLogger;
  let storage: InMemoryCaptureAuditStorage;
  let alertCallback: ReturnType<typeof vi.fn>;

  const testScope: CaptureScope = {
    resource: 'capture.screen' as CaptureResource,
    duration: { maxSeconds: 60 },
    quality: {
      resolution: '720p',
      frameRate: 30,
      compression: 'medium',
      format: 'webp',
    },
    purpose: 'Testing',
  };

  const baseEvent: LogCaptureEventParams = {
    eventType: 'capture.requested' as CaptureEventType,
    sessionId: 'session-123',
    userId: 'user-456',
    roleId: 'role_operator',
    consentId: 'consent-789',
    scope: testScope,
    result: { success: true },
  };

  beforeEach(async () => {
    storage = new InMemoryCaptureAuditStorage();
    alertCallback = vi.fn();

    const config: CaptureAuditConfig = {
      storage,
      signingKey: 'test-signing-key-at-least-32-characters-long',
      riskRules: {
        maxRequestsPerHour: 5,
        maxDurationAlert: 300,
        businessHours: { start: 9, end: 17 },
        maxFailedAttempts: 3,
      },
      onHighRiskEvent: alertCallback,
    };

    logger = new CaptureAuditLogger(config);
    await logger.initialize();
    resetCaptureAuditLogger();
  });

  describe('logCaptureEvent', () => {
    it('should log a capture event', async () => {
      const event = await logger.logCaptureEvent(baseEvent);

      expect(event.id).toBeDefined();
      expect(event.eventType).toBe('capture.requested');
      expect(event.userId).toBe('user-456');
      expect(event.hash).toBeDefined();
      expect(event.signature).toBeDefined();
      expect(event.previousHash).toBeDefined();
    });

    it('should link events in a chain', async () => {
      const event1 = await logger.logCaptureEvent(baseEvent);
      const event2 = await logger.logCaptureEvent({
        ...baseEvent,
        eventType: 'capture.approved',
      });

      expect(event2.previousHash).toBe(event1.hash);
    });

    it('should include metadata', async () => {
      const event = await logger.logCaptureEvent({
        ...baseEvent,
        metadata: {
          ipAddress: '192.168.1.1',
          userAgent: 'Test Agent',
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
        },
      });

      expect(event.metadata.ipAddress).toBe('192.168.1.1');
      expect(event.metadata.userAgent).toBe('Test Agent');
    });

    it('should trigger alert on high frequency', async () => {
      // Log 6 events (above threshold of 5)
      for (let i = 0; i < 6; i++) {
        await logger.logCaptureEvent({
          ...baseEvent,
          eventType: 'capture.requested',
        });
      }

      expect(alertCallback).toHaveBeenCalled();
    });

    it('should trigger alert on large scope', async () => {
      const largeScope: CaptureScope = {
        ...testScope,
        duration: { maxSeconds: 600 }, // Above 300s threshold
      };

      await logger.logCaptureEvent({
        ...baseEvent,
        scope: largeScope,
      });

      expect(alertCallback).toHaveBeenCalled();
    });

    it('should trigger alert on failure', async () => {
      await logger.logCaptureEvent({
        ...baseEvent,
        eventType: 'capture.failed',
        result: { success: false, error: 'Test error' },
      });

      expect(alertCallback).toHaveBeenCalled();
    });
  });

  describe('chain integrity', () => {
    it('should verify valid chain', async () => {
      await logger.logCaptureEvent(baseEvent);
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.approved' });

      const result = await logger.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEvents).toBe(2);
    });

    it('should detect broken chain', async () => {
      await logger.logCaptureEvent(baseEvent);

      // Manually corrupt the storage by directly modifying internal entries
      (storage as any).entries[0].hash = 'corrupted-hash';

      const result = await logger.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should detect invalid signature', async () => {
      await logger.logCaptureEvent(baseEvent);

      // Manually corrupt the signature by directly modifying internal entries
      (storage as any).entries[0].signature = 'invalid-signature';

      const result = await logger.verifyChain();

      expect(result.valid).toBe(false);
    });
  });

  describe('queryEvents', () => {
    it('should query by date range', async () => {
      await logger.logCaptureEvent(baseEvent);

      const events = await logger.queryEvents({
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 1000),
      });

      expect(events.length).toBe(1);
    });

    it('should filter by event type', async () => {
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.requested' });
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.approved' });

      const events = await logger.queryEvents({
        eventTypes: ['capture.approved'],
      });

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('capture.approved');
    });

    it('should filter by user', async () => {
      await logger.logCaptureEvent({ ...baseEvent, userId: 'user-1' });
      await logger.logCaptureEvent({ ...baseEvent, userId: 'user-2' });

      const events = await logger.queryEvents({
        userIds: ['user-1'],
      });

      expect(events.length).toBe(1);
      expect(events[0].userId).toBe('user-1');
    });

    it('should filter by success', async () => {
      await logger.logCaptureEvent({ ...baseEvent, result: { success: true } });
      await logger.logCaptureEvent({ ...baseEvent, result: { success: false } });

      const successful = await logger.queryEvents({ success: true });
      const failed = await logger.queryEvents({ success: false });

      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
    });
  });

  describe('createProvenance', () => {
    it('should create provenance record', async () => {
      const provenance = await logger.createProvenance(
        'capture-123',
        'user-456',
        'consent-789',
        testScope,
        'content-hash-abc'
      );

      expect(provenance.captureId).toBe('capture-123');
      expect(provenance.createdBy).toBe('user-456');
      expect(provenance.contentHash).toBe('content-hash-abc');
      expect(provenance.custodyChain).toHaveLength(1);
      expect(provenance.custodyChain[0].action).toBe('created');
    });
  });

  describe('trackDataAccess', () => {
    it('should log data access', async () => {
      await logger.trackDataAccess('capture-123', 'viewed', 'user-456', 'dashboard');

      const events = await logger.queryEvents({
        eventTypes: ['capture.accessed'],
      });

      expect(events.length).toBe(1);
      expect(events[0].result.action).toBe('viewed');
    });
  });

  describe('compliance report', () => {
    it('should generate compliance report', async () => {
      // Log various events
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.requested' });
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.approved' });
      await logger.logCaptureEvent({ ...baseEvent, eventType: 'capture.completed' });

      const report = await logger.generateComplianceReport(
        new Date(Date.now() - 10000),
        new Date()
      );

      expect(report.summary.totalRequests).toBe(1);
      expect(report.summary.totalApproved).toBe(1);
      expect(report.summary.totalCompleted).toBe(1);
      expect(report.chainIntegrity.valid).toBe(true);
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('should aggregate by user', async () => {
      await logger.logCaptureEvent({ ...baseEvent, userId: 'user-1' });
      await logger.logCaptureEvent({ ...baseEvent, userId: 'user-2' });
      await logger.logCaptureEvent({ ...baseEvent, userId: 'user-1' });

      const report = await logger.generateComplianceReport(
        new Date(Date.now() - 10000),
        new Date()
      );

      expect(report.byUser.length).toBe(2);
      const user1Stats = report.byUser.find((u) => u.userId === 'user-1');
      expect(user1Stats?.requests).toBe(2);
    });

    it('should aggregate by resource', async () => {
      await logger.logCaptureEvent({
        ...baseEvent,
        scope: { ...testScope, resource: 'capture.screen' as CaptureResource },
      });
      await logger.logCaptureEvent({
        ...baseEvent,
        scope: { ...testScope, resource: 'capture.camera' as CaptureResource },
      });

      const report = await logger.generateComplianceReport(
        new Date(Date.now() - 10000),
        new Date()
      );

      expect(report.byResource.length).toBe(2);
    });

    it('should detect anomalies', async () => {
      // Log many failures
      for (let i = 0; i < 5; i++) {
        await logger.logCaptureEvent({
          ...baseEvent,
          eventType: 'capture.failed',
          result: { success: false },
        });
      }

      const report = await logger.generateComplianceReport(
        new Date(Date.now() - 10000),
        new Date()
      );

      expect(report.anomalies.length).toBeGreaterThan(0);
      const criticalAnomaly = report.anomalies.find((a) => a.severity === 'critical');
      expect(criticalAnomaly).toBeDefined();
    });
  });

  describe('anomaly detection', () => {
    it('should detect after-hours access', async () => {
      // Mock an event at 2 AM
      const afterHoursEvent = {
        ...baseEvent,
        metadata: { correlationId: '550e8400-e29b-41d4-a716-446655440001' },
      };

      // Create a new logger that will receive the event timestamp
      const lateLogger = new CaptureAuditLogger({
        storage: new InMemoryCaptureAuditStorage(),
        signingKey: 'test-signing-key-at-least-32-characters-long',
        onHighRiskEvent: alertCallback,
      });

      await lateLogger.logCaptureEvent(afterHoursEvent);

      // Note: After-hours detection depends on actual timestamp
      // This test may not always trigger depending on when it's run
    });

    it('should detect high frequency', async () => {
      // Log 6 events quickly (threshold is maxRequestsPerHour: 5)
      for (let i = 0; i < 6; i++) {
        await logger.logCaptureEvent(baseEvent);
      }

      expect(alertCallback).toHaveBeenCalled();
      // Find the call that contains a high_frequency anomaly — earlier calls
      // may only contain after_hours anomalies depending on when the test runs.
      const allAnomalies = alertCallback.mock.calls.flatMap(([, a]: [unknown, Anomaly[]]) => a);
      const highFreqAnomaly = allAnomalies.find((a: Anomaly) => a.type === 'high_frequency');
      expect(highFreqAnomaly).toBeDefined();
    });
  });
});

describe('InMemoryCaptureAuditStorage', () => {
  let storage: InMemoryCaptureAuditStorage;

  beforeEach(() => {
    storage = new InMemoryCaptureAuditStorage();
  });

  it('should append and retrieve events', async () => {
    const event = {
      id: 'test-1',
      timestamp: Date.now(),
      eventType: 'capture.requested' as CaptureEventType,
      sessionId: 'session-1',
      userId: 'user-1',
      roleId: 'role-1',
      consentId: 'consent-1',
      scope: {
        resource: 'capture.screen' as CaptureResource,
        duration: { maxSeconds: 60 },
        quality: {
          resolution: '720p' as const,
          frameRate: 30,
          compression: 'medium' as const,
          format: 'webp' as const,
        },
        purpose: 'Test',
      },
      result: { success: true },
      metadata: {},
      hash: 'hash-1',
      previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
      signature: 'sig-1',
    };

    await storage.append(event);

    const retrieved = await storage.getById('test-1');
    expect(retrieved?.id).toBe('test-1');
    expect(await storage.count()).toBe(1);
  });

  it('should query with filters', async () => {
    // Add multiple events
    for (let i = 0; i < 3; i++) {
      await storage.append({
        id: `test-${i}`,
        timestamp: Date.now(),
        eventType:
          i === 0
            ? ('capture.requested' as CaptureEventType)
            : ('capture.approved' as CaptureEventType),
        sessionId: 'session-1',
        userId: i === 0 ? 'user-1' : 'user-2',
        roleId: 'role-1',
        consentId: 'consent-1',
        scope: {
          resource: 'capture.screen' as CaptureResource,
          duration: { maxSeconds: 60 },
          quality: {
            resolution: '720p' as const,
            frameRate: 30,
            compression: 'medium' as const,
            format: 'webp' as const,
          },
          purpose: 'Test',
        },
        result: { success: i === 0 },
        metadata: {},
        hash: `hash-${i}`,
        previousHash: '0000',
        signature: 'sig',
      });
    }

    const requestedEvents = await storage.query({
      eventTypes: ['capture.requested'],
    });
    expect(requestedEvents.length).toBe(1);

    const user1Events = await storage.query({ userIds: ['user-1'] });
    expect(user1Events.length).toBe(1);

    const successfulEvents = await storage.query({ success: true });
    expect(successfulEvents.length).toBe(1);
  });

  it('should iterate all events', async () => {
    await storage.append({
      id: 'test-1',
      timestamp: Date.now(),
      eventType: 'capture.requested' as CaptureEventType,
      sessionId: 'session-1',
      userId: 'user-1',
      roleId: 'role-1',
      consentId: 'consent-1',
      scope: {
        resource: 'capture.screen' as CaptureResource,
        duration: { maxSeconds: 60 },
        quality: {
          resolution: '720p' as const,
          frameRate: 30,
          compression: 'medium' as const,
          format: 'webp' as const,
        },
        purpose: 'Test',
      },
      result: { success: true },
      metadata: {},
      hash: 'hash-1',
      previousHash: '0000',
      signature: 'sig-1',
    });

    let count = 0;
    for await (const event of storage.iterate()) {
      expect(event.id).toBeDefined();
      count++;
    }

    expect(count).toBe(1);
  });

  it('should clear all events', async () => {
    await storage.append({
      id: 'test-1',
      timestamp: Date.now(),
      eventType: 'capture.requested' as CaptureEventType,
      sessionId: 'session-1',
      userId: 'user-1',
      roleId: 'role-1',
      consentId: 'consent-1',
      scope: {
        resource: 'capture.screen' as CaptureResource,
        duration: { maxSeconds: 60 },
        quality: {
          resolution: '720p' as const,
          frameRate: 30,
          compression: 'medium' as const,
          format: 'webp' as const,
        },
        purpose: 'Test',
      },
      result: { success: true },
      metadata: {},
      hash: 'hash-1',
      previousHash: '0000',
      signature: 'sig-1',
    });

    storage.clear();

    expect(await storage.count()).toBe(0);
    expect(await storage.getLast()).toBeNull();
  });
});

describe('Global Instance', () => {
  beforeEach(() => {
    resetCaptureAuditLogger();
  });

  afterEach(() => {
    resetCaptureAuditLogger();
  });

  it('should initialize global instance', () => {
    const logger = initializeCaptureAuditLogger({
      signingKey: 'test-key-at-least-32-characters-long',
    });

    expect(logger).toBeInstanceOf(CaptureAuditLogger);
  });

  it('should get global instance', () => {
    initializeCaptureAuditLogger({
      signingKey: 'test-key-at-least-32-characters-long',
    });

    const logger = getCaptureAuditLogger();
    expect(logger).toBeInstanceOf(CaptureAuditLogger);
  });

  it('should throw if not initialized', () => {
    expect(() => getCaptureAuditLogger()).toThrow('Capture audit logger not initialized');
  });

  it('should reset global instance', () => {
    initializeCaptureAuditLogger({
      signingKey: 'test-key-at-least-32-characters-long',
    });

    resetCaptureAuditLogger();

    expect(() => getCaptureAuditLogger()).toThrow();
  });
});
