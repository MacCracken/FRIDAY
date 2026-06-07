/**
 * Auth Service — JWT login, token refresh/revocation, API key management.
 *
 * Dependencies are injected so the service is testable without a running
 * SecureYeoman instance.
 */

import { SignJWT, jwtVerify, type JWTPayload, type JWTVerifyOptions } from 'jose';
import {
  sha256,
  secureCompare,
  generateSecureToken,
  uuidv7,
  hashPassword,
  verifyPassword,
  isLegacySha256,
} from '../utils/crypto.js';
import { TokenPayloadSchema, type Role } from '@secureyeoman/shared';
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
  gatewayPersonalityId?: string;
  gatewayRateLimitRpm?: number;
  gatewayRateLimitTpd?: number;
  isGatewayKey?: boolean;
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
  /** Admin password hash. Accepts legacy SHA256 hex (64 chars) or
   *  scrypt format `scrypt:<base64-salt>:<base64-hash>`. Legacy hashes
   *  are auto-upgraded to scrypt on successful login. */
  adminPassword: string;
  /** JWT issuer claim (default: 'secureyeoman') */
  jwtIssuer?: string;
  /** JWT audience claim (default: 'secureyeoman-api') */
  jwtAudience?: string;
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
const JWT_ISSUER_DEFAULT = 'secureyeoman';
const JWT_AUDIENCE_DEFAULT = 'secureyeoman-api';

function buildPermissionStrings(role: Role, rbac: RBAC): string[] {
  const roleDef = rbac.getRole(role);
  if (!roleDef) return [];
  return roleDef.permissions.map((p) => `${p.resource}:${p.actions.join(',')}`);
}

/** Hash a recovery code for storage (SHA-256). */
function hashRecoveryCode(code: string): string {
  return sha256(code);
}

// ── Service ──────────────────────────────────────────────────────────

export class AuthService {
  private secret: Uint8Array;
  private previousSecret: Uint8Array | null = null;
  private readonly config: AuthServiceConfig;
  private readonly deps: AuthServiceDeps;
  private readonly jwtIssuer: string;
  private readonly jwtAudience: string;

  // Auth stats
  private authAttemptsTotal = 0;
  private authSuccessTotal = 0;
  private authFailuresTotal = 0;

  // 2FA state (in-memory cache backed by DB)
  private twoFactorSecret: string | null = null;
  private twoFactorEnabled = false;
  private recoveryCodes = new Set<string>();
  private pendingTwoFactorSecret: string | null = null;
  private twoFactorHydrated = false;

  constructor(config: AuthServiceConfig, deps: AuthServiceDeps) {
    this.config = config;
    this.secret = new TextEncoder().encode(config.tokenSecret);
    this.deps = deps;
    this.jwtIssuer = config.jwtIssuer ?? JWT_ISSUER_DEFAULT;
    this.jwtAudience = config.jwtAudience ?? JWT_AUDIENCE_DEFAULT;
  }

  /**
   * Hydrate 2FA state from the database. Call once after construction
   * when the DB pool is ready. Safe to call multiple times (no-ops after first).
   */
  async hydrateTwoFactorState(): Promise<void> {
    if (this.twoFactorHydrated) return;
    try {
      const twoFa = await this.deps.storage.loadTwoFactor(ADMIN_USER_ID);
      if (twoFa) {
        this.twoFactorSecret = twoFa.secret;
        this.twoFactorEnabled = twoFa.enabled;
      }
      const codeHashes = await this.deps.storage.loadRecoveryCodes(ADMIN_USER_ID);
      if (codeHashes.length > 0) {
        this.recoveryCodes = new Set(codeHashes);
      }
      this.twoFactorHydrated = true;
      this.deps.logger.info({ enabled: this.twoFactorEnabled }, '2FA state hydrated from DB');
    } catch (err) {
      // Non-fatal — in-memory state remains as initialized (disabled).
      // This allows the service to start even if the DB migration hasn't run.
      this.deps.logger.warn({ err }, '2FA DB hydration failed — starting with 2FA disabled');
    }
  }

  /**
   * Get auth statistics
   */
  getStats(): { authAttemptsTotal: number; authSuccessTotal: number; authFailuresTotal: number } {
    return {
      authAttemptsTotal: this.authAttemptsTotal,
      authSuccessTotal: this.authSuccessTotal,
      authFailuresTotal: this.authFailuresTotal,
    };
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
    this.authAttemptsTotal++;
    // Rate-limit check
    const rl = await this.deps.rateLimiter.check('auth_attempts', ip, { ipAddress: ip });
    if (!rl.allowed) {
      this.authFailuresTotal++;
      await this.audit('auth_failure', 'Rate limit exceeded on login', { ip });
      throw new AuthError('Too many login attempts. Try again later.', 429);
    }

    // Password verification — supports both legacy SHA256 and scrypt
    const storedHash = this.config.adminPassword;
    let passwordValid: boolean;

    if (isLegacySha256(storedHash)) {
      // Legacy: constant-time compare against SHA256 hex digest
      passwordValid = secureCompare(sha256(password), storedHash);

      // Auto-upgrade to scrypt on successful login
      if (passwordValid) {
        const upgraded = await hashPassword(password);
        (this.config as { adminPassword: string }).adminPassword = upgraded;
        this.deps.logger.info('Admin password auto-upgraded from SHA256 to scrypt');
      }
    } else {
      // Modern: scrypt verification
      passwordValid = await verifyPassword(password, storedHash);
    }

    if (!passwordValid) {
      this.authFailuresTotal++;
      await this.audit('auth_failure', 'Invalid admin password', { ip });
      throw new AuthError('Invalid credentials', 401);
    }

    // Issue tokens regardless, then decide what to return.
    // This ensures constant-time execution whether 2FA is enabled or not,
    // preventing timing side-channels that reveal 2FA enrollment status.
    const tokens = await this.issueTokens(rememberMe);

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

    this.authSuccessTotal++;
    await this.audit('auth_success', 'Admin login', {
      ip,
      userId: ADMIN_USER_ID,
      rememberMe,
    });

    return tokens;
  }

  // ── Refresh ──────────────────────────────────────────────────────

  async refresh(refreshToken: string): Promise<LoginResult> {
    const payload = await this.verifyTokenRaw(refreshToken);

    if (payload.type !== 'refresh') {
      throw new AuthError('Invalid token type', 401);
    }

    // Atomic revoke-and-check: single INSERT ... ON CONFLICT DO NOTHING RETURNING
    // eliminates the race where two concurrent refresh calls both pass isTokenRevoked()
    const jti = payload.jti!;
    const revoked = await this.deps.storage.revokeToken(jti, payload.sub!, payload.exp!);
    if (!revoked) {
      throw new AuthError('Refresh token has been revoked', 401);
    }

    const role = payload.role as Role;
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const newAccessJti = uuidv7();
    const newRefreshJti = uuidv7();

    const accessToken = await this.signToken(
      {
        sub: payload.sub!,
        role,
        permissions,
        jti: newAccessJti,
        type: 'access',
      },
      this.config.tokenExpirySeconds
    );

    const newRefreshToken = await this.signToken(
      {
        sub: payload.sub!,
        role,
        permissions,
        jti: newRefreshJti,
        type: 'refresh',
      },
      this.config.refreshTokenExpirySeconds
    );

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.config.tokenExpirySeconds,
      tokenType: 'Bearer',
    };
  }

  // ── Logout ───────────────────────────────────────────────────────

  async logout(jti: string, userId: string, exp: number): Promise<void> {
    await this.deps.storage.revokeToken(jti, userId, exp);
    await this.audit('auth_success', 'User logout', { userId });
  }

  // ── Token validation ─────────────────────────────────────────────

  async validateToken(token: string): Promise<AuthUser> {
    const payload = await this.verifyTokenRaw(token);

    if (payload.type !== 'access') {
      throw new AuthError('Invalid token type', 401);
    }

    const jti = payload.jti!;
    if (await this.deps.storage.isTokenRevoked(jti)) {
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
    personalityId?: string;
    rateLimitRpm?: number;
    rateLimitTpd?: number;
    isGatewayKey?: boolean;
  }): Promise<ApiKeyCreateResult> {
    const id = uuidv7();
    const rawKey = `${API_KEY_PREFIX}${generateSecureToken(32)}`;
    const keyHash = sha256(rawKey);
    const keyPrefix = rawKey.slice(0, 8);
    const now = Date.now();
    const expiresAt = opts.expiresInDays ? now + opts.expiresInDays * 86_400_000 : null;

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
      personality_id: opts.personalityId ?? null,
      rate_limit_rpm: opts.rateLimitRpm ?? null,
      rate_limit_tpd: opts.rateLimitTpd ?? null,
      is_gateway_key: opts.isGatewayKey ?? false,
    };

    await this.deps.storage.storeApiKey(row);

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
    const row = await this.deps.storage.findApiKeyByHash(keyHash);

    if (!row) {
      this.authFailuresTotal++;
      await this.audit('auth_failure', 'Invalid API key presented', { reason: 'invalid_api_key' });
      throw new AuthError('Invalid API key', 401);
    }

    await this.deps.storage.updateLastUsed(row.id, Date.now());

    const role = row.role as Role;
    const permissions = buildPermissionStrings(role, this.deps.rbac);

    return {
      userId: row.user_id,
      role,
      permissions,
      authMethod: 'api_key',
      apiKeyId: row.id,
      gatewayPersonalityId: row.personality_id ?? undefined,
      gatewayRateLimitRpm: row.rate_limit_rpm ?? undefined,
      gatewayRateLimitTpd: row.rate_limit_tpd ?? undefined,
      isGatewayKey: row.is_gateway_key ?? false,
    };
  }

  async revokeApiKey(keyId: string, userId: string): Promise<boolean> {
    const ok = await this.deps.storage.revokeApiKey(keyId, userId);
    if (ok) {
      await this.audit('auth_success', 'API key revoked', { userId, keyId });
    }
    return ok;
  }

  async listApiKeys(userId?: string) {
    return await this.deps.storage.listApiKeys(userId);
  }

  async cleanupExpiredTokens(): Promise<number> {
    return await this.deps.storage.cleanupExpiredTokens();
  }

  /**
   * Issue access + refresh tokens for any user (used by SSO callback).
   * The userId must correspond to a row in auth.users.
   */
  async createUserSession(userId: string, role: Role = 'viewer'): Promise<LoginResult> {
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const accessJti = uuidv7();
    const refreshJti = uuidv7();

    const accessToken = await this.signToken(
      { sub: userId, role, permissions, jti: accessJti, type: 'access' },
      this.config.tokenExpirySeconds
    );
    const refreshToken = await this.signToken(
      { sub: userId, role, permissions, jti: refreshJti, type: 'refresh' },
      this.config.refreshTokenExpirySeconds
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.tokenExpirySeconds,
      tokenType: 'Bearer',
    };
  }

  /** User management delegated to storage */
  async listUsers() {
    return this.deps.storage.listUsers();
  }
  async getUserById(id: string) {
    return this.deps.storage.getUserById(id);
  }
  async getUserByEmail(email: string) {
    return this.deps.storage.getUserByEmail(email);
  }
  async createUser(data: import('@secureyeoman/shared').UserCreate) {
    return this.deps.storage.createUser(data);
  }
  async updateUser(id: string, data: import('@secureyeoman/shared').UserUpdate) {
    return this.deps.storage.updateUser(id, data);
  }
  async deleteUser(id: string) {
    return this.deps.storage.deleteUser(id);
  }

  // ── Password Reset ──────────────────────────────────────────────

  async resetPassword(currentPassword: string, newPassword: string): Promise<void> {
    // Verify current password (supports both legacy SHA256 and scrypt)
    const storedHash = this.config.adminPassword;
    let currentValid: boolean;

    if (isLegacySha256(storedHash)) {
      currentValid = secureCompare(sha256(currentPassword), storedHash);
    } else {
      currentValid = await verifyPassword(currentPassword, storedHash);
    }

    if (!currentValid) {
      await this.audit('auth_failure', 'Password reset failed: wrong current password', {
        userId: ADMIN_USER_ID,
      });
      throw new AuthError('Current password is incorrect', 401);
    }

    // Validate new password strength (32+ chars)
    if (newPassword.length < 32) {
      throw new AuthError('New password must be at least 32 characters', 400);
    }

    // Store new password as scrypt hash
    (this.config as { adminPassword: string }).adminPassword = await hashPassword(newPassword);

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

    // Store recovery codes as SHA-256 hashes
    const rawCodes = recoveryCodes ?? [];
    this.recoveryCodes = new Set(rawCodes.map(hashRecoveryCode));

    // Persist to DB
    await this.deps.storage.saveTwoFactor(ADMIN_USER_ID, this.twoFactorSecret, true);
    await this.deps.storage.saveRecoveryCodes(ADMIN_USER_ID, [...this.recoveryCodes]);

    await this.audit('auth_success', '2FA enabled', {
      userId: ADMIN_USER_ID,
    });

    return true;
  }

  async verifyTwoFactorCode(code: string, ip?: string): Promise<LoginResult> {
    if (!this.twoFactorEnabled || !this.twoFactorSecret) {
      throw new AuthError('2FA is not enabled', 400);
    }

    // Rate-limit 2FA verification attempts (max 5 per 15 minutes per IP)
    if (ip) {
      const rl = await this.deps.rateLimiter.check('2fa_verify', ip, { ipAddress: ip });
      if (!rl.allowed) {
        this.authFailuresTotal++;
        await this.audit('auth_failure', '2FA rate limit exceeded', { ip, userId: ADMIN_USER_ID });
        throw new AuthError('Too many 2FA attempts. Try again later.', 429);
      }
    }

    // Check TOTP code
    if (verifyTOTP(this.twoFactorSecret, code)) {
      return this.issueTokens(false);
    }

    // Check recovery codes (compare hashed)
    const codeHash = hashRecoveryCode(code);
    if (this.recoveryCodes.has(codeHash)) {
      this.recoveryCodes.delete(codeHash);
      // Mark used in DB
      await this.deps.storage.markRecoveryCodeUsed(ADMIN_USER_ID, codeHash);
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

    // Remove from DB
    await this.deps.storage.deleteTwoFactor(ADMIN_USER_ID);

    await this.audit('auth_success', '2FA disabled', {
      userId: ADMIN_USER_ID,
    });
  }

  private async issueTokens(rememberMe: boolean): Promise<LoginResult> {
    const role: Role = 'admin';
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const accessJti = uuidv7();
    const refreshJti = uuidv7();

    // rememberMe extends refresh token only — access tokens stay short-lived
    const REMEMBER_ME_ACCESS_SECONDS = 3600; // 1 hour (was 30 days — excessive)
    const REMEMBER_ME_REFRESH_SECONDS = 30 * 86400; // 30 days (was 60)

    const accessExpiry = rememberMe ? REMEMBER_ME_ACCESS_SECONDS : this.config.tokenExpirySeconds;
    const refreshExpiry = rememberMe
      ? REMEMBER_ME_REFRESH_SECONDS
      : this.config.refreshTokenExpirySeconds;

    const accessToken = await this.signToken(
      {
        sub: ADMIN_USER_ID,
        role,
        permissions,
        jti: accessJti,
        type: 'access',
      },
      accessExpiry
    );

    const refreshToken = await this.signToken(
      {
        sub: ADMIN_USER_ID,
        role,
        permissions,
        jti: refreshJti,
        type: 'refresh',
      },
      refreshExpiry
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiry,
      tokenType: 'Bearer',
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async signToken(claims: Record<string, unknown>, expirySeconds: number): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(this.jwtIssuer)
      .setAudience(this.jwtAudience)
      .setExpirationTime(`${expirySeconds}s`)
      .sign(this.secret);
  }

  private async verifyTokenRaw(token: string): Promise<JWTPayload & Record<string, unknown>> {
    const verifyOpts: JWTVerifyOptions = {
      algorithms: ['HS256'],
      issuer: this.jwtIssuer,
      audience: this.jwtAudience,
    };

    // Try current secret first
    try {
      const { payload } = await jwtVerify(token, this.secret, verifyOpts);
      return payload;
    } catch {
      // Fall back to previous secret during grace period
      if (this.previousSecret) {
        try {
          const { payload } = await jwtVerify(token, this.previousSecret, verifyOpts);
          return payload;
        } catch {
          // Both keys failed
        }
      }

      // For backward compatibility: try without iss/aud validation for pre-migration tokens
      try {
        const { payload } = await jwtVerify(token, this.secret, {
          algorithms: ['HS256'],
        });
        return payload;
      } catch {
        // Also try previous secret without iss/aud
        if (this.previousSecret) {
          try {
            const { payload } = await jwtVerify(token, this.previousSecret, {
              algorithms: ['HS256'],
            });
            return payload;
          } catch {
            // All attempts failed
          }
        }
      }

      throw new AuthError('Invalid or expired token', 401);
    }
  }

  private async audit(
    event: string,
    message: string,
    metadata?: Record<string, unknown>
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
      this.deps.logger.error(
        {
          error: err instanceof Error ? err.message : 'Unknown',
        },
        'Failed to record auth audit event'
      );
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
