import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService, AuthError } from './auth.js';
import { AuthStorage } from './auth-storage.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { RBAC } from './rbac.js';
import { RateLimiter } from './rate-limiter.js';
import type { SecureLogger } from '../logging/logger.js';

const TOKEN_SECRET = 'test-token-secret-at-least-32chars!!';
const ADMIN_PASSWORD = 'test-admin-password-32chars!!';
const SIGNING_KEY = 'a]&3Gk9$mQ#vL7@pR!wZ5*xN2^bT8+dF';

function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  };
}

describe('AuthService', () => {
  let authStorage: AuthStorage;
  let auditChain: AuditChain;
  let rbac: RBAC;
  let rateLimiter: RateLimiter;
  let service: AuthService;

  beforeEach(async () => {
    authStorage = new AuthStorage();
    const auditStorage = new InMemoryAuditStorage();
    auditChain = new AuditChain({ storage: auditStorage, signingKey: SIGNING_KEY });
    await auditChain.initialize();
    rbac = new RBAC();
    rateLimiter = new RateLimiter({ defaultWindowMs: 60000, defaultMaxRequests: 100 });
    rateLimiter.addRule({
      name: 'auth_attempts',
      windowMs: 900000,
      maxRequests: 5,
      keyType: 'ip',
      onExceed: 'reject',
    });

    service = new AuthService(
      {
        tokenSecret: TOKEN_SECRET,
        tokenExpirySeconds: 3600,
        refreshTokenExpirySeconds: 86400,
        adminPassword: ADMIN_PASSWORD,
      },
      {
        storage: authStorage,
        auditChain,
        rbac,
        rateLimiter,
        logger: noopLogger(),
      },
    );
  });

  afterEach(() => {
    authStorage.close();
    rateLimiter.stop();
  });

  // ── Login ─────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return tokens on valid admin password', async () => {
      const result = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      expect(result.tokenType).toBe('Bearer');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.expiresIn).toBe(3600);
    });

    it('should reject invalid password', async () => {
      await expect(service.login('wrong-password', '127.0.0.1')).rejects.toThrow(AuthError);
      await expect(service.login('wrong-password', '127.0.0.1')).rejects.toThrow('Invalid credentials');
    });

    it('should rate-limit after repeated failures', async () => {
      for (let i = 0; i < 5; i++) {
        try { await service.login('wrong', '10.0.0.1'); } catch { /* expected */ }
      }
      await expect(service.login('wrong', '10.0.0.1')).rejects.toThrow('Too many login attempts');
    });
  });

  // ── Token validation ──────────────────────────────────────────────

  describe('validateToken', () => {
    it('should validate an access token and return AuthUser', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      const user = await service.validateToken(accessToken);
      expect(user.userId).toBe('admin');
      expect(user.role).toBe('admin');
      expect(user.authMethod).toBe('jwt');
      expect(user.jti).toBeTruthy();
    });

    it('should reject a refresh token when used as access', async () => {
      const { refreshToken } = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      await expect(service.validateToken(refreshToken)).rejects.toThrow('Invalid token type');
    });

    it('should reject a revoked token', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      const user = await service.validateToken(accessToken);
      await service.logout(user.jti!, user.userId, user.exp!);
      await expect(service.validateToken(accessToken)).rejects.toThrow('revoked');
    });

    it('should reject garbage tokens', async () => {
      await expect(service.validateToken('not.a.jwt')).rejects.toThrow(AuthError);
    });
  });

  // ── Refresh ───────────────────────────────────────────────────────

  describe('refresh', () => {
    it('should return new token pair and consume old refresh', async () => {
      const login = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      const refreshed = await service.refresh(login.refreshToken);
      expect(refreshed.accessToken).toBeTruthy();
      expect(refreshed.refreshToken).toBeTruthy();
      expect(refreshed.accessToken).not.toBe(login.accessToken);

      // Old refresh token is consumed (single-use)
      await expect(service.refresh(login.refreshToken)).rejects.toThrow('revoked');
    });

    it('should reject an access token used as refresh', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      await expect(service.refresh(accessToken)).rejects.toThrow('Invalid token type');
    });
  });

  // ── Logout ────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should blacklist the JTI', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD, '127.0.0.1');
      const user = await service.validateToken(accessToken);
      await service.logout(user.jti!, user.userId, user.exp!);
      await expect(service.validateToken(accessToken)).rejects.toThrow('revoked');
    });
  });

  // ── API keys ──────────────────────────────────────────────────────

  describe('API keys', () => {
    it('should create a key and return the raw key once', async () => {
      const result = await service.createApiKey({
        name: 'CI key',
        role: 'viewer',
        userId: 'admin',
      });
      expect(result.key).toMatch(/^sck_/);
      expect(result.keyPrefix).toBe(result.key.slice(0, 8));
      expect(result.id).toBeTruthy();
      expect(result.role).toBe('viewer');
    });

    it('should validate a raw API key and return AuthUser', async () => {
      const { key } = await service.createApiKey({
        name: 'test',
        role: 'operator',
        userId: 'admin',
      });
      const user = await service.validateApiKey(key);
      expect(user.userId).toBe('admin');
      expect(user.role).toBe('operator');
      expect(user.authMethod).toBe('api_key');
      expect(user.apiKeyId).toBeTruthy();
    });

    it('should reject an unknown API key', async () => {
      await expect(service.validateApiKey('sck_unknown')).rejects.toThrow('Invalid API key');
    });

    it('should reject a revoked API key', async () => {
      const { id, key } = await service.createApiKey({
        name: 'revokable',
        role: 'viewer',
        userId: 'admin',
      });
      await service.revokeApiKey(id, 'admin');
      await expect(service.validateApiKey(key)).rejects.toThrow('Invalid API key');
    });

    it('should list keys without exposing hashes', async () => {
      await service.createApiKey({ name: 'k1', role: 'viewer', userId: 'admin' });
      await service.createApiKey({ name: 'k2', role: 'admin', userId: 'admin' });
      const keys = service.listApiKeys('admin');
      expect(keys).toHaveLength(2);
      expect((keys[0] as Record<string, unknown>).key_hash).toBeUndefined();
    });

    it('should support key expiry', async () => {
      // Create key that expired yesterday
      const { key } = await service.createApiKey({
        name: 'expired',
        role: 'viewer',
        userId: 'admin',
        expiresInDays: -1, // negative → already expired
      });
      await expect(service.validateApiKey(key)).rejects.toThrow('Invalid API key');
    });
  });

  // ── Cleanup ───────────────────────────────────────────────────────

  describe('cleanupExpiredTokens', () => {
    it('should delete expired revoked tokens', async () => {
      // Revoke a token with past expiry
      authStorage.revokeToken('old-jti', 'admin', Date.now() - 1000);
      authStorage.revokeToken('fresh-jti', 'admin', Date.now() + 3600_000);
      const cleaned = service.cleanupExpiredTokens();
      expect(cleaned).toBe(1);
    });
  });
});
