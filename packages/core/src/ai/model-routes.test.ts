import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerModelRoutes } from './model-routes.js';
import { _clearDynamicCache } from './cost-calculator.js';
import type { SecureYeoman } from '../secureyeoman.js';

// Mock global fetch so getAvailableModelsAsync doesn't make real network calls
const mockFetch = vi.fn().mockImplementation((url: string) => {
  // Gemini ListModels
  if (url.includes('generativelanguage.googleapis.com')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 1048576,
            outputTokenLimit: 8192,
          },
        ],
      }),
    });
  }
  // Anthropic Models
  if (url.includes('api.anthropic.com')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
        ],
      }),
    });
  }
  // OpenAI Models
  if (url.includes('api.openai.com')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o', owned_by: 'openai' },
        ],
      }),
    });
  }
  // OpenCode Models
  if (url.includes('opencode.ai')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-5.2', owned_by: 'opencode' },
        ],
      }),
    });
  }
  // Ollama Tags
  if (url.includes('/api/tags')) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:latest', size: 4700000000 },
        ],
      }),
    });
  }
  return Promise.resolve({ ok: false });
});
vi.stubGlobal('fetch', mockFetch);

// Set provider env vars so getAvailableModelsAsync(true) includes all providers
const ENV_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'OPENCODE_API_KEY', 'OLLAMA_HOST'];
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  process.env[key] = process.env[key] ?? 'test-value';
}
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

function createMockSecureYeoman(overrides: Partial<{
  switchModelError: string | null;
}> = {}) {
  const mock = {
    getConfig: vi.fn().mockReturnValue({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 16384,
        temperature: 0.7,
      },
    }),
    switchModel: overrides.switchModelError
      ? vi.fn().mockImplementation(() => { throw new Error(overrides.switchModelError!); })
      : vi.fn(),
  } as unknown as SecureYeoman;

  return mock;
}

describe('Model Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
    _clearDynamicCache();
  });

  it('GET /api/v1/model/info returns current config and available models', async () => {
    const mock = createMockSecureYeoman();
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/model/info',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.current).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 16384,
      temperature: 0.7,
    });
    expect(body.available).toBeDefined();
    expect(body.available.anthropic).toBeDefined();
    expect(body.available.openai).toBeDefined();
    expect(body.available.gemini).toBeDefined();
    expect(body.available.ollama).toBeDefined();
    expect(body.available.opencode).toBeDefined();
  });

  it('GET /api/v1/model/info has correct model structure', async () => {
    const mock = createMockSecureYeoman();
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/model/info',
    });

    const body = JSON.parse(res.payload);
    const anthropicModels = body.available.anthropic;
    expect(anthropicModels.length).toBeGreaterThanOrEqual(1);
    expect(anthropicModels[0]).toHaveProperty('provider');
    expect(anthropicModels[0]).toHaveProperty('model');
    expect(anthropicModels[0]).toHaveProperty('inputPer1M');
    expect(anthropicModels[0]).toHaveProperty('outputPer1M');
  });

  it('POST /api/v1/model/switch succeeds with valid provider/model', async () => {
    const mock = createMockSecureYeoman();
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model/switch',
      payload: { provider: 'openai', model: 'gpt-4o' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.model).toBe('openai/gpt-4o');
    expect(mock.switchModel).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('POST /api/v1/model/switch returns 400 for invalid provider', async () => {
    const mock = createMockSecureYeoman();
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model/switch',
      payload: { provider: 'invalid', model: 'gpt-4o' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toContain('Invalid provider');
  });

  it('POST /api/v1/model/switch returns 400 for missing fields', async () => {
    const mock = createMockSecureYeoman();
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model/switch',
      payload: { provider: 'openai' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/model/switch returns 500 on switchModel error', async () => {
    const mock = createMockSecureYeoman({ switchModelError: 'API key missing' });
    registerModelRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/model/switch',
      payload: { provider: 'openai', model: 'gpt-4o' },
    });

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.payload).error).toContain('API key missing');
  });
});
