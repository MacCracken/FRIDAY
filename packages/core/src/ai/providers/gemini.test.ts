import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider } from './gemini.js';
import type { AIRequest, ModelConfig } from '@friday/shared';

const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(_apiKey?: string) {}
    getGenerativeModel = vi.fn().mockReturnValue({
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    });
  }

  return { GoogleGenerativeAI: MockGoogleGenerativeAI };
});

function makeConfig(): { model: ModelConfig; apiKey: string; retryConfig: { maxRetries: number } } {
  return {
    model: {
      provider: 'gemini' as any,
      model: 'gemini-2.0-flash',
      apiKeyEnv: 'GOOGLE_API_KEY',
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

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GeminiProvider(makeConfig());
  });

  describe('chat', () => {
    it('should map request and response', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{ text: 'Hello from Gemini!' }],
            },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 10,
            totalTokenCount: 15,
          },
        },
      });

      const response = await provider.chat(simpleRequest);
      expect(response.content).toBe('Hello from Gemini!');
      expect(response.usage.inputTokens).toBe(5);
      expect(response.usage.outputTokens).toBe(10);
      expect(response.stopReason).toBe('end_turn');
      expect(response.provider).toBe('gemini');
    });

    it('should handle function call responses', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  name: 'search',
                  args: { query: 'weather' },
                },
              }],
            },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      });

      const response = await provider.chat(simpleRequest);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe('search');
      expect(response.toolCalls![0].arguments).toEqual({ query: 'weather' });
    });

    it('should extract system messages', async () => {
      mockGenerateContent.mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        },
      });

      const request: AIRequest = {
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hi' },
        ],
        stream: false,
      };

      await provider.chat(request);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBeDefined();
      expect(callArgs.contents).toHaveLength(1); // Only user message, system extracted
    });
  });
});
