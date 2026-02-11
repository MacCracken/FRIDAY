import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIClient } from './client.js';
import type { AIRequest, AIResponse, AIStreamChunk, ModelConfig, FallbackModelConfig } from '@friday/shared';
import { RateLimitError, ProviderUnavailableError, AuthenticationError } from './errors.js';

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

function makeModelConfig(provider: string, fallbacks?: FallbackModelConfig[]): ModelConfig {
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
    fallbacks: fallbacks ?? [],
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

  describe('fallback', () => {
    const fallbacks: FallbackModelConfig[] = [
      { provider: 'openai', model: 'gpt-4o', apiKeyEnv: 'OPENAI_API_KEY' },
      { provider: 'gemini', model: 'gemini-2.0-flash', apiKeyEnv: 'GOOGLE_API_KEY' },
    ];

    const fallbackResponse: AIResponse = {
      id: 'fb-id',
      content: 'Fallback response',
      usage: { inputTokens: 5, outputTokens: 10, cachedTokens: 0, totalTokens: 15 },
      stopReason: 'end_turn',
      model: 'gpt-4o',
      provider: 'openai',
    };

    it('should fall back on RateLimitError', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      const primaryProvider = (client as any).provider;
      primaryProvider.chat = vi.fn().mockRejectedValue(new RateLimitError('anthropic'));

      // The fallback provider gets created lazily — we need to mock it after first access
      const response = await (async () => {
        // Trigger fallback creation
        try {
          return await client.chat(mockRequest);
        } catch {
          // First attempt may fail if fallback provider isn't mocked
          return null;
        }
      })();

      // Since providers are mocked globally, the fallback OpenAI provider's chat is a vi.fn()
      // We need to set up the fallback provider mock before calling
      const client2 = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      (client2 as any).provider.chat = vi.fn().mockRejectedValue(new RateLimitError('anthropic'));

      // Pre-set a mock fallback provider
      const mockFbProvider = { name: 'openai', chat: vi.fn().mockResolvedValue(fallbackResponse), chatStream: vi.fn() };
      (client2 as any).fallbackProviders.set(0, mockFbProvider);

      const result = await client2.chat(mockRequest);
      expect(result.content).toBe('Fallback response');
      expect(result.provider).toBe('openai');
    });

    it('should fall back on ProviderUnavailableError', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      (client as any).provider.chat = vi.fn().mockRejectedValue(new ProviderUnavailableError('anthropic', 503));

      const mockFbProvider = { name: 'openai', chat: vi.fn().mockResolvedValue(fallbackResponse), chatStream: vi.fn() };
      (client as any).fallbackProviders.set(0, mockFbProvider);

      const result = await client.chat(mockRequest);
      expect(result.content).toBe('Fallback response');
    });

    it('should NOT fall back on AuthenticationError', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      (client as any).provider.chat = vi.fn().mockRejectedValue(new AuthenticationError('anthropic'));

      await expect(client.chat(mockRequest)).rejects.toThrow('Authentication failed');
    });

    it('should try multiple fallbacks in order', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      (client as any).provider.chat = vi.fn().mockRejectedValue(new RateLimitError('anthropic'));

      // First fallback also rate-limited
      const mockFb0 = { name: 'openai', chat: vi.fn().mockRejectedValue(new RateLimitError('openai')), chatStream: vi.fn() };
      const geminiResponse = { ...fallbackResponse, provider: 'gemini', model: 'gemini-2.0-flash', content: 'Gemini response' };
      const mockFb1 = { name: 'gemini', chat: vi.fn().mockResolvedValue(geminiResponse), chatStream: vi.fn() };
      (client as any).fallbackProviders.set(0, mockFb0);
      (client as any).fallbackProviders.set(1, mockFb1);

      const result = await client.chat(mockRequest);
      expect(result.content).toBe('Gemini response');
      expect(mockFb0.chat).toHaveBeenCalledOnce();
      expect(mockFb1.chat).toHaveBeenCalledOnce();
    });

    it('should throw original error when all fallbacks exhausted', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      const originalError = new RateLimitError('anthropic', 30);
      (client as any).provider.chat = vi.fn().mockRejectedValue(originalError);

      const mockFb0 = { name: 'openai', chat: vi.fn().mockRejectedValue(new RateLimitError('openai')), chatStream: vi.fn() };
      const mockFb1 = { name: 'gemini', chat: vi.fn().mockRejectedValue(new ProviderUnavailableError('gemini')), chatStream: vi.fn() };
      (client as any).fallbackProviders.set(0, mockFb0);
      (client as any).fallbackProviders.set(1, mockFb1);

      await expect(client.chat(mockRequest)).rejects.toBe(originalError);
    });

    it('should lazily instantiate fallback providers', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });

      // No fallback providers created yet
      expect((client as any).fallbackProviders.size).toBe(0);

      // Trigger a non-fallback error — no providers should be created
      (client as any).provider.chat = vi.fn().mockRejectedValue(new Error('generic'));
      await expect(client.chat(mockRequest)).rejects.toThrow('generic');
      expect((client as any).fallbackProviders.size).toBe(0);
    });

    it('should audit-log fallback_triggered, fallback_attempt, fallback_success', async () => {
      const mockAuditChain = { record: vi.fn().mockResolvedValue(undefined) };
      const client = new AIClient(
        { model: makeModelConfig('anthropic', fallbacks) },
        { auditChain: mockAuditChain as any },
      );
      (client as any).provider.chat = vi.fn().mockRejectedValue(new RateLimitError('anthropic'));

      const mockFbProvider = { name: 'openai', chat: vi.fn().mockResolvedValue(fallbackResponse), chatStream: vi.fn() };
      (client as any).fallbackProviders.set(0, mockFbProvider);

      await client.chat(mockRequest);

      const events = mockAuditChain.record.mock.calls.map((c: any) => c[0].event);
      expect(events).toContain('ai_fallback_triggered');
      expect(events).toContain('ai_fallback_attempt');
      expect(events).toContain('ai_fallback_success');
    });

    it('should audit-log fallback_exhausted when all fail', async () => {
      const mockAuditChain = { record: vi.fn().mockResolvedValue(undefined) };
      const client = new AIClient(
        { model: makeModelConfig('anthropic', fallbacks) },
        { auditChain: mockAuditChain as any },
      );
      (client as any).provider.chat = vi.fn().mockRejectedValue(new RateLimitError('anthropic'));

      const mockFb0 = { name: 'openai', chat: vi.fn().mockRejectedValue(new RateLimitError('openai')), chatStream: vi.fn() };
      const mockFb1 = { name: 'gemini', chat: vi.fn().mockRejectedValue(new RateLimitError('gemini')), chatStream: vi.fn() };
      (client as any).fallbackProviders.set(0, mockFb0);
      (client as any).fallbackProviders.set(1, mockFb1);

      await expect(client.chat(mockRequest)).rejects.toThrow();

      const events = mockAuditChain.record.mock.calls.map((c: any) => c[0].event);
      expect(events).toContain('ai_fallback_exhausted');
    });

    it('should work with no fallbacks configured (existing behavior)', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic') });
      (client as any).provider.chat = vi.fn().mockResolvedValue(mockResponse);

      const result = await client.chat(mockRequest);
      expect(result.content).toBe('Hello world');
    });

    it('should fall back on stream error', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });
      (client as any).provider.chatStream = vi.fn().mockImplementation(async function* () {
        throw new RateLimitError('anthropic');
      });

      const fbChunks: AIStreamChunk[] = [
        { type: 'content_delta', content: 'Fallback' },
        { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 5, cachedTokens: 0, totalTokens: 8 } },
      ];
      const mockFbProvider = {
        name: 'openai',
        chat: vi.fn(),
        chatStream: vi.fn().mockImplementation(async function* () {
          for (const chunk of fbChunks) yield chunk;
        }),
      };
      (client as any).fallbackProviders.set(0, mockFbProvider);

      const received: AIStreamChunk[] = [];
      for await (const chunk of client.chatStream(mockRequest)) {
        received.push(chunk);
      }

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ type: 'content_delta', content: 'Fallback' });
    });

    it('should fall back when stream fails mid-delivery', async () => {
      const client = new AIClient({ model: makeModelConfig('anthropic', fallbacks) });

      // Primary yields one chunk then throws
      (client as any).provider.chatStream = vi.fn().mockImplementation(async function* () {
        yield { type: 'content_delta', content: 'Partial' } as AIStreamChunk;
        throw new ProviderUnavailableError('anthropic', 502);
      });

      const fbChunks: AIStreamChunk[] = [
        { type: 'content_delta', content: 'Complete fallback' },
        { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 3, outputTokens: 5, cachedTokens: 0, totalTokens: 8 } },
      ];
      const mockFbProvider = {
        name: 'openai',
        chat: vi.fn(),
        chatStream: vi.fn().mockImplementation(async function* () {
          for (const chunk of fbChunks) yield chunk;
        }),
      };
      (client as any).fallbackProviders.set(0, mockFbProvider);

      const received: AIStreamChunk[] = [];
      for await (const chunk of client.chatStream(mockRequest)) {
        received.push(chunk);
      }

      // Should see partial from primary + complete from fallback
      expect(received).toHaveLength(3);
      expect(received[0]).toEqual({ type: 'content_delta', content: 'Partial' });
      expect(received[1]).toEqual({ type: 'content_delta', content: 'Complete fallback' });
    });
  });
});
