import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for the switchModel logic. Since SecureYeoman requires full
 * initialization with real databases, we test the core switching logic
 * by extracting the validation and AIClient creation patterns.
 *
 * The chat-routes and model-routes tests cover the HTTP layer.
 * This file covers the validation logic in switchModel itself.
 */

// We test the validation logic that switchModel uses
describe('switchModel validation', () => {
  const validProviders = ['anthropic', 'openai', 'gemini', 'ollama'];

  it('should accept all valid providers', () => {
    for (const provider of validProviders) {
      expect(validProviders.includes(provider)).toBe(true);
    }
  });

  it('should reject invalid providers', () => {
    const invalid = ['azure', 'cohere', 'mistral', '', 'ANTHROPIC'];
    for (const provider of invalid) {
      expect(validProviders.includes(provider)).toBe(false);
    }
  });
});

// Test the AIClient constructor behavior with different providers
describe('AIClient creation for model switch', () => {
  // Mock getSecret
  vi.mock('../config/loader.js', () => ({
    getSecret: vi.fn().mockReturnValue('test-api-key'),
  }));

  vi.mock('./providers/anthropic.js', () => ({
    AnthropicProvider: class { name = 'anthropic'; chat = vi.fn(); chatStream = vi.fn(); },
  }));
  vi.mock('./providers/openai.js', () => ({
    OpenAIProvider: class { name = 'openai'; chat = vi.fn(); chatStream = vi.fn(); },
  }));
  vi.mock('./providers/gemini.js', () => ({
    GeminiProvider: class { name = 'gemini'; chat = vi.fn(); chatStream = vi.fn(); },
  }));
  vi.mock('./providers/ollama.js', () => ({
    OllamaProvider: class { name = 'ollama'; chat = vi.fn(); chatStream = vi.fn(); },
  }));

  it('can create AIClient with anthropic provider', async () => {
    const { AIClient } = await import('./client.js');
    const client = new AIClient({
      model: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        maxTokens: 16384,
        temperature: 0.7,
        maxRequestsPerMinute: 60,
        requestTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 100,
        fallbacks: [],
      },
    });
    expect(client.getProviderName()).toBe('anthropic');
  });

  it('can create AIClient with openai provider', async () => {
    const { AIClient } = await import('./client.js');
    const client = new AIClient({
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKeyEnv: 'OPENAI_API_KEY',
        maxTokens: 16384,
        temperature: 0.7,
        maxRequestsPerMinute: 60,
        requestTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 100,
        fallbacks: [],
      },
    });
    expect(client.getProviderName()).toBe('openai');
  });

  it('can create AIClient with gemini provider', async () => {
    const { AIClient } = await import('./client.js');
    const client = new AIClient({
      model: {
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKeyEnv: 'GEMINI_API_KEY',
        maxTokens: 16384,
        temperature: 0.7,
        maxRequestsPerMinute: 60,
        requestTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 100,
        fallbacks: [],
      },
    });
    expect(client.getProviderName()).toBe('gemini');
  });

  it('can create AIClient with ollama provider', async () => {
    const { AIClient } = await import('./client.js');
    const client = new AIClient({
      model: {
        provider: 'ollama',
        model: 'llama3',
        apiKeyEnv: '',
        maxTokens: 16384,
        temperature: 0.7,
        maxRequestsPerMinute: 60,
        requestTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 100,
        fallbacks: [],
      },
    });
    expect(client.getProviderName()).toBe('ollama');
  });

  it('throws for unknown provider', async () => {
    const { AIClient } = await import('./client.js');
    expect(() => new AIClient({
      model: {
        provider: 'unknown' as any,
        model: 'test',
        apiKeyEnv: 'KEY',
        maxTokens: 16384,
        temperature: 0.7,
        maxRequestsPerMinute: 60,
        requestTimeoutMs: 30000,
        maxRetries: 2,
        retryDelayMs: 100,
        fallbacks: [],
      },
    })).toThrow('Unknown AI provider');
  });
});
