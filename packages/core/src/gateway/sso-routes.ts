/**
 * SSO Routes — OIDC identity provider management and authorization flow.
 *
 * Public routes (no auth):
 *   GET /api/v1/auth/sso/providers       — list enabled providers
 *   GET /api/v1/auth/sso/authorize/:id   — initiate SSO redirect
 *   GET /api/v1/auth/sso/callback/:id    — IDP callback
 *
 * Admin-only routes (require admin JWT):
 *   POST/PUT/DELETE /api/v1/auth/sso/providers/:id
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SsoManager } from '../security/sso-manager.js';
import type { SsoStorage } from '../security/sso-storage.js';
import { toErrorMessage, sendError } from '../utils/errors.js';
import type { SecureYeoman } from '../secureyeoman.js';
import { licenseGuard } from '../licensing/license-guard.js';
import { randomBytes } from 'node:crypto';

export interface SsoRoutesOptions {
  ssoManager: SsoManager;
  ssoStorage: SsoStorage;
  dashboardUrl: string;
  secureYeoman?: SecureYeoman;
}

export function registerSsoRoutes(app: FastifyInstance, opts: SsoRoutesOptions): void {
  const { ssoManager, ssoStorage, dashboardUrl, secureYeoman } = opts;
  const ssoGuardOpts = licenseGuard('sso_saml', secureYeoman);

  // Pre-compute allowed host from dashboardUrl to prevent host header injection
  const allowedHost = (() => {
    try {
      const u = new URL(dashboardUrl);
      return u.host;
    } catch {
      return 'localhost';
    }
  })();

  // ── Provider discovery (public) ──────────────────────────────────

  app.get('/api/v1/auth/sso/providers', async () => {
    const providers = await ssoStorage.listIdentityProviders(true);
    // Strip client secrets from public listing
    return {
      providers: providers.map(({ clientSecret: _s, ...p }) => p),
      total: providers.length,
    };
  });

  // ── Authorization flow (public) ──────────────────────────────────

  app.get(
    '/api/v1/auth/sso/authorize/:providerId',
    async (
      request: FastifyRequest<{
        Params: { providerId: string };
        Querystring: { workspace?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const scheme =
          (request.headers['x-forwarded-proto'] as string) ??
          ((app.server as any).encrypted ? 'https' : 'http');
        // Use validated host — never trust request.headers.host for redirect URI construction
        const host = allowedHost;
        const redirectUri = `${scheme}://${host}/api/v1/auth/sso/callback/${request.params.providerId}`;
        const url = await ssoManager.getAuthorizationUrl(
          request.params.providerId,
          redirectUri,
          request.query.workspace
        );
        return reply.redirect(url);
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/auth/sso/callback/:providerId',
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      try {
        const scheme = (request.headers['x-forwarded-proto'] as string) ?? 'http';
        // Use validated host — never trust request.headers.host for URL construction
        const host = allowedHost;
        const callbackUrl = new URL(`${scheme}://${host}${request.url}`);

        const { result, redirectUri } = await ssoManager.handleCallback(
          request.params.providerId,
          callbackUrl
        );

        // Redirect to dashboard with token in fragment.
        // Validate redirect URI against dashboard origin to prevent open-redirect attacks.
        const dashOrigin = new URL(dashboardUrl).origin;
        let target: URL;
        if (redirectUri.startsWith('http')) {
          const candidate = new URL(redirectUri);
          target = candidate.origin === dashOrigin ? candidate : new URL(dashboardUrl);
        } else {
          target = new URL(dashboardUrl);
        }
        // Generate a short-lived auth code instead of putting tokens in the fragment
        const authCode = randomBytes(32).toString('hex');
        await ssoStorage.createAuthCode(authCode, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        });
        target.searchParams.set('sso_code', authCode);
        return reply.redirect(target.toString());
      } catch (err) {
        app.log.warn({ error: toErrorMessage(err) }, 'SSO callback failed');
        const errUrl = new URL(dashboardUrl);
        errUrl.searchParams.set('sso_error', 'sso_auth_failed');
        return reply.redirect(errUrl.toString());
      }
    }
  );

  // ── Provider management (admin) ───────────────────────────────────

  app.post(
    '/api/v1/auth/sso/providers',
    ssoGuardOpts,
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          type: 'oidc' | 'saml';
          issuerUrl?: string;
          clientId?: string;
          clientSecret?: string;
          scopes?: string;
          autoProvision?: boolean;
          defaultRole?: string;
          enabled?: boolean;
          config?: Record<string, unknown>;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const provider = await ssoStorage.createIdentityProvider({
          name: request.body.name,
          type: request.body.type,
          issuerUrl: request.body.issuerUrl ?? null,
          clientId: request.body.clientId ?? null,
          clientSecret: request.body.clientSecret ?? null,
          scopes: request.body.scopes ?? 'openid email profile',
          metadataUrl: null,
          entityId: null,
          acsUrl: null,
          enabled: request.body.enabled ?? true,
          autoProvision: request.body.autoProvision ?? true,
          defaultRole: request.body.defaultRole ?? 'viewer',
          config: request.body.config ?? {},
        });
        return reply.code(201).send({ provider: { ...provider, clientSecret: undefined } });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/auth/sso/providers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const provider = await ssoStorage.getIdentityProvider(request.params.id);
      if (!provider) return sendError(reply, 404, 'Provider not found');
      return { provider: { ...provider, clientSecret: undefined } };
    }
  );

  app.put(
    '/api/v1/auth/sso/providers/:id',
    ssoGuardOpts,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
      reply: FastifyReply
    ) => {
      try {
        const provider = await ssoStorage.updateIdentityProvider(request.params.id, request.body);
        if (!provider) return sendError(reply, 404, 'Provider not found');
        return { provider: { ...provider, clientSecret: undefined } };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.delete(
    '/api/v1/auth/sso/providers/:id',
    ssoGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!(await ssoStorage.deleteIdentityProvider(request.params.id)))
        return sendError(reply, 404, 'Provider not found');
      return { message: 'Provider deleted' };
    }
  );

  // ── SAML SP Metadata (public) ─────────────────────────────────────
  app.get(
    '/api/v1/auth/sso/saml/:providerId/metadata',
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      try {
        const provider = await ssoStorage.getIdentityProvider(request.params.providerId);
        if (!provider) return sendError(reply, 404, 'Provider not found');
        if (provider.type !== 'saml')
          return sendError(reply, 400, 'Provider is not a SAML provider');

        const { SamlAdapter } = await import('../security/saml-adapter.js');
        const adapter = new SamlAdapter(provider);
        const xml = await adapter.getSpMetadataXml();
        return reply.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  // ── SAML ACS (public) ─────────────────────────────────────────────
  app.post(
    '/api/v1/auth/sso/saml/:providerId/acs',
    async (
      request: FastifyRequest<{ Params: { providerId: string }; Body: Record<string, string> }>,
      reply: FastifyReply
    ) => {
      try {
        const { result, redirectUri } = await ssoManager.handleSamlCallback(
          request.params.providerId,
          request.body ?? {}
        );

        // Validate redirect URI against dashboard origin to prevent open-redirect attacks
        const dashOrigin = new URL(dashboardUrl).origin;
        let target: URL;
        if (redirectUri.startsWith('http')) {
          const candidate = new URL(redirectUri);
          target = candidate.origin === dashOrigin ? candidate : new URL(dashboardUrl);
        } else {
          target = new URL(dashboardUrl);
        }
        const authCode = randomBytes(32).toString('hex');
        await ssoStorage.createAuthCode(authCode, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        });
        target.searchParams.set('sso_code', authCode);
        return reply.redirect(target.toString());
      } catch (err) {
        app.log.warn({ error: toErrorMessage(err) }, 'SSO SAML callback failed');
        const errUrl = new URL(dashboardUrl);
        errUrl.searchParams.set('sso_error', 'sso_auth_failed');
        return reply.redirect(errUrl.toString());
      }
    }
  );

  // ── Exchange SSO auth code for tokens (public) ─────────────────────
  app.post(
    '/api/v1/auth/sso/exchange',
    { config: { skipAuth: true } } as Record<string, unknown>,
    async (request: FastifyRequest<{ Body: { code: string } }>, reply: FastifyReply) => {
      const { code } = request.body ?? ({} as any);
      if (!code) {
        return sendError(reply, 400, 'Authorization code is required');
      }
      const tokens = await ssoStorage.consumeAuthCode(code);
      if (!tokens) {
        return sendError(reply, 401, 'Invalid or expired authorization code');
      }
      return tokens;
    }
  );
}
