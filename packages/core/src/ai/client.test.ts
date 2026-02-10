import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIClient } from './client.js';
import type { AIRequest, AIResponse, AIStreamChunk, ModelConfig } from '@friday/shared';

// Mock getSecret to return a fake key
vi.mock('../config/loader.js', () => ({
  getSecret: vi.fn().mockReturnValue('test-api-key'),
}));

// Mock all providers with proper class constructors
vi.mock('./providers/anthropic.js', () => ({
  AnthropicProvider: class {
    name = 'anthropic';
    chat = vi.fn();
    chatStream = vi.fn();
    constructor() {}
  },
}));

vi.mock('./providers/openai.js', () => ({
  OpenAIProvider: class {
    name = 'openai';
    chat = vi.fn();
    chatStream = vi.fn();
    constructor() {}
  },
}));

vi.mock('./providers/gemini.js', () => ({
  GeminiProvider: class {
    name = 'gemini';
    chat = vi.fn();
    chatStream = vi.fn();
    constructor() {}
  },
}));

vi.mock('./providers/ollama.js', () => ({
  OllamaProvider: class {
    name = 'ollama';
    chat = vi.fn();
    chatStream = vi.fn();
    constructor() {}
  },
}));

function makeModelConfig(provider: string): ModelConfig {
  return {
    provider: provider as ModelConfig['provider'],
    model: 'test-model',
    apiKeyEnv: 'TEST_API_KEY',
    maxTokens: 1024,
    temperature: 0.7,
    maxRequestsPerMinute: 60,
    requestTimeoutMs: 30000,
    maxRetries: 2,
    retryDelayMs: 100,
  };
}

const mockRequest: AIRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
};

const mockResponse: AIResponse = {
  id: 'test-id',
  content: 'Hello world',
  usage: { inputTokens: 10, outputTokens: 20, cachedTokens: 0, totalTokens: 30 },
  stopReason: 'end_turn',
  model: 'test-model',
  provider: 'anthropic',
};

describe('AIClient', () => {
  describe('provider factory', () => {
    it('should create AnthropicProvider for anthropic config', () => {
      const client = new AIClient({ model: makeModelConfig('anthropic') });
      expect(client.getProviderName()).toBe('anthropic');
    });

    it('should create OpenAIProvider for openai config', () => {
      const client = new AIClient({ model: makeModelConfig('openai') });
      expect(client.getProviderName()).toBe('openai');
    });

    it('should create GeminiProvider for gemini config', () => {
      const client = new AIClient({ model: makeModelConfig('gemini') });
      expect(client.getProviderName()).toBe('gemini');
    });

    it('should create OllamaProvider for ollama config', () => {
      const client = new AIClient({ model: makeModelConfig('ollama') });
      expect(client.getProviderName()).toBe('ollama');
    });
  });

  describe('chat', () => {
    let client: AIClient;

    beforeEach(() => {
      client = new AIClient({ model: makeModelConfig('anthropic') });
      // Access the private provider and mock its chat method
      const provider = (client as any).provider;
      provider.chat = vi.fn().mockResolvedValue(mockResponse);
    });

    it('should delegate to provider chat method', async () => {
      const response = await client.chat(mockRequest);
      expect(response.content).toBe('Hello world');
      expect(response.usage.totalTokens).toBe(30);
    });

    it('should track usage after successful call', async () => {
      await client.chat(mockRequest);
      const stats = client.getUsageStats();
      expect(stats.tokensUsedToday).toBe(30);
      expect(stats.apiCallsTotal).toBe(1);
    });

    it('should track errors on failure', async () => {
      const provider = (client as any).provider;
      provider.chat = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(client.chat(mockRequest)).rejects.toThrow('fail');
      const stats = client.getUsageStats();
      expect(stats.apiErrorsTotal).toBe(1);
    });

    it('should record audit events', async () => {
      const mockAuditChain = { record: vi.fn().mockResolvedValue(undefined) };
      const auditClient = new AIClient(
        { model: makeModelConfig('anthropic') },
        { auditChain: mockAuditChain as any },
      );
      const provider = (auditClient as any).provider;
      provider.chat = vi.fn().mockResolvedValue(mockResponse);

      await auditClient.chat(mockRequest);
      // Should record request + response
      expect(mockAuditChain.record).toHaveBeenCalledTimes(2);
      expect(mockAuditChain.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai_request' }),
      );
      expect(mockAuditChain.record).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'ai_response' }),
      );
    });
  });

  describe('chatStream', () => {
    it('should yield chunks from provider', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic') });
      const chunks: AIStreamChunk[] = [
        { type: 'content_delta', content: 'Hello' },
        { type: 'content_delta', content: ' world' },
        { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 5, outputTokens: 10, cachedTokens: 0, totalTokens: 15 } },
      ];

      const provider = (client as any).provider;
      provider.chatStream = vi.fn().mockImplementation(async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      });

      const received: AIStreamChunk[] = [];
      for await (const chunk of client.chatStream(mockRequest)) {
        received.push(chunk);
      }

      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ type: 'content_delta', content: 'Hello' });
      expect(received[2]!.type).toBe('done');
    });
  });

  describe('usage tracking', () => {
    it('should return empty stats initially', () => {
      const client = new AIClient({ model: makeModelConfig('anthropic') });
      const stats = client.getUsageStats();
      expect(stats.tokensUsedToday).toBe(0);
      expect(stats.costUsdToday).toBe(0);
      expect(stats.apiCallsTotal).toBe(0);
    });
  });
});
