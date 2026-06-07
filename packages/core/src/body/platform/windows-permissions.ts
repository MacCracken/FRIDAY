/**
 * Windows Permission Manager
 *
 * Handles Windows UAC and UWP permissions for screen capture,
 * camera, and microphone access.
 *
 * @see ADR 014: Screen Capture Security Architecture
 * @see NEXT_STEP_06: Platform TCC Integration
 */

import { platform } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { SecureLogger } from '../../logging/logger.js';
import { sleep } from '../../utils/sleep.js';
import type {
  CapturePermissionType,
  PermissionStatus,
  PlatformPermissionManager,
} from '../platform-permissions.js';

const execAsync = promisify(exec);

export class WindowsPermissionManager implements PlatformPermissionManager {
  private logger: SecureLogger;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    try {
      const { getLogger } = require('../../logging/logger.js');
      this.logger = getLogger().child({ component: 'WindowsPermissionManager' });
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
    return platform() === 'win32';
  }

  async checkPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    switch (type) {
      case 'screen':
        return this.checkScreenCapturePermission();
      case 'camera':
        return this.checkMediaDevicePermission('camera');
      case 'microphone':
        return this.checkMediaDevicePermission('microphone');
      case 'accessibility':
        return this.checkAccessibilityPermission();
      default:
        return {
          granted: false,
          state: 'denied',
          canRequest: false,
        };
    }
  }

  private async checkScreenCapturePermission(): Promise<PermissionStatus> {
    try {
      const { stdout } = await execAsync(
        'powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens"'
      );

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

  private async checkMediaDevicePermission(
    device: 'camera' | 'microphone'
  ): Promise<PermissionStatus> {
    try {
      const cmdlet =
        device === 'camera'
          ? 'Get-PnpDevice -Class Camera -Status OK'
          : 'Get-PnpDevice -Class AudioEndpoint -Status OK';

      const { stdout } = await execAsync(`powershell -Command "${cmdlet}"`);

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

  private async checkAccessibilityPermission(): Promise<PermissionStatus> {
    return {
      granted: false,
      state: 'not-determined',
      canRequest: true,
    };
  }

  async requestPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    this.logger.info({ type }, 'Requesting permission');

    if (type === 'screen') {
      await this.showScreenCaptureInstructions();
    }

    await sleep(500);

    return this.checkPermission(type);
  }

  private async showScreenCaptureInstructions(): Promise<void> {
    this.logger.info('Windows does not have direct screen capture permission prompt');
    await this.openSystemPreferences('screen');
  }

  async openSystemPreferences(type: CapturePermissionType): Promise<void> {
    const commands: Record<CapturePermissionType, string> = {
      screen: 'ms-settings:privacy-screencapture',
      camera: 'ms-settings:privacy-webcam',
      microphone: 'ms-settings:privacy-microphone',
      accessibility: 'ms-settings:easeofaccess-eyecontrol',
    };

    const command = commands[type];
    if (command) {
      try {
        await execAsync(`start ${command}`);
      } catch {
        // Try alternative
        await execAsync(`start ms-settings:`);
      }
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
}
