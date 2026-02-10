import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RotationStorage } from './rotation-storage.js';
import { SecretRotationManager } from './manager.js';
import type { SecretMetadata } from './types.js';
import { AuthService } from '../auth.js';
import { AuthStorage } from '../auth-storage.js';
import { AuditChain, InMemoryAuditStorage } from '../../logging/audit-chain.js';
import { RBAC } from '../rbac.js';
import { RateLimiter } from '../rate-limiter.js';
import type { SecureLogger } from '../../logging/logger.js';

const SIGNING_KEY = 'a]&3Gk9$mQ#vL7@pR!wZ5*xN2^bT8+dF';
const TOKEN_SECRET = 'test-token-secret-at-least-32chars!!';
const ADMIN_PASSWORD = 'test-admin-password-32chars!!';

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  };
}

function makeMeta(overrides: Partial<SecretMetadata> = {}): SecretMetadata {
  return {
    name: 'TEST_SECRET',
    createdAt: Date.now(),
    expiresAt: null,
    rotatedAt: null,
    rotationIntervalDays: null,
    autoRotate: false,
    source: 'external',
    category: 'encryption',
    ...overrides,
  };
}

// ── RotationStorage ─────────────────────────────────────────────────

describe('RotationStorage', () => {
  let storage: RotationStorage;

  beforeEach(() => {
    storage = new RotationStorage();
  });

  afterEach(() => {
    storage.close();
  });

  it('upsert and get secret metadata', () => {
    const meta = makeMeta({ name: 'MY_KEY' });
    storage.upsert(meta);
    const result = storage.get('MY_KEY');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('MY_KEY');
    expect(result!.autoRotate).toBe(false);
  });

  it('getAll returns all tracked secrets', () => {
    storage.upsert(makeMeta({ name: 'A' }));
    storage.upsert(makeMeta({ name: 'B' }));
    storage.upsert(makeMeta({ name: 'C' }));
    expect(storage.getAll()).toHaveLength(3);
  });

  it('upsert updates existing entry', () => {
    storage.upsert(makeMeta({ name: 'X', autoRotate: false }));
    storage.upsert(makeMeta({ name: 'X', autoRotate: true }));
    const result = storage.get('X');
    expect(result!.autoRotate).toBe(true);
  });

  it('updateRotation changes rotatedAt and expiresAt', () => {
    storage.upsert(makeMeta({ name: 'R' }));
    const now = Date.now();
    storage.updateRotation('R', now, now + 86400000);
    const result = storage.get('R');
    expect(result!.rotatedAt).toBe(now);
    expect(result!.expiresAt).toBe(now + 86400000);
  });

  it('storePreviousValue and getPreviousValue', () => {
    storage.storePreviousValue('S', 'old-value', 60000);
    expect(storage.getPreviousValue('S')).toBe('old-value');
  });

  it('getPreviousValue returns null for expired values', () => {
    // Store with 0ms grace period (already expired)
    storage.storePreviousValue('S', 'old-value', -1);
    expect(storage.getPreviousValue('S')).toBeNull();
  });

  it('clearPreviousValue removes the stored value', () => {
    storage.storePreviousValue('S', 'old-value', 60000);
    storage.clearPreviousValue('S');
    expect(storage.getPreviousValue('S')).toBeNull();
  });

  it('get returns null for non-existent key', () => {
    expect(storage.get('NONEXISTENT')).toBeNull();
  });
});

// ── SecretRotationManager ───────────────────────────────────────────

describe('SecretRotationManager', () => {
  let storage: RotationStorage;
  let manager: SecretRotationManager;

  beforeEach(() => {
    storage = new RotationStorage();
    manager = new SecretRotationManager(storage, {
      checkIntervalMs: 60000,
      warningDaysBeforeExpiry: 7,
    });
  });

  afterEach(() => {
    manager.stop();
    storage.close();
  });

  it('trackSecret stores metadata', () => {
    manager.trackSecret(makeMeta({ name: 'TRACKED' }));
    expect(storage.get('TRACKED')).not.toBeNull();
  });

  it('getStatus returns "ok" for non-expiring secret', () => {
    manager.trackSecret(makeMeta({ name: 'OK_SECRET' }));
    const statuses = manager.getStatus();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe('ok');
  });

  it('getStatus returns "expired" for past-expiry secret', () => {
    manager.trackSecret(makeMeta({
      name: 'EXPIRED',
      expiresAt: Date.now() - 86400000,
    }));
    const statuses = manager.getStatus();
    expect(statuses[0].status).toBe('expired');
  });

  it('getStatus returns "expiring_soon" when within warning window', () => {
    manager.trackSecret(makeMeta({
      name: 'EXPIRING',
      expiresAt: Date.now() + 3 * 86400000, // 3 days, warning is 7
    }));
    const statuses = manager.getStatus();
    expect(statuses[0].status).toBe('expiring_soon');
    expect(statuses[0].daysUntilExpiry).toBeLessThanOrEqual(4);
  });

  it('getStatus returns "rotation_due" for overdue auto-rotate secret', () => {
    manager.trackSecret(makeMeta({
      name: 'DUE',
      autoRotate: true,
      rotationIntervalDays: 1,
      createdAt: Date.now() - 2 * 86400000, // created 2 days ago
      expiresAt: Date.now() + 86400000,
    }));
    const statuses = manager.getStatus();
    expect(statuses[0].status).toBe('rotation_due');
  });

  it('rotateSecret generates new value and stores previous', async () => {
    const envKey = '__ROTATE_TEST__';
    process.env[envKey] = 'old-secret';

    manager.trackSecret(makeMeta({
      name: envKey,
      autoRotate: true,
      rotationIntervalDays: 1,
      category: 'encryption',
    }));

    const newValue = await manager.rotateSecret(envKey);
    expect(newValue).toBeDefined();

    // Previous value should be stored
    expect(manager.getPreviousValue(envKey)).toBe('old-secret');

    // Env should have new value
    expect(process.env[envKey]).not.toBe('old-secret');

    delete process.env[envKey];
  });

  it('rotateSecret throws for untracked secret', async () => {
    await expect(manager.rotateSecret('UNKNOWN')).rejects.toThrow('Secret not tracked');
  });

  it('checkAndRotate auto-rotates due secrets', async () => {
    const envKey = '__AUTO_ROTATE_TEST__';
    process.env[envKey] = 'auto-old';

    const onRotate = vi.fn();
    manager.setCallbacks({ onRotate });

    manager.trackSecret(makeMeta({
      name: envKey,
      autoRotate: true,
      rotationIntervalDays: 1,
      createdAt: Date.now() - 2 * 86400000,
      expiresAt: Date.now() + 86400000,
    }));

    await manager.checkAndRotate();
    expect(onRotate).toHaveBeenCalledOnce();
    expect(onRotate.mock.calls[0][0]).toBe(envKey);

    delete process.env[envKey];
  });

  it('checkAndRotate fires onWarning for expiring external secrets', async () => {
    const onWarning = vi.fn();
    manager.setCallbacks({ onWarning });

    manager.trackSecret(makeMeta({
      name: 'WARN_SECRET',
      expiresAt: Date.now() + 3 * 86400000,
    }));

    await manager.checkAndRotate();
    expect(onWarning).toHaveBeenCalledOnce();
  });

  it('start and stop manage interval', () => {
    manager.start();
    manager.start(); // idempotent
    manager.stop();
    manager.stop(); // idempotent
  });
});

// ── Grace period: JWT dual-key verification ─────────────────────────

describe('JWT dual-key verification (grace period)', () => {
  let authService: AuthService;
  let authStorage: AuthStorage;

  beforeEach(async () => {
    authStorage = new AuthStorage();
    const auditStorage = new InMemoryAuditStorage();
    const auditChain = new AuditChain({ storage: auditStorage, signingKey: SIGNING_KEY });
    await auditChain.initialize();

    authService = new AuthService(
      {
        tokenSecret: TOKEN_SECRET,
        tokenExpirySeconds: 3600,
        refreshTokenExpirySeconds: 86400,
        adminPassword: ADMIN_PASSWORD,
      },
      {
        storage: authStorage,
        auditChain,
        rbac: new RBAC(),
        rateLimiter: new RateLimiter({ defaultWindowMs: 60000, defaultMaxRequests: 100 }),
        logger: noopLogger(),
      },
    );
  });

  afterEach(() => {
    authStorage.close();
  });

  it('tokens signed with old key still validate after rotation', async () => {
    // Login with original secret
    const result = await authService.login(ADMIN_PASSWORD, '127.0.0.1');
    const token = result.accessToken;

    // Rotate to new secret
    authService.updateTokenSecret('brand-new-secret-that-is-32-chars!!');

    // Old token should still validate via previousSecret
    const user = await authService.validateToken(token);
    expect(user.userId).toBe('admin');
  });

  it('after clearPreviousSecret, old tokens fail', async () => {
    const result = await authService.login(ADMIN_PASSWORD, '127.0.0.1');
    const token = result.accessToken;

    authService.updateTokenSecret('brand-new-secret-that-is-32-chars!!');
    authService.clearPreviousSecret();

    await expect(authService.validateToken(token)).rejects.toThrow('Invalid or expired token');
  });

  it('new tokens work after rotation', async () => {
    authService.updateTokenSecret('brand-new-secret-that-is-32-chars!!');

    const result = await authService.login(ADMIN_PASSWORD, '127.0.0.1');
    const user = await authService.validateToken(result.accessToken);
    expect(user.userId).toBe('admin');
  });
});

// ── Audit chain multi-key verification ──────────────────────────────

describe('AuditChain multi-key verification', () => {
  it('verify succeeds after signing key rotation', async () => {
    const storage = new InMemoryAuditStorage();
    const chain = new AuditChain({ storage, signingKey: SIGNING_KEY });
    await chain.initialize();

    // Record entries with original key
    await chain.record({ event: 'test_1', level: 'info', message: 'Before rotation' });
    await chain.record({ event: 'test_2', level: 'info', message: 'Before rotation 2' });

    // Rotate key (this records a rotation event signed with old key)
    const newKey = 'new-signing-key-that-is-at-least-32-characters!!';
    await chain.updateSigningKey(newKey);

    // Record entries with new key
    await chain.record({ event: 'test_3', level: 'info', message: 'After rotation' });
    await chain.record({ event: 'test_4', level: 'info', message: 'After rotation 2' });

    // Verify entire chain
    const result = await chain.verify();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5); // 2 + 1 rotation event + 2
  });

  it('verify succeeds after multiple rotations', async () => {
    const storage = new InMemoryAuditStorage();
    const chain = new AuditChain({ storage, signingKey: SIGNING_KEY });
    await chain.initialize();

    await chain.record({ event: 'e1', level: 'info', message: 'Key 1' });

    const key2 = 'second-signing-key-at-least-32-characters!!';
    await chain.updateSigningKey(key2);
    await chain.record({ event: 'e2', level: 'info', message: 'Key 2' });

    const key3 = 'third-signing-key-at-least-32-characters!!!';
    await chain.updateSigningKey(key3);
    await chain.record({ event: 'e3', level: 'info', message: 'Key 3' });

    const result = await chain.verify();
    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5); // e1, rot1, e2, rot2, e3
  });
});
