import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './anthropic.js';
import type { AIRequest, ModelConfig } from '@friday/shared';
import { RateLimitError, AuthenticationError, ProviderUnavailableError } from '../errors.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    headers: Record<string, string>;
    constructor(status: number, message: string, headers: Record<string, string> = {}) {
      super(message);
      this.status = status;
      this.headers = headers;
      this.name = 'APIError';
    }
  }

  class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
    static APIError = APIError;
    constructor(_opts?: any) {}
  }

  return { default: MockAnthropic, APIError };
});

function makeConfig(): { model: ModelConfig; apiKey: string; retryConfig: { maxRetries: number } } {
  return {
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      maxTokens: 1024,
      temperature: 0.7,
      maxRequestsPerMinute: 60,
      requestTimeoutMs: 30000,
      maxRetries: 0,
      retryDelayMs: 100,
    },
    apiKey: 'test-key',
    retryConfig: { maxRetries: 0 },
  };
}

const simpleRequest: AIRequest = {
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
};

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider(makeConfig());
    // Use module-level mock fns directly
    mockClient = { messages: { create: mockCreate, stream: mockStream } };
  });

  describe('chat', () => {
    it('should map a simple request and response', async () => {
      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello back!' }],
        usage: { input_tokens: 10, output_tokens: 15 },
        stop_reason: 'end_turn',
      });

      const response = await provider.chat(simpleRequest);

      expect(response.id).toBe('msg_123');
      expect(response.content).toBe('Hello back!');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(15);
      expect(response.usage.totalTokens).toBe(25);
      expect(response.stopReason).toBe('end_turn');
      expect(response.provider).toBe('anthropic');
    });

    it('should extract system messages', async () => {
      mockClient.messages.create.mockResolvedValue({
        id: 'msg_124',
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 20, output_tokens: 10 },
        stop_reason: 'end_turn',
      });

      const request: AIRequest = {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
        ],
        stream: false,
      };

      await provider.chat(request);

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.system).toBe('You are helpful.');
      expect(callArgs.messages).toHaveLength(1);
      expect(callArgs.messages[0].role).toBe('user');
    });

    it('should map tool use blocks to ToolCall', async () => {
      mockClient.messages.create.mockResolvedValue({
        id: 'msg_125',
        content: [
          { type: 'text', text: 'Let me search.' },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'search',
            input: { query: 'weather' },
          },
        ],
        usage: { input_tokens: 30, output_tokens: 20 },
        stop_reason: 'tool_use',
      });

      const response = await provider.chat(simpleRequest);

      expect(response.content).toBe('Let me search.');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: 'tool_1',
        name: 'search',
        arguments: { query: 'weather' },
      });
      expect(response.stopReason).toBe('tool_use');
    });

    it('should read cache_read_input_tokens', async () => {
      mockClient.messages.create.mockResolvedValue({
        id: 'msg_126',
        content: [{ type: 'text', text: 'cached' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 80,
        },
        stop_reason: 'end_turn',
      });

      const response = await provider.chat(simpleRequest);
      expect(response.usage.cachedTokens).toBe(80);
    });

    it('should map tools to Anthropic format', async () => {
      mockClient.messages.create.mockResolvedValue({
        id: 'msg_127',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const request: AIRequest = {
        messages: [{ role: 'user', content: 'Search for X' }],
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
        stream: false,
      };

      await provider.chat(request);

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe('search');
    });
  });

  describe('error handling', () => {
    it('should map 429 to RateLimitError', async () => {
      const { APIError } = await import('@anthropic-ai/sdk');
      mockClient.messages.create.mockRejectedValue(new (APIError as any)(429, 'rate limited'));

      await expect(provider.chat(simpleRequest)).rejects.toThrow(RateLimitError);
    });

    it('should map 401 to AuthenticationError', async () => {
      const { APIError } = await import('@anthropic-ai/sdk');
      mockClient.messages.create.mockRejectedValue(new (APIError as any)(401, 'unauthorized'));

      await expect(provider.chat(simpleRequest)).rejects.toThrow(AuthenticationError);
    });

    it('should map 503 to ProviderUnavailableError', async () => {
      const { APIError } = await import('@anthropic-ai/sdk');
      mockClient.messages.create.mockRejectedValue(new (APIError as any)(503, 'overloaded'));

      await expect(provider.chat(simpleRequest)).rejects.toThrow(ProviderUnavailableError);
    });
  });
});
