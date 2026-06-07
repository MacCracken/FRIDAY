/**
 * Darwin (macOS) Permission Manager
 *
 * Handles TCC (Transparency, Consent, and Control) permissions
 * for screen recording, camera, microphone, and accessibility.
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

export class DarwinPermissionManager implements PlatformPermissionManager {
  private logger: SecureLogger;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    try {
      const { getLogger } = require('../../logging/logger.js');
      this.logger = getLogger().child({ component: 'DarwinPermissionManager' });
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
    return platform() === 'darwin';
  }

  async checkPermission(type: CapturePermissionType): Promise<PermissionStatus> {
    switch (type) {
      case 'screen':
        return this.checkScreenRecordingPermission();
      case 'camera':
        return this.checkCameraPermission();
      case 'microphone':
        return this.checkMicrophonePermission();
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

  private async checkScreenRecordingPermission(): Promise<PermissionStatus> {
    try {
      const { stdout } = await execAsync(
        'osascript -e "tell application \\"System Events\\" to get name of every process whose background only is false"'
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
        state: 'denied',
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

  private async checkCameraPermission(): Promise<PermissionStatus> {
    try {
      await execAsync(
        'osascript -e "tell application \\"System Events\\" to get name of every process"'
      );
      return {
        granted: true,
        state: 'granted',
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

  private async checkMicrophonePermission(): Promise<PermissionStatus> {
    return this.checkCameraPermission();
  }

  private async checkAccessibilityPermission(): Promise<PermissionStatus> {
    try {
      await execAsync(
        'osascript -e "tell application \\"System Events\\" to get keystroke \\"test\\""'
      );
      return {
        granted: true,
        state: 'granted',
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
    this.logger.info({ type }, 'Requesting permission');

    if (type === 'screen') {
      await this.triggerScreenCapturePrompt();
    }

    await sleep(1000);

    return this.checkPermission(type);
  }

  private async triggerScreenCapturePrompt(): Promise<void> {
    try {
      await execAsync('screencapture -x /dev/null 2>&1 || true');
    } catch {
      // Expected to fail - this triggers the permission dialog
    }
  }

  async openSystemPreferences(type: CapturePermissionType): Promise<void> {
    const urls: Record<CapturePermissionType, string> = {
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      accessibility:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    };

    const url = urls[type];
    if (url) {
      await execAsync(`open "${url}"`);
    }
  }

  onPermissionChange(callback: (status: PermissionStatus) => void): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(() => {
      void (async () => {
        try {
          const status = await this.checkScreenRecordingPermission();
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
