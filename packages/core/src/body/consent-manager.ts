/**
 * Capture Consent Manager
 *
 * Manages user consent lifecycle for screen capture operations with
 * cryptographic integrity, audit logging, and timeout enforcement.
 *
 * @see ADR 016: User Consent and Approval Flow
 * @see NEXT_STEP_02: User Consent Layer
 */

import { randomUUID } from 'crypto';
import { getLogger, type SecureLogger } from '../logging/logger.js';
import type {
  CaptureConsent,
  ConsentConfig,
  ConsentGrantResult,
  ConsentStorage,
  ConsentKeyPair,
} from './consent.js';
import { DEFAULT_CONSENT_CONFIG } from './consent.js';
import type { SimpleCaptureScope } from './types.js';

/**
 * Consent manager options
 */
export interface ConsentManagerOptions {
  /** Configuration options */
  config?: Partial<ConsentConfig>;

  /** Storage backend */
  storage?: ConsentStorage;

  /** Signing key pair for consent signatures */
  keyPair?: ConsentKeyPair;

  /** Audit chain for logging consent events */
  auditChain?: {
    record(event: {
      event: string;
      level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'security';
      message: string;
      userId?: string;
      metadata?: Record<string, unknown>;
    }): Promise<unknown>;
  };
}

/**
 * In-memory consent storage implementation
 * For production, use a persistent storage backend
 */
export class InMemoryConsentStorage implements ConsentStorage {
  private consents = new Map<string, CaptureConsent>();

  async save(consent: CaptureConsent): Promise<void> {
    this.consents.set(consent.id, { ...consent });
  }

  async get(id: string): Promise<CaptureConsent | null> {
    const consent = this.consents.get(id);
    return consent ? { ...consent } : null;
  }

  async getPending(userId: string): Promise<CaptureConsent[]> {
    return Array.from(this.consents.values())
      .filter((c) => c.userId === userId && c.status === 'pending')
      .map((c) => ({ ...c }));
  }

  async getActive(userId: string): Promise<CaptureConsent[]> {
    return Array.from(this.consents.values())
      .filter((c) => c.userId === userId && c.status === 'granted')
      .map((c) => ({ ...c }));
  }

  async getHistory(userId: string, limit = 100): Promise<CaptureConsent[]> {
    return Array.from(this.consents.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.requestedAt - a.requestedAt)
      .slice(0, limit)
      .map((c) => ({ ...c }));
  }

  async update(consent: CaptureConsent): Promise<void> {
    if (!this.consents.has(consent.id)) {
      throw new Error(`Consent ${consent.id} not found`);
    }
    this.consents.set(consent.id, { ...consent });
  }

  async cleanup(cutoffTimestamp: number): Promise<number> {
    let count = 0;
    for (const [id, consent] of this.consents) {
      if (
        (consent.status === 'denied' || consent.status === 'expired') &&
        consent.requestedAt < cutoffTimestamp
      ) {
        this.consents.delete(id);
        count++;
      }
    }
    return count;
  }
}

/**
 * Manages capture consent lifecycle
 */
export class ConsentManager {
  private config: ConsentConfig;
  private storage: ConsentStorage;
  private keyPair?: ConsentKeyPair;
  private auditChain?: ConsentManagerOptions['auditChain'];
  private pendingTimers = new Map<string, NodeJS.Timeout>();
  private logger: SecureLogger;

  constructor(options: ConsentManagerOptions = {}) {
    this.config = { ...DEFAULT_CONSENT_CONFIG, ...options.config };
    this.storage = options.storage ?? new InMemoryConsentStorage();
    this.keyPair = options.keyPair;
    this.auditChain = options.auditChain;

    // Initialize logger
    try {
      this.logger = getLogger().child({ component: 'ConsentManager' });
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
   * Request consent for a capture operation
   *
   * @param userId - User ID requesting capture
   * @param requestedBy - User ID making the request (may differ from userId)
   * @param scope - Capture scope (what, how long, why)
   * @param sessionId - Associated session ID
   * @param timeoutMs - Optional custom timeout (capped at maxTimeoutMs)
   * @returns The created consent request
   */
  async requestConsent(
    userId: string,
    requestedBy: string,
    scope: SimpleCaptureScope,
    sessionId: string,
    timeoutMs?: number
  ): Promise<CaptureConsent> {
    const now = Date.now();
    const effectiveTimeout = Math.min(
      timeoutMs ?? this.config.defaultTimeoutMs,
      this.config.maxTimeoutMs
    );

    const consent: CaptureConsent = {
      id: randomUUID(),
      userId,
      requestedBy,
      sessionId,
      requestedAt: now,
      expiresAt: now + effectiveTimeout,
      scope,
      status: 'pending',
    };

    // Sign the consent for integrity
    if (this.keyPair) {
      consent.signature = await this.signConsent(consent);
      consent.signatureAlgorithm = this.keyPair.algorithm;
    }

    // Save to storage
    await this.storage.save(consent);

    // Set up auto-expiry timer
    if (this.config.autoDenyOnTimeout) {
      const timer = setTimeout(() => {
        void this.handleTimeout(consent.id);
      }, effectiveTimeout);
      this.pendingTimers.set(consent.id, timer);
    }

    // Audit log
    await this.audit('consent:requested', 'Consent requested', consent);

    this.logger.info(
      {
        consentId: consent.id,
        userId,
        requestedBy,
        resource: scope.resource,
        duration: scope.duration,
        expiresAt: consent.expiresAt,
      },
      'Consent requested'
    );

    return consent;
  }

  /**
   * Grant a pending consent request
   *
   * @param consentId - Consent ID to grant
   * @param grantedBy - User ID granting the consent
   * @returns Result of the grant operation
   */
  async grantConsent(consentId: string, grantedBy: string): Promise<ConsentGrantResult> {
    const consent = await this.storage.get(consentId);

    if (!consent) {
      return { success: false, error: 'Consent not found' };
    }

    if (consent.status !== 'pending') {
      return {
        success: false,
        error: `Consent is ${consent.status}, not pending`,
      };
    }

    if (Date.now() > consent.expiresAt) {
      consent.status = 'expired';
      await this.storage.update(consent);
      await this.audit('consent:expired', 'Consent expired before grant', consent);
      return { success: false, error: 'Consent request expired' };
    }

    // Clear the timeout timer
    const timer = this.pendingTimers.get(consentId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(consentId);
    }

    // Update consent
    consent.grantedAt = Date.now();
    consent.grantedBy = grantedBy;
    consent.status = 'granted';

    // Re-sign with new status
    if (this.keyPair) {
      consent.signature = await this.signConsent(consent);
    }

    await this.storage.update(consent);

    // Audit log
    await this.audit('consent:granted', 'Consent granted', consent);

    this.logger.info(
      {
        consentId: consent.id,
        grantedBy,
        userId: consent.userId,
      },
      'Consent granted'
    );

    return { success: true, consent };
  }

  /**
   * Deny a pending consent request
   *
   * @param consentId - Consent ID to deny
   * @param deniedBy - User ID denying the consent
   * @param reason - Reason for denial
   * @returns Result of the deny operation
   */
  async denyConsent(
    consentId: string,
    deniedBy: string,
    reason: string
  ): Promise<ConsentGrantResult> {
    const consent = await this.storage.get(consentId);

    if (!consent) {
      return { success: false, error: 'Consent not found' };
    }

    if (consent.status !== 'pending') {
      return {
        success: false,
        error: `Consent is ${consent.status}, not pending`,
      };
    }

    // Clear the timeout timer
    const timer = this.pendingTimers.get(consentId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(consentId);
    }

    // Update consent
    consent.deniedAt = Date.now();
    consent.denialReason = reason;
    consent.status = 'denied';

    // Re-sign with new status
    if (this.keyPair) {
      consent.signature = await this.signConsent(consent);
    }

    await this.storage.update(consent);

    // Audit log
    await this.audit('consent:denied', `Consent denied: ${reason}`, consent);

    this.logger.info(
      {
        consentId: consent.id,
        deniedBy,
        userId: consent.userId,
        reason,
      },
      'Consent denied'
    );

    return { success: true, consent };
  }

  /**
   * Revoke a previously granted consent
   *
   * @param consentId - Consent ID to revoke
   * @param revokedBy - User ID revoking the consent
   * @returns Result of the revoke operation
   */
  async revokeConsent(consentId: string, revokedBy: string): Promise<ConsentGrantResult> {
    if (!this.config.allowRevoke) {
      return { success: false, error: 'Revocation is not allowed' };
    }

    const consent = await this.storage.get(consentId);

    if (!consent) {
      return { success: false, error: 'Consent not found' };
    }

    if (consent.status !== 'granted') {
      return {
        success: false,
        error: `Cannot revoke consent with status ${consent.status}`,
      };
    }

    // Update consent
    consent.revokedAt = Date.now();
    consent.revokedBy = revokedBy;
    consent.status = 'revoked';

    // Re-sign with new status
    if (this.keyPair) {
      consent.signature = await this.signConsent(consent);
    }

    await this.storage.update(consent);

    // Audit log
    await this.audit('consent:revoked', 'Consent revoked', consent);

    this.logger.info(
      {
        consentId: consent.id,
        revokedBy,
        userId: consent.userId,
      },
      'Consent revoked'
    );

    return { success: true, consent };
  }

  /**
   * Get a consent by ID
   */
  async getConsent(consentId: string): Promise<CaptureConsent | null> {
    return this.storage.get(consentId);
  }

  /**
   * Get all pending consents for a user
   */
  async getPendingConsents(userId: string): Promise<CaptureConsent[]> {
    return this.storage.getPending(userId);
  }

  /**
   * Get all active (granted) consents for a user
   */
  async getActiveConsents(userId: string): Promise<CaptureConsent[]> {
    return this.storage.getActive(userId);
  }

  /**
   * Get consent history for a user
   */
  async getConsentHistory(userId: string, limit?: number): Promise<CaptureConsent[]> {
    return this.storage.getHistory(userId, limit);
  }

  /**
   * Verify consent is valid for capture
   * Checks status, expiration, and signature
   */
  async verifyConsent(consentId: string): Promise<{
    valid: boolean;
    consent?: CaptureConsent;
    error?: string;
  }> {
    const consent = await this.storage.get(consentId);

    if (!consent) {
      return { valid: false, error: 'Consent not found' };
    }

    if (consent.status !== 'granted') {
      return {
        valid: false,
        error: `Consent is ${consent.status}, not granted`,
      };
    }

    // Check if expired based on scope duration
    const now = Date.now();
    if (consent.grantedAt) {
      const elapsed = now - consent.grantedAt;
      if (elapsed > consent.scope.duration * 1000) {
        return { valid: false, error: 'Consent duration exceeded' };
      }
    }

    // Verify signature if present
    if (consent.signature && this.keyPair) {
      const valid = await this.verifySignature(consent);
      if (!valid) {
        return { valid: false, error: 'Consent signature invalid' };
      }
    }

    return { valid: true, consent };
  }

  /**
   * Clean up old denied/expired consents
   */
  async cleanup(cutoffTimestamp: number): Promise<number> {
    const count = await this.storage.cleanup(cutoffTimestamp);
    this.logger.debug({ count, cutoffTimestamp }, 'Consent cleanup completed');
    return count;
  }

  /**
   * Dispose of the manager and clean up resources
   */
  dispose(): void {
    // Clear all pending timers
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  /**
   * Handle consent timeout
   */
  private async handleTimeout(consentId: string): Promise<void> {
    const consent = await this.storage.get(consentId);
    if (consent?.status !== 'pending') {
      return;
    }

    consent.status = 'expired';
    await this.storage.update(consent);
    this.pendingTimers.delete(consentId);

    await this.audit('consent:expired', 'Consent expired (timeout)', consent);

    this.logger.info(
      {
        consentId: consent.id,
        userId: consent.userId,
      },
      'Consent expired'
    );
  }

  /**
   * Sign a consent object for integrity
   */
  private async signConsent(consent: CaptureConsent): Promise<string> {
    if (!this.keyPair) {
      throw new Error('No signing key configured');
    }

    const dataToSign = JSON.stringify({
      id: consent.id,
      userId: consent.userId,
      requestedBy: consent.requestedBy,
      requestedAt: consent.requestedAt,
      scope: consent.scope,
      status: consent.status,
      grantedAt: consent.grantedAt,
      grantedBy: consent.grantedBy,
      deniedAt: consent.deniedAt,
      revokedAt: consent.revokedAt,
    });

    // Simple HMAC-based signature for now
    // In production, use proper JWT or JWS signing
    const { createHmac } = await import('crypto');
    const hmac = createHmac('sha256', this.keyPair.privateKey);
    hmac.update(dataToSign);
    return hmac.digest('base64');
  }

  /**
   * Verify consent signature
   */
  private async verifySignature(consent: CaptureConsent): Promise<boolean> {
    if (!this.keyPair || !consent.signature) {
      return false;
    }

    const computed = await this.signConsent(consent);
    return computed === consent.signature;
  }

  /**
   * Log to audit chain
   */
  private async audit(event: string, message: string, consent: CaptureConsent): Promise<void> {
    if (!this.auditChain) {
      return;
    }

    try {
      await this.auditChain.record({
        event,
        level: 'security',
        message,
        userId: consent.userId,
        metadata: {
          consentId: consent.id,
          resource: consent.scope.resource,
          duration: consent.scope.duration,
          purpose: consent.scope.purpose,
          status: consent.status,
          signature: consent.signature ? 'present' : 'absent',
        },
      });
    } catch (error) {
      this.logger.error(
        {
          event,
          consentId: consent.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to write audit log'
      );
    }
  }
}

/**
 * Global consent manager instance
 */
let globalConsentManager: ConsentManager | null = null;

/**
 * Initialize the global consent manager
 */
export function initializeConsentManager(options: ConsentManagerOptions): ConsentManager {
  globalConsentManager = new ConsentManager(options);
  return globalConsentManager;
}

/**
 * Get the global consent manager instance
 */
export function getConsentManager(): ConsentManager {
  if (!globalConsentManager) {
    globalConsentManager = new ConsentManager();
  }
  return globalConsentManager;
}

/**
 * Reset the global consent manager (for testing)
 */
export function resetConsentManager(): void {
  if (globalConsentManager) {
    globalConsentManager.dispose();
  }
  globalConsentManager = null;
}
