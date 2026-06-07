/**
 * Permission Orchestrator
 *
 * Coordinates the full permission flow: RBAC → Platform → User Consent.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_06: Platform TCC Integration
 */

import type { SecureLogger } from '../logging/logger.js';
import type { CaptureScope, CaptureResource } from './types.js';
import type {
  CapturePermissionType,
  PermissionStatus,
  PlatformPermissionManager,
} from './platform-permissions.js';
import { getPlatformPermissionManager } from './platform-permissions.js';

export type PermissionDeniedReason =
  | 'RBAC_DENIED'
  | 'PLATFORM_DENIED'
  | 'USER_DENIED'
  | 'NOT_DETERMINED';

export interface CaptureContext {
  userId: string;
  roleId: string;
  purpose?: string;
  scope?: CaptureScope;
}

export interface PermissionResult {
  granted: boolean;
  reason?: PermissionDeniedReason;
  consentId?: string;
  platformStatus?: PermissionStatus;
  details?: Record<string, unknown>;
}

interface ConsentRequest {
  resource: CaptureResource;
  purpose: string;
  scope: CaptureScope;
}

interface ConsentResult {
  id: string;
  status: string;
}

interface SimpleConsentManager {
  requestConsent(userId: string, request: ConsentRequest): Promise<ConsentResult>;
}

export class PermissionOrchestrator {
  private platformManager: PlatformPermissionManager;
  private consentManager: SimpleConsentManager | null = null;
  private logger: SecureLogger;

  constructor(platformManager?: PlatformPermissionManager, consentManager?: SimpleConsentManager) {
    this.platformManager = platformManager || getPlatformPermissionManager();
    this.consentManager = consentManager || null;

    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'PermissionOrchestrator' });
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

  setConsentManager(manager: SimpleConsentManager): void {
    this.consentManager = manager;
  }

  async ensurePermission(
    type: CapturePermissionType,
    context: CaptureContext
  ): Promise<PermissionResult> {
    this.logger.info({ type, userId: context.userId }, 'Checking permission');

    const platformStatus = await this.platformManager.checkPermission(type);

    if (!platformStatus.granted) {
      if (platformStatus.canRequest) {
        const newStatus = await this.platformManager.requestPermission(type);
        if (!newStatus.granted) {
          return {
            granted: false,
            reason: 'PLATFORM_DENIED',
            platformStatus: newStatus,
          };
        }
        return this.requestUserConsent(type, context, newStatus);
      }

      return {
        granted: false,
        reason: 'NOT_DETERMINED',
        platformStatus,
      };
    }

    return this.requestUserConsent(type, context, platformStatus);
  }

  private async requestUserConsent(
    type: CapturePermissionType,
    context: CaptureContext,
    platformStatus: PermissionStatus
  ): Promise<PermissionResult> {
    if (!this.consentManager) {
      return {
        granted: true,
        platformStatus,
      };
    }

    const resource: CaptureResource = type === 'screen' ? 'capture.screen' : 'capture.screen';
    const scope = context.scope || this.createDefaultScope();

    try {
      const consent = await this.consentManager.requestConsent(context.userId, {
        resource,
        purpose: context.purpose || 'Screen capture',
        scope,
      });

      if (consent.status === 'granted') {
        return {
          granted: true,
          consentId: consent.id,
          platformStatus,
        };
      }

      return {
        granted: false,
        reason: 'USER_DENIED',
        platformStatus,
        details: { consentStatus: consent.status },
      };
    } catch (error) {
      this.logger.error({ error }, 'Consent request failed');
      return {
        granted: false,
        reason: 'USER_DENIED',
        platformStatus,
        details: { error: String(error) },
      };
    }
  }

  private createDefaultScope(): CaptureScope {
    return {
      resource: 'capture.screen',
      duration: { maxSeconds: 300 },
      quality: {
        resolution: '1080p',
        frameRate: 30,
        compression: 'medium',
        format: 'png',
      },
      purpose: 'screen-capture',
    };
  }

  async checkPlatformPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    return this.platformManager.checkPermission(type);
  }

  async requestPlatformPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    return this.platformManager.requestPermission(type);
  }

  async openSystemPreferences(type: CapturePermissionType): Promise<void> {
    return this.platformManager.openSystemPreferences(type);
  }

  onPlatformPermissionChange(callback: (status: PermissionStatus) => void): void {
    this.platformManager.onPermissionChange(callback);
  }
}

let globalOrchestrator: PermissionOrchestrator | null = null;

export function getPermissionOrchestrator(): PermissionOrchestrator {
  if (!globalOrchestrator) {
    globalOrchestrator = new PermissionOrchestrator();
  }
  return globalOrchestrator;
}

export function setPermissionOrchestrator(orchestrator: PermissionOrchestrator): void {
  globalOrchestrator = orchestrator;
}

export function resetPermissionOrchestrator(): void {
  globalOrchestrator = null;
}
