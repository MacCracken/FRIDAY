import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerChatRoutes } from './chat-routes.js';
import type { SecureYeoman } from '../secureyeoman.js';

function createMockSecureYeoman(overrides: Partial<{
  aiClient: unknown;
  soulManager: unknown;
  hasAiClient: boolean;
}> = {}) {
  const mockAiClient = {
    chat: vi.fn().mockResolvedValue({
      id: 'resp-1',
      content: 'Hello! I am FRIDAY.',
      toolCalls: [],
      usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 0, totalTokens: 150 },
      stopReason: 'end_turn',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
    }),
  };

  const mockSoulManager = {
    composeSoulPrompt: vi.fn().mockReturnValue('You are FRIDAY.'),
  };

  const mock = {
    getAIClient: overrides.hasAiClient === false
      ? vi.fn().mockImplementation(() => { throw new Error('AI client not available'); })
      : vi.fn().mockReturnValue(overrides.aiClient ?? mockAiClient),
    getSoulManager: vi.fn().mockReturnValue(overrides.soulManager ?? mockSoulManager),
  } as unknown as SecureYeoman;

  return { mock, mockAiClient, mockSoulManager };
}

describe('Chat Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(() => {
    app = Fastify();
  });

  it('POST /api/v1/chat returns assistant response', async () => {
    const { mock } = createMockSecureYeoman();
    registerChatRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'Hello!' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.role).toBe('assistant');
    expect(body.content).toBe('Hello! I am FRIDAY.');
    expect(body.model).toBe('claude-sonnet-4-20250514');
    expect(body.provider).toBe('anthropic');
    expect(body.tokensUsed).toBe(150);
  });

  it('POST /api/v1/chat includes system prompt from soul', async () => {
    const { mock, mockAiClient, mockSoulManager } = createMockSecureYeoman();
    registerChatRoutes(app, { secureYeoman: mock });

    await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'Hi there' },
    });

    expect(mockSoulManager.composeSoulPrompt).toHaveBeenCalledWith('Hi there');
    const chatCall = mockAiClient.chat.mock.calls[0][0];
    expect(chatCall.messages[0]).toEqual({ role: 'system', content: 'You are FRIDAY.' });
    expect(chatCall.messages[1]).toEqual({ role: 'user', content: 'Hi there' });
  });

  it('POST /api/v1/chat includes history in messages', async () => {
    const { mock, mockAiClient } = createMockSecureYeoman();
    registerChatRoutes(app, { secureYeoman: mock });

    await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {
        message: 'Follow up question',
        history: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
        ],
      },
    });

    const chatCall = mockAiClient.chat.mock.calls[0][0];
    // system + 2 history + 1 new user message = 4
    expect(chatCall.messages).toHaveLength(4);
    expect(chatCall.messages[1]).toEqual({ role: 'user', content: 'First message' });
    expect(chatCall.messages[2]).toEqual({ role: 'assistant', content: 'First response' });
    expect(chatCall.messages[3]).toEqual({ role: 'user', content: 'Follow up question' });
  });

  it('POST /api/v1/chat returns 400 for empty message', async () => {
    const { mock } = createMockSecureYeoman();
    registerChatRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toBe('Message is required');
  });

  it('POST /api/v1/chat returns 400 for missing message', async () => {
    const { mock } = createMockSecureYeoman();
    registerChatRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /api/v1/chat returns 503 when AI client unavailable', async () => {
    const { mock } = createMockSecureYeoman({ hasAiClient: false });
    registerChatRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'Hello!' },
    });

    expect(res.statusCode).toBe(503);
  });

  it('POST /api/v1/chat returns 502 on AI error', async () => {
    const failingClient = {
      chat: vi.fn().mockRejectedValue(new Error('Provider down')),
    };
    const { mock } = createMockSecureYeoman({ aiClient: failingClient });
    registerChatRoutes(app, { secureYeoman: mock });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'Hello!' },
    });

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.payload).error).toContain('Provider down');
  });
});
