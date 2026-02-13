import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CostCalculator, getAvailableModels, getAvailableModelsAsync, _clearDynamicCache } from './cost-calculator.js';
import type { TokenUsage } from '@friday/shared';

describe('CostCalculator', () => {
  const calc = new CostCalculator();

  const usage = (input: number, output: number, cached = 0): TokenUsage => ({
    inputTokens: input,
    outputTokens: output,
    cachedTokens: cached,
    totalTokens: input + output,
  });

  it('should calculate Claude Sonnet cost correctly', () => {
    // claude-sonnet-4-20250514: $3/1M input, $15/1M output
    const cost = calc.calculate('anthropic', 'claude-sonnet-4-20250514', usage(1000, 500));
    // (1000/1M)*3 + (500/1M)*15 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('should calculate Claude with cached tokens', () => {
    // claude-sonnet-4-20250514: $3/1M input, $15/1M output, $0.3/1M cached
    const cost = calc.calculate('anthropic', 'claude-sonnet-4-20250514', usage(1000, 500, 400));
    // nonCached = 600, cached = 400
    // (600/1M)*3 + (400/1M)*0.3 + (500/1M)*15 = 0.0018 + 0.00012 + 0.0075 = 0.00942
    expect(cost).toBeCloseTo(0.00942, 5);
  });

  it('should calculate GPT-4o cost', () => {
    // gpt-4o: $2.5/1M input, $10/1M output
    const cost = calc.calculate('openai', 'gpt-4o', usage(2000, 1000));
    // (2000/1M)*2.5 + (1000/1M)*10 = 0.005 + 0.01 = 0.015
    expect(cost).toBeCloseTo(0.015, 4);
  });

  it('should calculate Gemini Flash cost', () => {
    // gemini-2.0-flash: $0.1/1M input, $0.4/1M output
    const cost = calc.calculate('gemini', 'gemini-2.0-flash', usage(10000, 5000));
    // (10000/1M)*0.1 + (5000/1M)*0.4 = 0.001 + 0.002 = 0.003
    expect(cost).toBeCloseTo(0.003, 4);
  });

  it('should return $0 for Ollama (local)', () => {
    const cost = calc.calculate('ollama', 'llama3', usage(50000, 10000));
    expect(cost).toBe(0);
  });

  it('should use fallback pricing for unknown models', () => {
    const cost = calc.calculate('anthropic', 'claude-future-model', usage(1000, 500));
    // Fallback anthropic: $3/1M input, $15/1M output
    expect(cost).toBeCloseTo(0.0105, 4);
  });

  it('should use fallback pricing for unknown openai model', () => {
    const cost = calc.calculate('openai', 'gpt-future', usage(1000, 500));
    // Fallback openai: $2.5/1M input, $10/1M output
    expect(cost).toBeCloseTo(0.0075, 4);
  });

  it('should handle zero usage', () => {
    const cost = calc.calculate('anthropic', 'claude-sonnet-4-20250514', usage(0, 0));
    expect(cost).toBe(0);
  });
});

describe('getAvailableModels', () => {
  it('should return models grouped by provider', () => {
    const models = getAvailableModels();
    expect(models).toHaveProperty('anthropic');
    expect(models).toHaveProperty('openai');
    expect(models).toHaveProperty('gemini');
    expect(models).toHaveProperty('ollama');
  });

  it('should include expected Anthropic models', () => {
    const models = getAvailableModels();
    const anthropicNames = models.anthropic.map((m) => m.model);
    expect(anthropicNames).toContain('claude-sonnet-4-20250514');
    expect(anthropicNames).toContain('claude-opus-4-20250514');
  });

  it('should include expected OpenAI models', () => {
    const models = getAvailableModels();
    const openaiNames = models.openai.map((m) => m.model);
    expect(openaiNames).toContain('gpt-4o');
    expect(openaiNames).toContain('gpt-4o-mini');
    expect(openaiNames).toContain('o3-mini');
  });

  it('should have correct structure for each model', () => {
    const models = getAvailableModels();
    for (const [provider, modelList] of Object.entries(models)) {
      for (const model of modelList) {
        expect(model.provider).toBe(provider);
        expect(typeof model.model).toBe('string');
        expect(typeof model.inputPer1M).toBe('number');
        expect(typeof model.outputPer1M).toBe('number');
      }
    }
  });

  it('should show $0 pricing for ollama', () => {
    const models = getAvailableModels();
    for (const model of models.ollama) {
      expect(model.inputPer1M).toBe(0);
      expect(model.outputPer1M).toBe(0);
    }
  });
});

describe('getAvailableModelsAsync', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    _clearDynamicCache();
    mockFetch.mockClear();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    delete process.env['OPENCODE_API_KEY'];
    delete process.env['OLLAMA_HOST'];
  });

  it('should merge dynamically fetched Gemini models', async () => {
    process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = 'test-key';
    mockFetch.mockResolvedValue({
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
          {
            name: 'models/gemini-2.5-pro-preview',
            displayName: 'Gemini 2.5 Pro Preview',
            supportedGenerationMethods: ['generateContent'],
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
          },
        ],
      }),
    });

    const models = await getAvailableModelsAsync();
    const geminiModels = models['gemini'];

    expect(geminiModels).toBeDefined();
    expect(geminiModels.length).toBe(2);
    expect(geminiModels.map(m => m.model)).toContain('gemini-2.0-flash');
    expect(geminiModels.map(m => m.model)).toContain('gemini-2.5-pro-preview');

    // Known model should have exact pricing
    const flash = geminiModels.find(m => m.model === 'gemini-2.0-flash')!;
    expect(flash.inputPer1M).toBe(0.1);

    // Unknown model should use fallback pricing
    const pro = geminiModels.find(m => m.model === 'gemini-2.5-pro-preview')!;
    expect(pro.inputPer1M).toBe(1.25); // gemini fallback
  });

  it('should merge dynamically fetched Anthropic models', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
          { id: 'claude-future-model', display_name: 'Claude Future' },
        ],
      }),
    });

    const models = await getAvailableModelsAsync();
    const anthropicModels = models['anthropic'];

    expect(anthropicModels).toBeDefined();
    expect(anthropicModels.map(m => m.model)).toContain('claude-sonnet-4-20250514');
    expect(anthropicModels.map(m => m.model)).toContain('claude-future-model');

    // Known model should have exact pricing
    const sonnet = anthropicModels.find(m => m.model === 'claude-sonnet-4-20250514')!;
    expect(sonnet.inputPer1M).toBe(3);

    // Unknown model should use fallback pricing
    const future = anthropicModels.find(m => m.model === 'claude-future-model')!;
    expect(future.inputPer1M).toBe(3); // anthropic fallback
  });

  it('should merge dynamically fetched Ollama models', async () => {
    process.env['OLLAMA_HOST'] = 'http://localhost:11434';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'llama3:latest', size: 4700000000 },
        ],
      }),
    });

    const models = await getAvailableModelsAsync();
    const ollamaModels = models['ollama'];

    expect(ollamaModels).toBeDefined();
    expect(ollamaModels.map(m => m.model)).toContain('llama3:latest');
    expect(ollamaModels[0].inputPer1M).toBe(0);
    expect(ollamaModels[0].outputPer1M).toBe(0);
  });

  it('should fetch from multiple providers in parallel', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'ant-key';
    process.env['OPENAI_API_KEY'] = 'oai-key';

    mockFetch.mockImplementation((url: string) => {
      if (url.includes('anthropic')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' }],
          }),
        });
      }
      if (url.includes('openai')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ id: 'gpt-4o', owned_by: 'openai' }],
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const models = await getAvailableModelsAsync();

    expect(models['anthropic'].map(m => m.model)).toContain('claude-sonnet-4-20250514');
    expect(models['openai'].map(m => m.model)).toContain('gpt-4o');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should cache results for 10 minutes', async () => {
    process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });

    await getAvailableModelsAsync();
    await getAvailableModelsAsync();

    // fetch should only be called once due to caching
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should fall back to static models when API key is not set', async () => {
    delete process.env['GOOGLE_GENERATIVE_AI_API_KEY'];

    const models = await getAvailableModelsAsync();

    expect(models['gemini']).toBeDefined();
    expect(models['gemini'].map(m => m.model)).toContain('gemini-2.0-flash');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should keep static models when dynamic fetch fails', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'test-key';
    mockFetch.mockRejectedValue(new Error('network error'));

    const models = await getAvailableModelsAsync();

    // Should still have static anthropic models
    expect(models['anthropic']).toBeDefined();
    expect(models['anthropic'].map(m => m.model)).toContain('claude-sonnet-4-20250514');
  });
});
