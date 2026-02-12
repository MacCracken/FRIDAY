/**
 * Auth Service — JWT login, token refresh/revocation, API key management.
 *
 * Dependencies are injected so the service is testable without a running
 * SecureYeoman instance.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { sha256, secureCompare, generateSecureToken, uuidv7 } from '../utils/crypto.js';
import { TokenPayloadSchema, type Role } from '@friday/shared';
import { generateTOTPSecret, verifyTOTP, generateRecoveryCodes, buildTOTPUri } from './totp.js';
import type { AuthStorage, ApiKeyRow } from './auth-storage.js';
import type { AuditChain } from '../logging/audit-chain.js';
import type { RBAC } from './rbac.js';
import type { RateLimiterLike } from './rate-limiter.js';
import type { SecureLogger } from '../logging/logger.js';

// ── Public types ─────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  role: Role;
  permissions: string[];
  authMethod: 'jwt' | 'api_key' | 'certificate';
  jti?: string;
  exp?: number;
  apiKeyId?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  requiresTwoFactor?: boolean;
}

export interface TwoFactorSetupResult {
  secret: string;
  uri: string;
  recoveryCodes: string[];
}

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  role: Role;
  createdAt: number;
  expiresAt: number | null;
}

// ── Config ───────────────────────────────────────────────────────────

export interface AuthServiceConfig {
  /** HMAC secret — will be encoded to bytes for jose */
  tokenSecret: string;
  /** Access-token lifetime in seconds */
  tokenExpirySeconds: number;
  /** Refresh-token lifetime in seconds */
  refreshTokenExpirySeconds: number;
  /** Pre-hashed admin password (sha256 hex) — we hash the incoming
   *  password and compare using secureCompare */
  adminPassword: string;
}

export interface AuthServiceDeps {
  storage: AuthStorage;
  auditChain: AuditChain;
  rbac: RBAC;
  rateLimiter: RateLimiterLike;
  logger: SecureLogger;
}

// ── Helpers ──────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'admin';
const API_KEY_PREFIX = 'sck_';

function buildPermissionStrings(role: Role, rbac: RBAC): string[] {
  const roleDef = rbac.getRole(role);
  if (!roleDef) return [];
  return roleDef.permissions.map(
    (p) => `${p.resource}:${p.actions.join(',')}`,
  );
}

// ── Service ──────────────────────────────────────────────────────────

export class AuthService {
  private secret: Uint8Array;
  private previousSecret: Uint8Array | null = null;
  private readonly config: AuthServiceConfig;
  private readonly deps: AuthServiceDeps;

  // 2FA state
  private twoFactorSecret: string | null = null;
  private twoFactorEnabled = false;
  private recoveryCodes: Set<string> = new Set();
  private pendingTwoFactorSecret: string | null = null;

  constructor(config: AuthServiceConfig, deps: AuthServiceDeps) {
    this.config = config;
    this.secret = new TextEncoder().encode(config.tokenSecret);
    this.deps = deps;
  }

  /**
   * Update the token secret for rotation. The old secret is kept
   * as previousSecret so tokens signed with it remain valid during
   * the grace period.
   */
  updateTokenSecret(newSecret: string): void {
    this.previousSecret = this.secret;
    this.secret = new TextEncoder().encode(newSecret);
  }

  /**
   * Clear the previous secret after the grace period has elapsed.
   */
  clearPreviousSecret(): void {
    this.previousSecret = null;
  }

  // ── Login ────────────────────────────────────────────────────────

  async login(password: string, ip: string, rememberMe = false): Promise<LoginResult> {
    // Rate-limit check
    const rl = await this.deps.rateLimiter.check('auth_attempts', ip, { ipAddress: ip });
    if (!rl.allowed) {
      await this.audit('auth_failure', 'Rate limit exceeded on login', { ip });
      throw new AuthError('Too many login attempts. Try again later.', 429);
    }

    // Constant-time password comparison
    // adminPassword is already stored as a sha256 hex digest
    const passwordHash = sha256(password);
    const expectedHash = this.config.adminPassword;

    if (!secureCompare(passwordHash, expectedHash)) {
      await this.audit('auth_failure', 'Invalid admin password', { ip });
      throw new AuthError('Invalid credentials', 401);
    }

    // If 2FA is enabled, return a challenge instead of tokens
    if (this.twoFactorEnabled) {
      await this.audit('auth_success', 'Password verified, awaiting 2FA', {
        ip,
        userId: ADMIN_USER_ID,
      });
      return {
        accessToken: '',
        refreshToken: '',
        expiresIn: 0,
        tokenType: 'Bearer',
        requiresTwoFactor: true,
      };
    }

    await this.audit('auth_success', 'Admin login', {
      ip,
      userId: ADMIN_USER_ID,
      rememberMe,
    });

    return this.issueTokens(rememberMe);
  }

  // ── Refresh ──────────────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = await this.verifyTokenRaw(refreshToken);

    if (payload.type !== 'refresh') {
      throw new AuthError('Invalid token type', 401);
    }

    const jti = payload.jti as string;
    if (this.deps.storage.isTokenRevoked(jti)) {
      throw new AuthError('Refresh token has been revoked', 401);
    }

    // Consume old refresh token (single-use rotation)
    this.deps.storage.revokeToken(jti, payload.sub as string, payload.exp as number);

    const role = payload.role as Role;
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const newAccessJti = uuidv7();
    const newRefreshJti = uuidv7();

    const accessToken = await this.signToken({
      sub: payload.sub as string,
      role,
      permissions,
      jti: newAccessJti,
      type: 'access',
    }, this.config.tokenExpirySeconds);

    const newRefreshToken = await this.signToken({
      sub: payload.sub as string,
      role,
      permissions,
      jti: newRefreshJti,
      type: 'refresh',
    }, this.config.refreshTokenExpirySeconds);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.config.tokenExpirySeconds,
      tokenType: 'Bearer',
    };
  }

  // ── Logout ───────────────────────────────────────────────────────

  async logout(jti: string, userId: string, exp: number): Promise<void> {
    this.deps.storage.revokeToken(jti, userId, exp);
    await this.audit('auth_success', 'User logout', { userId });
  }

  // ── Token validation ─────────────────────────────────────────────

  async validateToken(token: string): Promise<AuthUser> {
    const payload = await this.verifyTokenRaw(token);

    if (payload.type !== 'access') {
      throw new AuthError('Invalid token type', 401);
    }

    const jti = payload.jti as string;
    if (this.deps.storage.isTokenRevoked(jti)) {
      throw new AuthError('Token has been revoked', 401);
    }

    // Validate payload shape via Zod (reuses shared TokenPayloadSchema)
    const parsed = TokenPayloadSchema.safeParse({
      sub: payload.sub,
      role: payload.role,
      permissions: payload.permissions,
      iat: payload.iat,
      exp: payload.exp,
      jti,
    });

    if (!parsed.success) {
      throw new AuthError('Malformed token payload', 401);
    }

    return {
      userId: parsed.data.sub,
      role: parsed.data.role,
      permissions: parsed.data.permissions,
      authMethod: 'jwt',
      jti,
      exp: parsed.data.exp,
    };
  }

  // ── API key management ───────────────────────────────────────────

  async createApiKey(opts: {
    name: string;
    role: Role;
    userId: string;
    expiresInDays?: number;
  }): Promise<ApiKeyCreateResult> {
    const id = uuidv7();
    const rawKey = `${API_KEY_PREFIX}${generateSecureToken(32)}`;
    const keyHash = sha256(rawKey);
    const keyPrefix = rawKey.slice(0, 8);
    const now = Date.now();
    const expiresAt = opts.expiresInDays
      ? now + opts.expiresInDays * 86_400_000
      : null;

    const row: ApiKeyRow = {
      id,
      name: opts.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      role: opts.role,
      user_id: opts.userId,
      created_at: now,
      expires_at: expiresAt,
      revoked_at: null,
      last_used_at: null,
    };

    this.deps.storage.storeApiKey(row);

    await this.audit('auth_success', 'API key created', {
      userId: opts.userId,
      keyId: id,
      keyPrefix,
      role: opts.role,
    });

    return {
      id,
      name: opts.name,
      key: rawKey,
      keyPrefix,
      role: opts.role,
      createdAt: now,
      expiresAt,
    };
  }

  async validateApiKey(rawKey: string): Promise<AuthUser> {
    const keyHash = sha256(rawKey);
    const row = this.deps.storage.findApiKeyByHash(keyHash);

    if (!row) {
      throw new AuthError('Invalid API key', 401);
    }

    this.deps.storage.updateLastUsed(row.id, Date.now());

    const role = row.role as Role;
    const permissions = buildPermissionStrings(role, this.deps.rbac);

    return {
      userId: row.user_id,
      role,
      permissions,
      authMethod: 'api_key',
      apiKeyId: row.id,
    };
  }

  async revokeApiKey(keyId: string, userId: string): Promise<boolean> {
    const ok = this.deps.storage.revokeApiKey(keyId);
    if (ok) {
      await this.audit('auth_success', 'API key revoked', { userId, keyId });
    }
    return ok;
  }

  listApiKeys(userId?: string) {
    return this.deps.storage.listApiKeys(userId);
  }

  cleanupExpiredTokens(): number {
    return this.deps.storage.cleanupExpiredTokens();
  }

  // ── Password Reset ──────────────────────────────────────────────

  async resetPassword(currentPassword: string, newPassword: string): Promise<void> {
    // Verify current password
    const currentHash = sha256(currentPassword);
    const expectedHash = this.config.adminPassword;

    if (!secureCompare(currentHash, expectedHash)) {
      await this.audit('auth_failure', 'Password reset failed: wrong current password', {
        userId: ADMIN_USER_ID,
      });
      throw new AuthError('Current password is incorrect', 401);
    }

    // Validate new password strength (32+ chars)
    if (newPassword.length < 32) {
      throw new AuthError('New password must be at least 32 characters', 400);
    }

    // Update the stored admin password (store as sha256 hex digest)
    (this.config as { adminPassword: string }).adminPassword = sha256(newPassword);

    // Rotate token secret and clear previous to invalidate all existing sessions
    const newSecret = generateSecureToken(32);
    this.updateTokenSecret(newSecret);
    this.clearPreviousSecret();

    await this.audit('auth_success', 'Admin password reset — all sessions invalidated', {
      userId: ADMIN_USER_ID,
    });
  }

  // ── Two-Factor Authentication ────────────────────────────────────

  isTwoFactorEnabled(): boolean {
    return this.twoFactorEnabled;
  }

  async setupTwoFactor(): Promise<TwoFactorSetupResult> {
    const secret = generateTOTPSecret();
    this.pendingTwoFactorSecret = secret;

    const uri = buildTOTPUri(secret, 'admin');
    const codes = generateRecoveryCodes();

    await this.audit('auth_success', '2FA setup initiated', {
      userId: ADMIN_USER_ID,
    });

    return { secret, uri, recoveryCodes: codes };
  }

  async verifyAndEnableTwoFactor(code: string, recoveryCodes?: string[]): Promise<boolean> {
    if (!this.pendingTwoFactorSecret) {
      throw new AuthError('No 2FA setup in progress', 400);
    }

    if (!verifyTOTP(this.pendingTwoFactorSecret, code)) {
      return false;
    }

    this.twoFactorSecret = this.pendingTwoFactorSecret;
    this.twoFactorEnabled = true;
    this.pendingTwoFactorSecret = null;
    this.recoveryCodes = new Set(recoveryCodes ?? []);

    await this.audit('auth_success', '2FA enabled', {
      userId: ADMIN_USER_ID,
    });

    return true;
  }

  async verifyTwoFactorCode(code: string): Promise<LoginResult> {
    if (!this.twoFactorEnabled || !this.twoFactorSecret) {
      throw new AuthError('2FA is not enabled', 400);
    }

    // Check TOTP code
    if (verifyTOTP(this.twoFactorSecret, code)) {
      return this.issueTokens(false);
    }

    // Check recovery codes
    if (this.recoveryCodes.has(code)) {
      this.recoveryCodes.delete(code);
      await this.audit('auth_success', '2FA recovery code used', {
        userId: ADMIN_USER_ID,
        remainingRecoveryCodes: this.recoveryCodes.size,
      });
      return this.issueTokens(false);
    }

    await this.audit('auth_failure', '2FA verification failed', {
      userId: ADMIN_USER_ID,
    });
    throw new AuthError('Invalid 2FA code', 401);
  }

  async disableTwoFactor(): Promise<void> {
    this.twoFactorSecret = null;
    this.twoFactorEnabled = false;
    this.recoveryCodes.clear();
    this.pendingTwoFactorSecret = null;

    await this.audit('auth_success', '2FA disabled', {
      userId: ADMIN_USER_ID,
    });
  }

  private async issueTokens(rememberMe: boolean): Promise<LoginResult> {
    const role: Role = 'admin';
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const accessJti = uuidv7();
    const refreshJti = uuidv7();

    const REMEMBER_ME_ACCESS_SECONDS = 30 * 86400;
    const REMEMBER_ME_REFRESH_SECONDS = 60 * 86400;

    const accessExpiry = rememberMe ? REMEMBER_ME_ACCESS_SECONDS : this.config.tokenExpirySeconds;
    const refreshExpiry = rememberMe ? REMEMBER_ME_REFRESH_SECONDS : this.config.refreshTokenExpirySeconds;

    const accessToken = await this.signToken({
      sub: ADMIN_USER_ID,
      role,
      permissions,
      jti: accessJti,
      type: 'access',
    }, accessExpiry);

    const refreshToken = await this.signToken({
      sub: ADMIN_USER_ID,
      role,
      permissions,
      jti: refreshJti,
      type: 'refresh',
    }, refreshExpiry);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiry,
      tokenType: 'Bearer',
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async signToken(
    claims: Record<string, unknown>,
    expirySeconds: number,
  ): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${expirySeconds}s`)
      .sign(this.secret);
  }

  private async verifyTokenRaw(token: string): Promise<JWTPayload & Record<string, unknown>> {
    // Try current secret first
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
      });
      return payload as JWTPayload & Record<string, unknown>;
    } catch {
      // Fall back to previous secret during grace period
      if (this.previousSecret) {
        try {
          const { payload } = await jwtVerify(token, this.previousSecret, {
            algorithms: ['HS256'],
          });
          return payload as JWTPayload & Record<string, unknown>;
        } catch {
          // Both keys failed
        }
      }
      throw new AuthError('Invalid or expired token', 401);
    }
  }

  private async audit(
    event: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.deps.auditChain.record({
        event,
        level: event === 'auth_failure' ? 'warn' : 'info',
        message,
        userId: metadata?.userId as string | undefined,
        metadata,
      });
    } catch (err) {
      this.deps.logger.error('Failed to record auth audit event', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }
}

// ── Error type ─────────────────────────────────────────────────────

export class AuthError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}
