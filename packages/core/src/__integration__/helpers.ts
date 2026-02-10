/**
 * Integration Test Helpers
 *
 * Creates a fully-wired component stack with in-memory backends.
 * Uses Fastify inject() for HTTP tests (no real network).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { AuthService, type AuthServiceConfig, type AuthServiceDeps } from '../security/auth.js';
import { AuthStorage } from '../security/auth-storage.js';
import { AuditChain, InMemoryAuditStorage, type AuditChainStorage } from '../logging/audit-chain.js';
import { RBAC, initializeRBAC } from '../security/rbac.js';
import { RateLimiter, createRateLimiter } from '../security/rate-limiter.js';
import { createAuthHook, createRbacHook } from '../gateway/auth-middleware.js';
import { registerAuthRoutes } from '../gateway/auth-routes.js';
import type { SecureLogger } from '../logging/logger.js';
import type { SecurityConfig } from '@friday/shared';

// ── Constants ──────────────────────────────────────────────────────

export const TEST_SIGNING_KEY = 'a]&3Gk9$mQ#vL7@pR!wZ5*xN2^bT8+dF';
export const TEST_TOKEN_SECRET = 'test-token-secret-at-least-32chars!!';
export const TEST_ADMIN_PASSWORD = 'test-admin-password-32chars!!';

// ── Noop Logger ────────────────────────────────────────────────────

export function noopLogger(): SecureLogger {
  const noop = () => {};
  return {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    child: () => noopLogger(),
    level: 'silent',
  } as SecureLogger;
}

// ── Test Stack ─────────────────────────────────────────────────────

export interface TestStack {
  authService: AuthService;
  auditChain: AuditChain;
  auditStorage: InMemoryAuditStorage;
  authStorage: AuthStorage;
  rbac: RBAC;
  rateLimiter: RateLimiter;
  logger: SecureLogger;
  cleanup: () => void;
}

export function createTestStack(): TestStack {
  const logger = noopLogger();
  const auditStorage = new InMemoryAuditStorage();
  const auditChain = new AuditChain({ storage: auditStorage, signingKey: TEST_SIGNING_KEY });
  const rbac = initializeRBAC();
  const rateLimiter = createRateLimiter({
    rateLimiting: {
      enabled: true,
      defaultWindowMs: 60000,
      defaultMaxRequests: 100,
    },
  } as SecurityConfig);

  // Add auth rate limit rule
  rateLimiter.addRule({
    name: 'auth_attempts',
    windowMs: 900000,
    maxRequests: 5,
    keyType: 'ip',
    onExceed: 'reject',
  });

  const authStorage = new AuthStorage();
  const authService = new AuthService(
    {
      tokenSecret: TEST_TOKEN_SECRET,
      tokenExpirySeconds: 3600,
      refreshTokenExpirySeconds: 86400,
      adminPassword: TEST_ADMIN_PASSWORD,
    },
    {
      storage: authStorage,
      auditChain,
      rbac,
      rateLimiter,
      logger: logger.child({ component: 'AuthService' }),
    },
  );

  return {
    authService,
    auditChain,
    auditStorage,
    authStorage,
    rbac,
    rateLimiter,
    logger,
    cleanup: () => {
      rateLimiter.stop();
      authStorage.close();
    },
  };
}

// ── Test Gateway (Fastify with inject) ─────────────────────────────

export async function createTestGateway(stack: TestStack): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const logger = stack.logger;

  // Auth + RBAC hooks
  app.addHook(
    'onRequest',
    createAuthHook({ authService: stack.authService, logger }),
  );
  app.addHook(
    'onRequest',
    createRbacHook({
      rbac: stack.rbac,
      auditChain: stack.auditChain,
      logger,
    }),
  );

  // Auth routes
  registerAuthRoutes(app, {
    authService: stack.authService,
    rateLimiter: stack.rateLimiter,
  });

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0-test',
  }));

  // Metrics (protected)
  app.get('/api/v1/metrics', async () => ({
    timestamp: Date.now(),
    tasks: { total: 0 },
  }));

  // Tasks (protected)
  app.get('/api/v1/tasks', async () => ({
    tasks: [],
    total: 0,
  }));

  // Security events (protected)
  app.get('/api/v1/security/events', async () => ({
    events: [],
    total: 0,
  }));

  // Audit query (protected)
  app.get('/api/v1/audit', async () => {
    return stack.auditStorage.query();
  });

  // Audit verify (protected)
  app.post('/api/v1/audit/verify', async () => {
    return stack.auditChain.verify();
  });

  await app.ready();
  return app;
}

// ── Helpers ────────────────────────────────────────────────────────

export async function loginAndGetToken(
  app: FastifyInstance,
  password = TEST_ADMIN_PASSWORD,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { password },
  });
  const body = JSON.parse(res.body);
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
}
