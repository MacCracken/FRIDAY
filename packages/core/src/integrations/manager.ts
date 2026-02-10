/**
 * IntegrationManager — Manages platform integration lifecycle.
 *
 * Handles registration, start/stop, health tracking, and config CRUD
 * for all platform adapters (Telegram, Discord, Slack, etc.)
 */

import type {
  IntegrationConfig,
  IntegrationCreate,
  IntegrationUpdate,
  Platform,
} from '@friday/shared';
import type { IntegrationStorage } from './storage.js';
import type { Integration, IntegrationDeps, IntegrationRegistryEntry } from './types.js';
import type { SecureLogger } from '../logging/logger.js';

export interface IntegrationManagerDeps {
  logger: SecureLogger;
  onMessage: IntegrationDeps['onMessage'];
}

export class IntegrationManager {
  private readonly storage: IntegrationStorage;
  private readonly deps: IntegrationManagerDeps;
  private readonly registry = new Map<string, IntegrationRegistryEntry>();
  private readonly factories = new Map<Platform, () => Integration>();

  constructor(storage: IntegrationStorage, deps: IntegrationManagerDeps) {
    this.storage = storage;
    this.deps = deps;
  }

  // ── Factory Registration ─────────────────────────────────

  /**
   * Register a factory function for a platform.
   * Called during startup to make platforms available.
   */
  registerPlatform(platform: Platform, factory: () => Integration): void {
    this.factories.set(platform, factory);
    this.deps.logger.info(`Registered integration platform: ${platform}`);
  }

  getAvailablePlatforms(): Platform[] {
    return [...this.factories.keys()];
  }

  // ── Config CRUD ──────────────────────────────────────────

  createIntegration(data: IntegrationCreate): IntegrationConfig {
    if (!this.factories.has(data.platform)) {
      throw new Error(`Platform "${data.platform}" is not registered`);
    }
    return this.storage.createIntegration(data);
  }

  getIntegration(id: string): IntegrationConfig | null {
    return this.storage.getIntegration(id);
  }

  listIntegrations(filter?: { platform?: Platform; enabled?: boolean }): IntegrationConfig[] {
    return this.storage.listIntegrations(filter);
  }

  updateIntegration(id: string, data: IntegrationUpdate): IntegrationConfig | null {
    return this.storage.updateIntegration(id, data);
  }

  deleteIntegration(id: string): boolean {
    // Stop if running
    const entry = this.registry.get(id);
    if (entry) {
      void this.stopIntegration(id);
    }
    return this.storage.deleteIntegration(id);
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Start a specific integration.
   * Creates the adapter instance, initializes, and starts listening.
   */
  async startIntegration(id: string): Promise<void> {
    const config = this.storage.getIntegration(id);
    if (!config) throw new Error(`Integration ${id} not found`);
    if (!config.enabled) throw new Error(`Integration ${id} is disabled`);

    // Already running?
    if (this.registry.has(id)) {
      this.deps.logger.warn(`Integration ${id} is already running`);
      return;
    }

    const factory = this.factories.get(config.platform);
    if (!factory) throw new Error(`No adapter registered for platform "${config.platform}"`);

    const integration = factory();
    const entry: IntegrationRegistryEntry = {
      integration,
      config,
      healthy: false,
    };

    try {
      await integration.init(config, {
        logger: this.deps.logger.child({ integration: id, platform: config.platform }),
        onMessage: this.deps.onMessage,
      });

      await integration.start();

      entry.healthy = true;
      entry.startedAt = Date.now();
      this.registry.set(id, entry);
      this.storage.updateStatus(id, 'connected');

      this.deps.logger.info(`Integration started: ${config.displayName} (${config.platform})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.storage.updateStatus(id, 'error', message);
      this.deps.logger.error(`Failed to start integration ${id}: ${message}`);
      throw err;
    }
  }

  /**
   * Stop a specific integration.
   */
  async stopIntegration(id: string): Promise<void> {
    const entry = this.registry.get(id);
    if (!entry) return;

    try {
      await entry.integration.stop();
    } catch (err) {
      this.deps.logger.error(`Error stopping integration ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.registry.delete(id);
    this.storage.updateStatus(id, 'disconnected');
    this.deps.logger.info(`Integration stopped: ${id}`);
  }

  /**
   * Start all enabled integrations.
   * Called during system startup.
   */
  async startAll(): Promise<void> {
    const enabled = this.storage.listIntegrations({ enabled: true });
    for (const config of enabled) {
      try {
        await this.startIntegration(config.id);
      } catch (err) {
        // Log but don't fail startup for one bad integration
        this.deps.logger.error(`Failed to auto-start integration ${config.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Stop all running integrations.
   * Called during system shutdown.
   */
  async stopAll(): Promise<void> {
    const ids = [...this.registry.keys()];
    for (const id of ids) {
      await this.stopIntegration(id);
    }
  }

  // ── Health ───────────────────────────────────────────────

  isRunning(id: string): boolean {
    return this.registry.has(id);
  }

  isHealthy(id: string): boolean {
    const entry = this.registry.get(id);
    return entry?.integration.isHealthy() ?? false;
  }

  getRunningCount(): number {
    return this.registry.size;
  }

  // ── Send Message ─────────────────────────────────────────

  async sendMessage(integrationId: string, chatId: string, text: string, metadata?: Record<string, unknown>): Promise<string> {
    const entry = this.registry.get(integrationId);
    if (!entry) throw new Error(`Integration ${integrationId} is not running`);

    const platformMessageId = await entry.integration.sendMessage(chatId, text, metadata);

    this.storage.storeMessage({
      integrationId,
      platform: entry.config.platform,
      direction: 'outbound',
      senderId: 'agent',
      senderName: 'FRIDAY',
      chatId,
      text,
      attachments: [],
      metadata: metadata ?? {},
      platformMessageId,
      timestamp: Date.now(),
    });

    return platformMessageId;
  }

  // ── Cleanup ──────────────────────────────────────────────

  async close(): Promise<void> {
    await this.stopAll();
    this.storage.close();
  }
}
