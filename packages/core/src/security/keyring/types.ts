/**
 * Keyring Types — Interfaces for system keyring integration.
 */

export interface KeyringProvider {
  readonly name: string;
  isAvailable(): boolean;
  get(service: string, key: string): string | undefined;
  set(service: string, key: string, value: string): void;
  delete(service: string, key: string): void;
}

export type SecretBackend = 'auto' | 'keyring' | 'env' | 'file';

export const SERVICE_NAME = 'secureyeoman';
