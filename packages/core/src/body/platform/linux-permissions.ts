/**
 * Linux Permission Manager
 *
 * Handles XDG Desktop Portal permissions for screen capture
 * on Wayland and X11.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_06: Platform TCC Integration
 */

import { platform } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecureLogger } from '../../logging/logger.js';
import type {
  CapturePermissionType,
  PermissionStatus,
  PlatformPermissionManager,
} from '../platform-permissions.js';

const execAsync = promisify(exec);

export class LinuxPermissionManager implements PlatformPermissionManager {
  private logger: SecureLogger;
  private usePortal: boolean;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    try {
      const { getLogger } = require('../../logging/logger.js');
      this.logger = getLogger().child({ component: 'LinuxPermissionManager' });
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

    this.usePortal = process.env.WAYLAND_DISPLAY !== undefined;
    this.logger.info({ usePortal: this.usePortal }, 'Linux permission manager initialized');
  }

  isAvailable(): boolean {
    return platform() === 'linux';
  }

  async checkPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    if (type === 'screen') {
      return this.checkScreenCapturePermission();
    }

    if (type === 'camera' || type === 'microphone') {
      return this.checkMediaDevicePermission(type);
    }

    return {
      granted: false,
      state: 'not-determined',
      canRequest: true,
    };
  }

  private async checkScreenCapturePermission(): Promise<PermissionStatus> {
    if (this.usePortal) {
      return this.checkPortalPermission();
    }

    return this.checkX11Permission();
  }

  private async checkPortalPermission(): Promise<PermissionStatus> {
    try {
      const { stdout } = await execAsync('busctl --user list 2>/dev/null | grep -q portal');

      if (stdout !== undefined) {
        return {
          granted: true,
          state: 'granted',
          canRequest: true,
        };
      }

      return {
        granted: false,
        state: 'not-determined',
        canRequest: true,
      };
    } catch {
      return {
        granted: false,
        state: 'not-determined',
        canRequest: true,
      };
    }
  }

  private async checkX11Permission(): Promise<PermissionStatus> {
    try {
      const display = process.env.DISPLAY;
      if (!display) {
        return {
          granted: false,
          state: 'denied',
          canRequest: false,
        };
      }

      return {
        granted: true,
        state: 'granted',
        canRequest: false,
      };
    } catch {
      return {
        granted: false,
        state: 'denied',
        canRequest: false,
      };
    }
  }

  private async checkMediaDevicePermission(
    type: 'camera' | 'microphone'
  ): Promise<PermissionStatus> {
    try {
      const devicePath = type === 'camera' ? '/dev/video0' : '/dev/snd/';
      const { stdout } = await execAsync(`ls ${devicePath}* 2>/dev/null | head -1`);

      if (stdout && stdout.length > 0) {
        return {
          granted: true,
          state: 'granted',
          canRequest: true,
        };
      }

      return {
        granted: false,
        state: 'not-determined',
        canRequest: true,
      };
    } catch {
      return {
        granted: false,
        state: 'denied',
        canRequest: true,
      };
    }
  }

  async requestPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    this.logger.info({ type, usePortal: this.usePortal }, 'Requesting permission');

    if (type === 'screen') {
      if (!this.usePortal) {
        this.logger.info('X11 does not require permission request');
        return this.checkPermission(type);
      }

      return this.requestPortalPermission();
    }

    return this.checkPermission(type);
  }

  private async requestPortalPermission(): Promise<PermissionStatus> {
    try {
      await execAsync('xdg-desktop-portal --version 2>/dev/null');

      return {
        granted: true,
        state: 'granted',
        canRequest: true,
      };
    } catch {
      this.logger.warn('xdg-desktop-portal not available');
      return {
        granted: false,
        state: 'denied',
        canRequest: false,
      };
    }
  }

  async openSystemPreferences(_type: CapturePermissionType): Promise<void> {
    if (this.usePortal) {
      await execAsync('xdg-open https://help.ubuntu.com/stable/ubuntu-help/shell-apps.html');
    } else {
      await execAsync('xdg-open https://help.ubuntu.com/');
    }
  }

  onPermissionChange(callback: (status: PermissionStatus) => void): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(() => {
      void (async () => {
        try {
          const status = await this.checkScreenCapturePermission();
          callback(status);
        } catch {
          // Ignore errors
        }
      })();
    }, 5000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  isUsingPortal(): boolean {
    return this.usePortal;
  }
}
