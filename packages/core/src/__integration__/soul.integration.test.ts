/**
 * Integration Test: Soul System
 *
 * Tests soul API endpoints via Fastify inject(), full lifecycle,
 * and RBAC enforcement.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createTestStack,
  loginAndGetToken,
  type TestStack,
} from './helpers.js';
import { createAuthHook, createRbacHook } from '../gateway/auth-middleware.js';
import { registerAuthRoutes } from '../gateway/auth-routes.js';
import { registerSoulRoutes } from '../soul/soul-routes.js';
import { SoulStorage } from '../soul/storage.js';
import { SoulManager } from '../soul/manager.js';
import type { SoulConfig } from '@friday/shared';

function defaultSoulConfig(overrides?: Partial<SoulConfig>): SoulConfig {
  return {
    enabled: true,
    learningMode: ['user_authored', 'ai_proposed'],
    maxSkills: 50,
    maxPromptTokens: 4096,
    ...overrides,
  };
}

async function createSoulTestGateway(
  stack: TestStack,
  soulManager: SoulManager,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const logger = stack.logger;

  app.addHook('onRequest', createAuthHook({ authService: stack.authService, logger }));
  app.addHook('onRequest', createRbacHook({
    rbac: stack.rbac,
    auditChain: stack.auditChain,
    logger,
  }));

  registerAuthRoutes(app, {
    authService: stack.authService,
    rateLimiter: stack.rateLimiter,
  });

  registerSoulRoutes(app, { soulManager });

  app.get('/health', async () => ({ status: 'ok' }));

  await app.ready();
  return app;
}

describe('Soul Integration', () => {
  let stack: TestStack;
  let app: FastifyInstance;
  let soulStorage: SoulStorage;
  let soulManager: SoulManager;

  beforeEach(async () => {
    stack = createTestStack();
    await stack.auditChain.initialize();

    soulStorage = new SoulStorage(); // :memory:
    soulManager = new SoulManager(soulStorage, defaultSoulConfig(), {
      auditChain: stack.auditChain,
      logger: stack.logger,
    });

    app = await createSoulTestGateway(stack, soulManager);
  });

  afterEach(async () => {
    await app.close();
    soulStorage.close();
    stack.cleanup();
  });

  // ── Auth required ──────────────────────────────────────────

  it('should return 401 for unauthenticated soul requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/soul/personality' });
    expect(res.statusCode).toBe(401);
  });

  // ── Personality CRUD ───────────────────────────────────────

  it('should create, activate, and retrieve a personality', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/personalities',
      headers,
      payload: {
        name: 'TestBot',
        description: 'A test bot',
        systemPrompt: 'You are a test bot.',
        traits: { humor: 'dry' },
        sex: 'male',
        voice: 'deep and calm',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { personality } = JSON.parse(createRes.body);
    expect(personality.name).toBe('TestBot');
    expect(personality.sex).toBe('male');
    expect(personality.voice).toBe('deep and calm');

    // List
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/personalities',
      headers,
    });
    expect(JSON.parse(listRes.body).personalities).toHaveLength(1);

    // Activate
    const activateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/soul/personalities/${personality.id}/activate`,
      headers,
    });
    expect(activateRes.statusCode).toBe(200);

    // Get active
    const activeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/personality',
      headers,
    });
    const active = JSON.parse(activeRes.body).personality;
    expect(active.id).toBe(personality.id);
    expect(active.isActive).toBe(true);
  });

  it('should update and delete a personality', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/personalities',
      headers,
      payload: { name: 'Bot', systemPrompt: 'Hello' },
    });
    const { personality } = JSON.parse(createRes.body);

    // Update
    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/soul/personalities/${personality.id}`,
      headers,
      payload: { name: 'UpdatedBot' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(JSON.parse(updateRes.body).personality.name).toBe('UpdatedBot');

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/soul/personalities/${personality.id}`,
      headers,
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  // ── Skill CRUD ─────────────────────────────────────────────

  it('should create, enable, disable, and delete a skill', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/skills',
      headers,
      payload: {
        name: 'code-review',
        description: 'Reviews code',
        instructions: 'Review code carefully.',
        source: 'user',
        status: 'active',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { skill } = JSON.parse(createRes.body);
    expect(skill.name).toBe('code-review');

    // List
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/skills',
      headers,
    });
    expect(JSON.parse(listRes.body).skills).toHaveLength(1);

    // Disable
    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/soul/skills/${skill.id}/disable`,
      headers,
    });
    expect(disableRes.statusCode).toBe(200);

    // Enable
    const enableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/soul/skills/${skill.id}/enable`,
      headers,
    });
    expect(enableRes.statusCode).toBe(200);

    // Delete
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/soul/skills/${skill.id}`,
      headers,
    });
    expect(deleteRes.statusCode).toBe(200);
  });

  // ── Skill approval workflow ────────────────────────────────

  it('should approve a proposed skill', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/skills',
      headers,
      payload: {
        name: 'proposed-skill',
        instructions: 'Do something',
        source: 'ai_proposed',
        status: 'pending_approval',
        enabled: false,
      },
    });
    const { skill } = JSON.parse(createRes.body);
    expect(skill.status).toBe('pending_approval');

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/soul/skills/${skill.id}/approve`,
      headers,
    });
    expect(approveRes.statusCode).toBe(200);
    expect(JSON.parse(approveRes.body).skill.status).toBe('active');
  });

  it('should reject a proposed skill', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/skills',
      headers,
      payload: {
        name: 'bad-skill',
        instructions: 'Do bad stuff',
        source: 'ai_proposed',
        status: 'pending_approval',
        enabled: false,
      },
    });
    const { skill } = JSON.parse(createRes.body);

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/soul/skills/${skill.id}/reject`,
      headers,
    });
    expect(rejectRes.statusCode).toBe(200);

    // Verify deleted
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/skills',
      headers,
    });
    expect(JSON.parse(listRes.body).skills).toHaveLength(0);
  });

  // ── Prompt preview ─────────────────────────────────────────

  it('should preview the composed prompt', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    // Create and activate personality
    const pRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/personalities',
      headers,
      payload: { name: 'Bot', systemPrompt: 'You are Bot.' },
    });
    const { personality } = JSON.parse(pRes.body);
    await app.inject({
      method: 'POST',
      url: `/api/v1/soul/personalities/${personality.id}/activate`,
      headers,
    });

    // Create skill
    await app.inject({
      method: 'POST',
      url: '/api/v1/soul/skills',
      headers,
      payload: { name: 'greet', instructions: 'Always greet the user warmly.' },
    });

    // Preview
    const previewRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/prompt/preview',
      headers,
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = JSON.parse(previewRes.body);
    expect(preview.prompt).toContain('You are Bot');
    expect(preview.prompt).toContain('## Skill: greet');
    expect(preview.charCount).toBeGreaterThan(0);
    expect(preview.estimatedTokens).toBeGreaterThan(0);
  });

  // ── Config endpoint ────────────────────────────────────────

  it('should return soul config', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/config',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const { config } = JSON.parse(res.body);
    expect(config.enabled).toBe(true);
    expect(config.learningMode).toContain('user_authored');
  });

  // ── Onboarding ─────────────────────────────────────────────

  it('should report onboarding needed when no personality exists', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/onboarding/status',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.needed).toBe(true);
    expect(body.personality).toBeNull();
  });

  it('should complete onboarding with custom personality', async () => {
    const { accessToken } = await loginAndGetToken(app);
    const headers = { authorization: `Bearer ${accessToken}` };

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/onboarding/complete',
      headers,
      payload: {
        name: 'CustomFRIDAY',
        sex: 'female',
        voice: 'warm and professional',
        preferredLanguage: 'English',
      },
    });
    expect(res.statusCode).toBe(201);
    const { personality } = JSON.parse(res.body);
    expect(personality.name).toBe('CustomFRIDAY');
    expect(personality.sex).toBe('female');
    expect(personality.voice).toBe('warm and professional');
    expect(personality.preferredLanguage).toBe('English');
    expect(personality.isActive).toBe(true);

    // Verify onboarding no longer needed
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/onboarding/status',
      headers,
    });
    expect(JSON.parse(statusRes.body).needed).toBe(false);
  });

  // ── RBAC ───────────────────────────────────────────────────

  it('should allow viewer to read but not write soul data', async () => {
    const { accessToken: adminToken } = await loginAndGetToken(app);
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    // Create an API key with viewer role
    const keyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/api-keys',
      headers: adminHeaders,
      payload: { name: 'viewer-key', role: 'viewer' },
    });
    const { key } = JSON.parse(keyRes.body);

    const viewerHeaders = { 'x-api-key': key };

    // Viewer can read
    const readRes = await app.inject({
      method: 'GET',
      url: '/api/v1/soul/personality',
      headers: viewerHeaders,
    });
    expect(readRes.statusCode).toBe(200);

    // Viewer cannot write
    const writeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/soul/personalities',
      headers: viewerHeaders,
      payload: { name: 'Hacker', systemPrompt: 'Nope' },
    });
    expect(writeRes.statusCode).toBe(403);
  });
});
