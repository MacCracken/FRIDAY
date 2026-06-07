/**
 * Token Federation — SSO/OAuth2 token exchange for cross-project auth.
 *
 * Issues short-lived, scoped JWTs ("federation tokens") that AGNOSTIC and AGNOS
 * can verify independently. The token includes the issuer, audience, and a
 * constrained set of permissions so the receiving service can enforce its own
 * RBAC without trusting full SecureYeoman session tokens.
 *
 * Flow:
 *   1. SecureYeoman user/service calls POST /api/v1/auth/federation/token
 *   2. This module issues a signed JWT with aud=[target], iss=secureyeoman
 *   3. The consuming service verifies via a shared secret or JWKS endpoint
 *   4. Token is short-lived (5 min default) and single-audience
 *
 * Phase B — SSO/OAuth2 Token Federation
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { uuidv7 } from '../utils/crypto.js';
import type { SecureLogger } from '../logging/logger.js';

export type FederationAudience = 'agnostic' | 'agnos' | string;

export interface FederationTokenConfig {
  /** HMAC secret for signing federation tokens (separate from session secret) */
  signingSecret: string;
  /** Default TTL in seconds. Default: 300 (5 min) */
  defaultTtlSeconds?: number;
  /** Maximum allowed TTL in seconds. Default: 3600 (1 hour) */
  maxTtlSeconds?: number;
  /** Issuer claim. Default: 'secureyeoman' */
  issuer?: string;
}

export interface FederationTokenRequest {
  /** Target service audience */
  audience: FederationAudience;
  /** Subject (user ID or service ID) */
  subject: string;
  /** Role to convey */
  role: string;
  /** Scoped permissions for the target service */
  scopes?: string[];
  /** Custom TTL override (bounded by maxTtlSeconds) */
  ttlSeconds?: number;
  /** Extra claims to include */
  metadata?: Record<string, unknown>;
}

export interface FederationTokenResult {
  token: string;
  expiresIn: number;
  expiresAt: number;
  audience: string;
  jti: string;
}

export interface FederationTokenPayload {
  sub: string;
  aud: string;
  iss: string;
  role: string;
  scopes: string[];
  jti: string;
  type: 'federation';
  metadata?: Record<string, unknown>;
}

export class TokenFederationService {
  private readonly secret: Uint8Array;
  private readonly defaultTtl: number;
  private readonly maxTtl: number;
  private readonly issuer: string;
  private readonly logger: SecureLogger | null;

  constructor(config: FederationTokenConfig, logger?: SecureLogger) {
    this.secret = new TextEncoder().encode(config.signingSecret);
    this.defaultTtl = config.defaultTtlSeconds ?? 300;
    this.maxTtl = config.maxTtlSeconds ?? 3600;
    this.issuer = config.issuer ?? 'secureyeoman';
    this.logger = logger ?? null;
  }

  /**
   * Issue a scoped federation token for a target service.
   */
  async issueToken(request: FederationTokenRequest): Promise<FederationTokenResult> {
    const ttl = Math.min(request.ttlSeconds ?? this.defaultTtl, this.maxTtl);
    const jti = uuidv7();
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;

    const token = await new SignJWT({
      sub: request.subject,
      role: request.role,
      scopes: request.scopes ?? [],
      type: 'federation',
      ...(request.metadata ? { metadata: request.metadata } : {}),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${ttl}s`)
      .setAudience(request.audience)
      .setIssuer(this.issuer)
      .setJti(jti)
      .sign(this.secret);

    this.logger?.info(
      {
        audience: request.audience,
        subject: request.subject,
        role: request.role,
        ttl,
        jti,
      },
      'Federation token issued'
    );

    return { token, expiresIn: ttl, expiresAt, audience: request.audience, jti };
  }

  /**
   * Verify an inbound federation token (e.g., from AGNOSTIC calling back).
   */
  async verifyToken(token: string, expectedAudience?: string): Promise<FederationTokenPayload> {
    const { payload } = await jwtVerify(token, this.secret, {
      algorithms: ['HS256'],
      issuer: this.issuer,
      ...(expectedAudience ? { audience: expectedAudience } : {}),
    });

    const p = payload as JWTPayload & Record<string, unknown>;

    if (p.type !== 'federation') {
      throw new Error('Not a federation token');
    }

    return {
      sub: p.sub!,
      aud: (Array.isArray(p.aud) ? p.aud[0] : p.aud)!,
      iss: p.iss!,
      role: p.role as string,
      scopes: (p.scopes as string[]) ?? [],
      jti: p.jti!,
      type: 'federation',
      metadata: p.metadata as Record<string, unknown> | undefined,
    };
  }
}
