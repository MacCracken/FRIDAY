/**
 * Secret Rotation Manager — tracks secrets, auto-rotates internal ones,
 * warns on expiring external secrets.
 */

import { randomBytes } from 'node:crypto';
import type { SecretMetadata, RotationStatus } from './types.js';
import { RotationStorage } from './rotation-storage.js';

const MS_PER_DAY = 86_400_000;

export interface RotationManagerConfig {
  checkIntervalMs: number;
  warningDaysBeforeExpiry: number;
}

export interface RotationCallbacks {
  onRotate?: (name: string, newValue: string) => void | Promise<void>;
  onWarning?: (name: string, daysLeft: number) => void | Promise<void>;
}

export class SecretRotationManager {
  private readonly storage: RotationStorage;
  private readonly config: RotationManagerConfig;
  private callbacks: RotationCallbacks = {};
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(storage: RotationStorage, config: RotationManagerConfig) {
    this.storage = storage;
    this.config = config;
  }

  /**
   * Register rotation callbacks.
   */
  setCallbacks(cb: RotationCallbacks): void {
    this.callbacks = cb;
  }

  /**
   * Track a secret by upserting its metadata.
   */
  trackSecret(meta: SecretMetadata): void {
    this.storage.upsert(meta);
  }

  /**
   * Get the rotation status of all tracked secrets.
   */
  getStatus(): RotationStatus[] {
    const all = this.storage.getAll();
    const now = Date.now();

    return all.map((m) => {
      let status: RotationStatus['status'] = 'ok';
      let daysUntilExpiry: number | null = null;

      if (m.expiresAt !== null) {
        daysUntilExpiry = Math.ceil((m.expiresAt - now) / MS_PER_DAY);
        if (daysUntilExpiry <= 0) {
          status = 'expired';
        } else if (daysUntilExpiry <= this.config.warningDaysBeforeExpiry) {
          status = 'expiring_soon';
        }
      }

      // Check if rotation is due for auto-rotate secrets
      if (
        m.autoRotate &&
        m.rotationIntervalDays !== null &&
        status !== 'expired'
      ) {
        const lastRotation = m.rotatedAt ?? m.createdAt;
        const daysSinceRotation = (now - lastRotation) / MS_PER_DAY;
        if (daysSinceRotation >= m.rotationIntervalDays) {
          status = 'rotation_due';
        }
      }

      return {
        name: m.name,
        status,
        daysUntilExpiry,
        lastRotatedAt: m.rotatedAt,
        autoRotate: m.autoRotate,
      };
    });
  }

  /**
   * Check all secrets and auto-rotate those that are due.
   */
  async checkAndRotate(): Promise<void> {
    const statuses = this.getStatus();

    for (const s of statuses) {
      if (s.status === 'rotation_due' && s.autoRotate) {
        await this.rotateSecret(s.name);
      } else if (
        s.status === 'expiring_soon' &&
        s.daysUntilExpiry !== null
      ) {
        await this.callbacks.onWarning?.(s.name, s.daysUntilExpiry);
      }
    }
  }

  /**
   * Rotate a specific secret: generate new value, store old for grace period,
   * invoke onRotate callback.
   */
  async rotateSecret(name: string): Promise<string> {
    const meta = this.storage.get(name);
    if (!meta) {
      throw new Error(`Secret not tracked: ${name}`);
    }

    // Get current value from env (it's pre-loaded there by keyring)
    const currentValue = process.env[name];

    // Generate a new random secret
    const newValue = randomBytes(32).toString('base64url');

    // Store old value for grace period
    if (currentValue) {
      const gracePeriodMs = meta.category === 'jwt'
        ? 3600_000 // 1 hour grace for JWT (token expiry)
        : 300_000; // 5 minutes for other secrets
      this.storage.storePreviousValue(name, currentValue, gracePeriodMs);
    }

    // Update env with new value
    process.env[name] = newValue;

    // Update metadata
    const now = Date.now();
    const newExpiresAt = meta.rotationIntervalDays
      ? now + meta.rotationIntervalDays * MS_PER_DAY
      : null;
    this.storage.updateRotation(name, now, newExpiresAt);

    // Notify consumers
    await this.callbacks.onRotate?.(name, newValue);

    return newValue;
  }

  /**
   * Get the previous value for a secret (during grace period).
   */
  getPreviousValue(name: string): string | null {
    return this.storage.getPreviousValue(name);
  }

  /**
   * Start periodic rotation checks.
   */
  start(): void {
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(() => {
      void this.checkAndRotate();
    }, this.config.checkIntervalMs);

    // Don't block process exit
    this.intervalHandle.unref();
  }

  /**
   * Stop periodic checks.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
