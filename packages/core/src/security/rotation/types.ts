/**
 * Secret Rotation Types
 */

export interface SecretMetadata {
  name: string;
  createdAt: number;
  expiresAt: number | null;
  rotatedAt: number | null;
  rotationIntervalDays: number | null;
  autoRotate: boolean;
  source: 'internal' | 'external';
  category: 'jwt' | 'audit_signing' | 'api_key' | 'admin' | 'encryption';
}

export interface RotationStatus {
  name: string;
  status: 'ok' | 'expiring_soon' | 'expired' | 'rotation_due';
  daysUntilExpiry: number | null;
  lastRotatedAt: number | null;
  autoRotate: boolean;
}
