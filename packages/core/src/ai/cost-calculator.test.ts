import { describe, it, expect } from 'vitest';
import { CostCalculator, getAvailableModels } from './cost-calculator.js';
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
