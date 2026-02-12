import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService, AuthError } from './auth.js';
import { AuthStorage } from './auth-storage.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { RBAC } from './rbac.js';
import { RateLimiter } from './rate-limiter.js';
import type { SecureLogger } from '../logging/logger.js';
import { sha256 } from '../utils/crypto.js';

const TOKEN_SECRET = 'test-token-secret-at-least-32chars!!';
const ADMIN_PASSWORD_RAW = 'test-admin-password-32chars!!';
const ADMIN_PASSWORD = sha256(ADMIN_PASSWORD_RAW);
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
      const result = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
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
      const { accessToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      const user = await service.validateToken(accessToken);
      expect(user.userId).toBe('admin');
      expect(user.role).toBe('admin');
      expect(user.authMethod).toBe('jwt');
      expect(user.jti).toBeTruthy();
    });

    it('should reject a refresh token when used as access', async () => {
      const { refreshToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      await expect(service.validateToken(refreshToken)).rejects.toThrow('Invalid token type');
    });

    it('should reject a revoked token', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
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
      const login = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      const refreshed = await service.refresh(login.refreshToken);
      expect(refreshed.accessToken).toBeTruthy();
      expect(refreshed.refreshToken).toBeTruthy();
      expect(refreshed.accessToken).not.toBe(login.accessToken);

      // Old refresh token is consumed (single-use)
      await expect(service.refresh(login.refreshToken)).rejects.toThrow('revoked');
    });

    it('should reject an access token used as refresh', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      await expect(service.refresh(accessToken)).rejects.toThrow('Invalid token type');
    });
  });

  // ── Logout ────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should blacklist the JTI', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
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

  // ── Remember Me ────────────────────────────────────────────────

  describe('rememberMe', () => {
    it('should return extended expiry when rememberMe is true', async () => {
      const result = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1', true);
      // 30 days = 2592000 seconds
      expect(result.expiresIn).toBe(30 * 86400);
    });

    it('should return standard expiry when rememberMe is false', async () => {
      const result = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1', false);
      expect(result.expiresIn).toBe(3600);
    });
  });

  // ── Password Reset ──────────────────────────────────────────────

  describe('resetPassword', () => {
    it('should reset password with correct current password', async () => {
      const newPass = 'a-brand-new-password-that-is-at-least-32-chars';
      await service.resetPassword(ADMIN_PASSWORD_RAW, newPass);

      // Old password no longer works
      await expect(service.login(ADMIN_PASSWORD_RAW, '127.0.0.1')).rejects.toThrow('Invalid credentials');

      // New password works
      const result = await service.login(newPass, '127.0.0.1');
      expect(result.accessToken).toBeTruthy();
    });

    it('should reject reset with wrong current password', async () => {
      await expect(
        service.resetPassword('wrong', 'a-brand-new-password-that-is-at-least-32-chars')
      ).rejects.toThrow('Current password is incorrect');
    });

    it('should reject weak new password (< 32 chars)', async () => {
      await expect(
        service.resetPassword(ADMIN_PASSWORD_RAW, 'short')
      ).rejects.toThrow('New password must be at least 32 characters');
    });

    it('should invalidate existing tokens after reset', async () => {
      const { accessToken } = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      const newPass = 'a-brand-new-password-that-is-at-least-32-chars';
      await service.resetPassword(ADMIN_PASSWORD_RAW, newPass);

      // Old token should fail (secret was rotated)
      await expect(service.validateToken(accessToken)).rejects.toThrow();
    });
  });

  // ── Two-Factor Authentication ──────────────────────────────────

  describe('2FA', () => {
    it('should set up and enable 2FA', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      expect(setup.secret).toBeTruthy();
      expect(setup.uri).toContain('otpauth://totp/');
      expect(setup.recoveryCodes).toHaveLength(10);

      const code = generateTOTP(setup.secret);
      const ok = await service.verifyAndEnableTwoFactor(code, setup.recoveryCodes);
      expect(ok).toBe(true);
      expect(service.isTwoFactorEnabled()).toBe(true);
    });

    it('should require 2FA code after login when enabled', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      const code = generateTOTP(setup.secret);
      await service.verifyAndEnableTwoFactor(code, setup.recoveryCodes);

      // Login should now return requiresTwoFactor
      const result = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      expect(result.requiresTwoFactor).toBe(true);
      expect(result.accessToken).toBe('');
    });

    it('should issue tokens after valid 2FA code', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      const setupCode = generateTOTP(setup.secret);
      await service.verifyAndEnableTwoFactor(setupCode, setup.recoveryCodes);

      const verifyCode = generateTOTP(setup.secret);
      const result = await service.verifyTwoFactorCode(verifyCode);
      expect(result.accessToken).toBeTruthy();
      expect(result.tokenType).toBe('Bearer');
    });

    it('should accept recovery code and consume it', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      const code = generateTOTP(setup.secret);
      await service.verifyAndEnableTwoFactor(code, setup.recoveryCodes);

      const recoveryCode = setup.recoveryCodes[0];
      const result = await service.verifyTwoFactorCode(recoveryCode);
      expect(result.accessToken).toBeTruthy();

      // Same recovery code should not work again
      await expect(service.verifyTwoFactorCode(recoveryCode)).rejects.toThrow('Invalid 2FA code');
    });

    it('should reject invalid 2FA code', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      const code = generateTOTP(setup.secret);
      await service.verifyAndEnableTwoFactor(code, setup.recoveryCodes);

      await expect(service.verifyTwoFactorCode('000000')).rejects.toThrow('Invalid 2FA code');
    });

    it('should disable 2FA', async () => {
      const { generateTOTP } = await import('./totp.js');
      const setup = await service.setupTwoFactor();
      const code = generateTOTP(setup.secret);
      await service.verifyAndEnableTwoFactor(code, setup.recoveryCodes);

      await service.disableTwoFactor();
      expect(service.isTwoFactorEnabled()).toBe(false);

      // Login should work without 2FA
      const result = await service.login(ADMIN_PASSWORD_RAW, '127.0.0.1');
      expect(result.accessToken).toBeTruthy();
      expect(result.requiresTwoFactor).toBeUndefined();
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
