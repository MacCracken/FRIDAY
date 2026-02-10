/**
 * Integration Test: Gateway API
 *
 * Tests public/protected routes, RBAC enforcement, API key auth,
 * and endpoint accessibility via Fastify inject().
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

describe('Gateway API Integration', () => {
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

  // ── Public routes ─────────────────────────────────────────────────

  it('GET /health is accessible without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('POST /api/v1/auth/login is accessible without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { password: TEST_ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Protected routes: 401 without auth ─────────────────────────────

  it('GET /api/v1/metrics returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/tasks returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/v1/audit returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/v1/audit/verify returns 401 without auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/audit/verify' });
    expect(res.statusCode).toBe(401);
  });

  // ── Protected routes: 200 with Bearer token ───────────────────────

  it('GET /api/v1/metrics returns 200 with valid token', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/v1/tasks returns 200 with valid token', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── RBAC enforcement ──────────────────────────────────────────────

  it('viewer gets 403 on admin-only endpoints', async () => {
    const { accessToken } = await loginAndGetToken(app);

    // Create a viewer API key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'viewer-key', role: 'viewer' },
    });
    const viewerKey = JSON.parse(createRes.body).key;

    // Viewer should NOT be able to access security events
    const eventsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/security/events',
      headers: { 'x-api-key': viewerKey },
    });
    expect(eventsRes.statusCode).toBe(403);
  });

  it('viewer gets 200 on viewer-allowed endpoints', async () => {
    const { accessToken } = await loginAndGetToken(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'viewer-key2', role: 'viewer' },
    });
    const viewerKey = JSON.parse(createRes.body).key;

    // Viewer CAN access metrics
    const metricsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { 'x-api-key': viewerKey },
    });
    expect(metricsRes.statusCode).toBe(200);

    // Viewer CAN access tasks
    const tasksRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks',
      headers: { 'x-api-key': viewerKey },
    });
    expect(tasksRes.statusCode).toBe(200);
  });

  // ── API key auth via X-API-Key header ─────────────────────────────

  it('API key auth via X-API-Key header works', async () => {
    const { accessToken } = await loginAndGetToken(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'api-test', role: 'admin' },
    });
    const apiKey = JSON.parse(createRes.body).key;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { 'x-api-key': apiKey },
    });
    expect(res.statusCode).toBe(200);
  });

  // ── Login → use token → access endpoints ──────────────────────────

  it('login → use token → access metrics, audit, tasks', async () => {
    const { accessToken } = await loginAndGetToken(app);

    const endpoints = ['/api/v1/metrics', '/api/v1/tasks', '/api/v1/audit'];

    for (const url of endpoints) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  // ── Audit verify endpoint ─────────────────────────────────────────

  it('audit verify endpoint returns valid chain', async () => {
    const { accessToken } = await loginAndGetToken(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/audit/verify',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.valid).toBe(true);
    expect(body.entriesChecked).toBeGreaterThanOrEqual(0);
  });

  // ── Invalid token ──────────────────────────────────────────────

  it('returns 401 for invalid Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for invalid API key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/metrics',
      headers: { 'x-api-key': 'sck_invalid_key_value' },
    });
    expect(res.statusCode).toBe(401);
  });
});
