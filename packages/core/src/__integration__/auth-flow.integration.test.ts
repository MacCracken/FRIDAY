/**
 * Integration Test: Auth Flow
 *
 * Full login → validate → refresh → logout → verify revoked,
 * API key lifecycle, rate limiting, and audit recording.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestStack,
  createTestGateway,
  loginAndGetToken,
  TEST_ADMIN_PASSWORD,
  type TestStack,
} from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('Auth Flow Integration', () => {
  let stack: TestStack;
  let app: FastifyInstance;

  beforeEach(async () => {
    stack = createTestStack();
    await stack.auditChain.initialize();
    app = await createTestGateway(stack);
  });

  afterEach(async () => {
    await app.close();
    stack.cleanup();
  });

  // ── Login / Validate / Refresh / Logout ───────────────────────────

  it('full login → validate → refresh → logout → verify revoked', async () => {
    // 1. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: TEST_ADMIN_PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    expect(loginBody.accessToken).toBeDefined();
    expect(loginBody.refreshToken).toBeDefined();
    expect(loginBody.tokenType).toBe('Bearer');

    // 2. Validate — access a protected route
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    });
    expect(metricsRes.statusCode).toBe(200);

    // 3. Refresh
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: loginBody.refreshToken },
      headers: { authorization: `Bearer ${loginBody.accessToken}` },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshBody = JSON.parse(refreshRes.body);
    expect(refreshBody.accessToken).toBeDefined();
    expect(refreshBody.refreshToken).toBeDefined();

    // 4. Logout with new token
    const user = await stack.authService.validateToken(refreshBody.accessToken);
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${refreshBody.accessToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    // 5. Verify revoked — new access token should be revoked after logout
    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { authorization: `Bearer ${refreshBody.accessToken}` },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('invalid password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing password returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  // ── API Key Lifecycle ─────────────────────────────────────────────

  it('API key create → validate → revoke → verify revoked', async () => {
    const { accessToken } = await loginAndGetToken(app);

    // Create API key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'test-key', role: 'viewer' },
    });
    expect(createRes.statusCode).toBe(201);
    const keyBody = JSON.parse(createRes.body);
    expect(keyBody.key).toMatch(/^sck_/);
    expect(keyBody.role).toBe('viewer');

    // Validate API key — access a viewer-allowed route
    const tasksRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { 'x-api-key': keyBody.key },
    });
    expect(tasksRes.statusCode).toBe(200);

    // Revoke
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/api-keys/${keyBody.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(revokeRes.statusCode).toBe(200);

    // Verify revoked
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { 'x-api-key': keyBody.key },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  // ── Rate Limiting ─────────────────────────────────────────────────

  it('rate limiting on repeated login failures', async () => {
    // auth_attempts rule: 5 max in 15 minutes
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { password: 'wrong' },
      });
    }

    // 6th attempt should be rate limited
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'wrong' },
    });
    expect(res.statusCode).toBe(429);
  });

  // ── Audit Events ─────────────────────────────────────────────────

  it('audit events recorded for auth operations', async () => {
    // Login
    await loginAndGetToken(app);

    // Check audit
    const result = await stack.auditStorage.query({
      event: ['auth_success', 'auth_failure'],
    });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries.some((e) => e.event === 'auth_success')).toBe(true);
  });

  it('failed login records auth_failure event', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: 'wrong' },
    });

    const result = await stack.auditStorage.query({
      event: ['auth_failure'],
    });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });
});
