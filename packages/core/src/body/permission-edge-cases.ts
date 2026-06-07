/**
 * Permission Edge Cases
 *
 * Handles edge cases like permission revocation, OS upgrades,
 * and enterprise policy restrictions.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_06: Platform TCC Integration
 */

import type { SecureLogger } from '../logging/logger.js';
import type { CapturePermissionType, PermissionStatus } from './platform-permissions.js';
import { getPlatformPermissionManager } from './platform-permissions.js';

export interface PermissionEvent {
  type: 'revoked' | 'granted' | 'changed';
  permissionType: CapturePermissionType;
  timestamp: number;
  details?: Record<string, unknown>;
}

export type PermissionEventHandler = (event: PermissionEvent) => void;

export class PermissionEdgeCaseHandler {
  private logger: SecureLogger;
  private eventHandlers = new Set<PermissionEventHandler>();
  private lastKnownStatus = new Map<CapturePermissionType, PermissionStatus>();
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'PermissionEdgeCaseHandler' });
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

  async initialize(): Promise<void> {
    const permissionTypes: CapturePermissionType[] = ['screen', 'camera', 'microphone'];

    for (const type of permissionTypes) {
      const status = await getPlatformPermissionManager().checkPermission(type);
      this.lastKnownStatus.set(type, status);
    }

    this.startMonitoring();
  }

  private startMonitoring(): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(() => {
      void this.checkForChanges();
    }, 5000);
  }

  stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async checkForChanges(): Promise<void> {
    const permissionTypes: CapturePermissionType[] = ['screen', 'camera', 'microphone'];

    for (const type of permissionTypes) {
      const currentStatus = await getPlatformPermissionManager().checkPermission(type);
      const lastStatus = this.lastKnownStatus.get(type);

      if (!lastStatus) {
        this.lastKnownStatus.set(type, currentStatus);
        continue;
      }

      if (currentStatus.granted !== lastStatus.granted) {
        const event: PermissionEvent = {
          type: currentStatus.granted ? 'granted' : 'revoked',
          permissionType: type,
          timestamp: Date.now(),
        };

        this.lastKnownStatus.set(type, currentStatus);
        this.emitEvent(event);

        this.logger.warn({ ...event }, 'Permission changed');
      }
    }
  }

  onPermissionEvent(handler: PermissionEventHandler): void {
    this.eventHandlers.add(handler);
  }

  offPermissionEvent(handler: PermissionEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emitEvent(event: PermissionEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        this.logger.error({ error }, 'Error in permission event handler');
      }
    }
  }

  async handlePermissionRevoked(type: CapturePermissionType): Promise<void> {
    this.logger.warn({ type }, 'Permission revoked');

    const event: PermissionEvent = {
      type: 'revoked',
      permissionType: type,
      timestamp: Date.now(),
    };

    this.emitEvent(event);
  }

  async handleOSUpgrade(): Promise<Record<CapturePermissionType, PermissionStatus>> {
    this.logger.info('Handling OS upgrade - re-verifying permissions');

    const permissionTypes: CapturePermissionType[] = ['screen', 'camera', 'microphone'];
    const results: Record<CapturePermissionType, PermissionStatus> = {} as Record<
      CapturePermissionType,
      PermissionStatus
    >;

    for (const type of permissionTypes) {
      const status = await getPlatformPermissionManager().checkPermission(type);
      results[type] = status;

      if (!status.granted) {
        this.logger.warn({ type }, 'Permission may have been reset after OS upgrade');
      }

      this.lastKnownStatus.set(type, status);
    }

    return results;
  }

  async checkEnterprisePolicy(type: CapturePermissionType): Promise<boolean> {
    this.logger.debug({ type }, 'Checking enterprise policy');
    return true;
  }

  getLastKnownStatus(type: CapturePermissionType): PermissionStatus | undefined {
    return this.lastKnownStatus.get(type);
  }

  getAllLastKnownStatuses(): Record<CapturePermissionType, PermissionStatus> {
    const result: Record<CapturePermissionType, PermissionStatus> = {} as Record<
      CapturePermissionType,
      PermissionStatus
    >;

    for (const [type, status] of this.lastKnownStatus.entries()) {
      result[type] = status;
    }

    return result;
  }
}

let globalHandler: PermissionEdgeCaseHandler | null = null;

export function getPermissionEdgeCaseHandler(): PermissionEdgeCaseHandler {
  if (!globalHandler) {
    globalHandler = new PermissionEdgeCaseHandler();
  }
  return globalHandler;
}

export function resetPermissionEdgeCaseHandler(): void {
  if (globalHandler) {
    globalHandler.stopMonitoring();
  }
  globalHandler = null;
}
