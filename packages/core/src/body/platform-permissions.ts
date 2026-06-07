/**
 * Platform Permissions
 *
 * Cross-platform abstraction for screen capture permissions.
 * Integrates with macOS TCC, Windows UAC, and Linux XDG Portals.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_06: Platform TCC Integration
 */

import { platform } from 'node:os';
import type { SecureLogger } from '../logging/logger.js';

export type CapturePermissionType = 'screen' | 'camera' | 'microphone' | 'accessibility';

export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted';

export interface PermissionStatus {
  granted: boolean;
  state: PermissionState;
  canRequest: boolean;
  lastPrompted?: number;
}

export interface PlatformPermissionManager {
  checkPermission(type: CapturePermissionType): Promise<PermissionStatus>;
  requestPermission(type: CapturePermissionType): Promise<PermissionStatus>;
  onPermissionChange(callback: (status: PermissionStatus) => void): void;
  openSystemPreferences(type: CapturePermissionType): Promise<void>;
  isAvailable(): boolean;
}

let globalPermissionManager: PlatformPermissionManager | null = null;

export function getPlatformPermissionManager(): PlatformPermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = createPlatformPermissionManager();
  }
  return globalPermissionManager;
}

export function setPlatformPermissionManager(manager: PlatformPermissionManager): void {
  globalPermissionManager = manager;
}

export function resetPlatformPermissionManager(): void {
  globalPermissionManager = null;
}

function createPlatformPermissionManager(): PlatformPermissionManager {
  const currentPlatform = platform();

  if (currentPlatform === 'darwin') {
    try {
      const { DarwinPermissionManager } = require('./platform/darwin-permissions.js');
      return new DarwinPermissionManager();
    } catch {
      return new NoopPermissionManager();
    }
  }

  if (currentPlatform === 'win32') {
    try {
      const { WindowsPermissionManager } = require('./platform/windows-permissions.js');
      return new WindowsPermissionManager();
    } catch {
      return new NoopPermissionManager();
    }
  }

  if (currentPlatform === 'linux') {
    try {
      const { LinuxPermissionManager } = require('./platform/linux-permissions.js');
      return new LinuxPermissionManager();
    } catch {
      return new NoopPermissionManager();
    }
  }

  return new NoopPermissionManager();
}

class NoopPermissionManager implements PlatformPermissionManager {
  private logger: SecureLogger;

  constructor() {
    try {
      const { getLogger } = require('../logging/logger.js');
      this.logger = getLogger().child({ component: 'NoopPermissionManager' });
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

  isAvailable(): boolean {
    return false;
  }

  async checkPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    this.logger.warn({ type }, 'Platform permission check not available');
    return {
      granted: false,
      state: 'not-determined',
      canRequest: false,
    };
  }

  async requestPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    this.logger.warn({ type }, 'Platform permission request not available');
    return {
      granted: false,
      state: 'denied',
      canRequest: false,
    };
  }

  onPermissionChange(_callback: (status: PermissionStatus) => void): void {
    // No-op
  }

  async openSystemPreferences(type: CapturePermissionType): Promise<void> {
    this.logger.warn({ type }, 'System preferences not available');
  }
}

export function formatPermissionName(type: CapturePermissionType): string {
  const names: Record<CapturePermissionType, string> = {
    screen: 'Screen Recording',
    camera: 'Camera',
    microphone: 'Microphone',
    accessibility: 'Accessibility',
  };
  return names[type] || type;
}

export function getPermissionIcon(type: CapturePermissionType): string {
  const icons: Record<CapturePermissionType, string> = {
    screen: '🖥️',
    camera: '📷',
    microphone: '🎤',
    accessibility: '♿',
  };
  return icons[type] || '🔒';
}
