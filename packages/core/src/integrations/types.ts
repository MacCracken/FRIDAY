/**
 * Integration Types (Core-internal)
 *
 * Defines the Integration interface that every platform adapter must implement,
 * and the PlatformAdapter contract for normalizing messages.
 */

import type {
  IntegrationConfig,
  IntegrationCreate,
  UnifiedMessage,
  Platform,
} from '@friday/shared';
import type { SecureLogger } from '../logging/logger.js';

// ─── Integration Lifecycle ───────────────────────────────────

/**
 * Every platform adapter implements this interface.
 * The IntegrationManager calls init → start → (runtime) → stop.
 */
export interface Integration {
  /** Unique platform identifier */
  readonly platform: Platform;

  /** Initialize the adapter (validate config, create SDK clients, etc.) */
  init(config: IntegrationConfig, deps: IntegrationDeps): Promise<void>;

  /** Start listening for inbound messages */
  start(): Promise<void>;

  /** Stop listening and clean up resources */
  stop(): Promise<void>;

  /** Send a message back to the platform */
  sendMessage(chatId: string, text: string, metadata?: Record<string, unknown>): Promise<string>;

  /** Check if the adapter is healthy */
  isHealthy(): boolean;
}

// ─── Platform Adapter ────────────────────────────────────────

/**
 * Normalizes platform-specific message formats into UnifiedMessage
 * and converts outbound UnifiedMessages back to platform-specific payloads.
 */
export interface PlatformAdapter {
  /** Normalize a raw inbound payload into a UnifiedMessage */
  normalizeInbound(raw: unknown): UnifiedMessage;

  /** Format an outbound message for the platform */
  formatOutbound(message: UnifiedMessage): unknown;
}

// ─── Dependencies ────────────────────────────────────────────

export interface IntegrationDeps {
  logger: SecureLogger;
  onMessage: (message: UnifiedMessage) => Promise<void>;
}

// ─── Integration Registry Entry ──────────────────────────────

export interface IntegrationRegistryEntry {
  integration: Integration;
  config: IntegrationConfig;
  healthy: boolean;
  startedAt?: number;
}
