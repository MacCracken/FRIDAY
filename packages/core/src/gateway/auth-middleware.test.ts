import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthService } from '../security/auth.js';
import { AuthStorage } from '../security/auth-storage.js';
import { AuditChain, InMemoryAuditStorage } from '../logging/audit-chain.js';
import { RBAC } from '../security/rbac.js';
import { RateLimiter } from '../security/rate-limiter.js';
import { createAuthHook, createRbacHook } from './auth-middleware.js';
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

describe('Auth Middleware', () => {
  let app: FastifyInstance;
  let authStorage: AuthStorage;
  let authService: AuthService;
  let rbac: RBAC;
  let rateLimiter: RateLimiter;
  let auditChain: AuditChain;

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
      maxRequests: 50,
      keyType: 'ip',
      onExceed: 'reject',
    });

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
        rbac,
        rateLimiter,
        logger: noopLogger(),
      },
    );

    app = Fastify({ logger: false });

    const logger = noopLogger();
    app.addHook('onRequest', createAuthHook({ authService, logger }));
    app.addHook('onRequest', createRbacHook({ rbac, auditChain, logger }));

    // Register test routes that match the permission map
    app.get('/health', async () => ({ status: 'ok' }));
    app.post('/api/v1/auth/login', async () => ({ ok: true }));
    app.post('/api/v1/auth/logout', async (req) => ({ user: req.authUser?.userId }));
    app.get('/api/v1/metrics', async (req) => ({ user: req.authUser?.userId }));
    app.get('/api/v1/tasks', async (req) => ({ user: req.authUser?.userId }));
    app.get('/api/v1/audit', async (req) => ({ user: req.authUser?.userId }));
    app.post('/api/v1/audit/verify', async (req) => ({ user: req.authUser?.userId }));
    app.get('/api/v1/security/events', async (req) => ({ user: req.authUser?.userId }));
    app.post('/api/v1/auth/api-keys', async (req) => ({ user: req.authUser?.userId }));
    app.get('/api/v1/auth/api-keys', async (req) => ({ user: req.authUser?.userId }));
    app.delete('/api/v1/auth/api-keys/:id', async (req) => ({ user: req.authUser?.userId }));
    // unmapped route
    app.get('/api/v1/admin/danger', async (req) => ({ user: req.authUser?.userId }));

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    authStorage.close();
    rateLimiter.stop();
  });

  // helper
  async function loginAndGetToken(): Promise<string> {
    const result = await authService.login(ADMIN_PASSWORD, '127.0.0.1');
    return result.accessToken;
  }

  async function createViewerApiKey(): Promise<string> {
    const { key } = await authService.createApiKey({
      name: 'viewer-key',
      role: 'viewer',
      userId: 'admin',
    });
    return key;
  }

  // ── Public routes bypass auth ────────────────────────────────────

  describe('public routes', () => {
    it('GET /health should be accessible without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
    });

    it('POST /api/v1/auth/login should be accessible without auth', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: {} });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── 401 on missing credentials ──────────────────────────────────

  describe('missing credentials', () => {
    it('should return 401 for protected route without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatch(/Missing authentication/i);
    });
  });

  // ── Bearer token auth ───────────────────────────────────────────

  describe('Bearer token', () => {
    it('should authenticate with a valid Bearer token', async () => {
      const token = await loginAndGetToken();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toBe('admin');
    });

    it('should return 401 for an invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
        headers: { authorization: 'Bearer invalid.token.here' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── X-API-Key auth ──────────────────────────────────────────────

  describe('X-API-Key', () => {
    it('should authenticate with a valid API key', async () => {
      const key = await createViewerApiKey();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
        headers: { 'x-api-key': key },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user).toBe('admin');
    });

    it('should return 401 for an invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/metrics',
        headers: { 'x-api-key': 'sck_invalid' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── RBAC enforcement ────────────────────────────────────────────

  describe('RBAC', () => {
    it('admin can access everything', async () => {
      const token = await loginAndGetToken();
      const headers = { authorization: `Bearer ${token}` };

      const metricsRes = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers });
      expect(metricsRes.statusCode).toBe(200);

      const auditRes = await app.inject({ method: 'GET', url: '/api/v1/audit', headers });
      expect(auditRes.statusCode).toBe(200);

      const keysRes = await app.inject({ method: 'POST', url: '/api/v1/auth/api-keys', headers, payload: {} });
      expect(keysRes.statusCode).toBe(200);
    });

    it('viewer can read metrics and tasks but not audit', async () => {
      const key = await createViewerApiKey();
      const headers = { 'x-api-key': key };

      const metricsRes = await app.inject({ method: 'GET', url: '/api/v1/metrics', headers });
      expect(metricsRes.statusCode).toBe(200);

      const tasksRes = await app.inject({ method: 'GET', url: '/api/v1/tasks', headers });
      expect(tasksRes.statusCode).toBe(200);

      const auditRes = await app.inject({ method: 'GET', url: '/api/v1/audit', headers });
      expect(auditRes.statusCode).toBe(403);

      const secEventsRes = await app.inject({ method: 'GET', url: '/api/v1/security/events', headers });
      expect(secEventsRes.statusCode).toBe(403);
    });

    it('viewer cannot access admin-only routes', async () => {
      const key = await createViewerApiKey();
      const headers = { 'x-api-key': key };

      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/api-keys', headers, payload: {} });
      expect(res.statusCode).toBe(403);
    });

    it('unmapped routes default-deny for non-admin', async () => {
      const key = await createViewerApiKey();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/danger',
        headers: { 'x-api-key': key },
      });
      expect(res.statusCode).toBe(403);
    });

    it('admin can access unmapped routes', async () => {
      const token = await loginAndGetToken();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/danger',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ── Token-only routes ───────────────────────────────────────────

  describe('token-only routes', () => {
    it('should allow authenticated user to access logout without RBAC check', async () => {
      const token = await loginAndGetToken();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});
