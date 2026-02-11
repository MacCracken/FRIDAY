/**
 * Auth Service — JWT login, token refresh/revocation, API key management.
 *
 * Dependencies are injected so the service is testable without a running
 * SecureYeoman instance.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { sha256, secureCompare, generateSecureToken, uuidv7 } from '../utils/crypto.js';
import { TokenPayloadSchema, type Role } from '@friday/shared';
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

  async login(password: string, ip: string): Promise<LoginResult> {
    // Rate-limit check
    const rl = await this.deps.rateLimiter.check('auth_attempts', ip, { ipAddress: ip });
    if (!rl.allowed) {
      await this.audit('auth_failure', 'Rate limit exceeded on login', { ip });
      throw new AuthError('Too many login attempts. Try again later.', 429);
    }

    // Constant-time password comparison (hash both sides)
    const passwordHash = sha256(password);
    const expectedHash = sha256(this.config.adminPassword);

    if (!secureCompare(passwordHash, expectedHash)) {
      await this.audit('auth_failure', 'Invalid admin password', { ip });
      throw new AuthError('Invalid credentials', 401);
    }

    const role: Role = 'admin';
    const permissions = buildPermissionStrings(role, this.deps.rbac);
    const accessJti = uuidv7();
    const refreshJti = uuidv7();

    const accessToken = await this.signToken({
      sub: ADMIN_USER_ID,
      role,
      permissions,
      jti: accessJti,
      type: 'access',
    }, this.config.tokenExpirySeconds);

    const refreshToken = await this.signToken({
      sub: ADMIN_USER_ID,
      role,
      permissions,
      jti: refreshJti,
      type: 'refresh',
    }, this.config.refreshTokenExpirySeconds);

    await this.audit('auth_success', 'Admin login', {
      ip,
      userId: ADMIN_USER_ID,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.tokenExpirySeconds,
      tokenType: 'Bearer',
    };
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
