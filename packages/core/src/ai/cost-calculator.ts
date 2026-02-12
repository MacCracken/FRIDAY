/**
 * Cost Calculator
 *
 * Pricing lookup and cost calculation for AI model usage.
 * Prices are per 1M tokens (input / output) in USD.
 * Ollama models are always $0 (local inference).
 */

import type { TokenUsage, AIProviderName } from '@friday/shared';

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

// Static pricing table — update as providers change pricing
const PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-opus-4-20250514': { inputPer1M: 15, outputPer1M: 75, cachedInputPer1M: 1.5 },
  'claude-sonnet-4-20250514': { inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
  'claude-haiku-3-5-20241022': { inputPer1M: 0.8, outputPer1M: 4, cachedInputPer1M: 0.08 },

  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4-turbo': { inputPer1M: 10, outputPer1M: 30 },
  'o1': { inputPer1M: 15, outputPer1M: 60 },
  'o1-mini': { inputPer1M: 3, outputPer1M: 12 },
  'o3-mini': { inputPer1M: 1.1, outputPer1M: 4.4 },

  // Google Gemini
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },
  'gemini-1.5-pro': { inputPer1M: 1.25, outputPer1M: 5 },
  'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
};

// Fallback pricing per provider when model is unknown
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  anthropic: { inputPer1M: 3, outputPer1M: 15 },
  openai: { inputPer1M: 2.5, outputPer1M: 10 },
  gemini: { inputPer1M: 1.25, outputPer1M: 5 },
  ollama: { inputPer1M: 0, outputPer1M: 0 },
};

export interface AvailableModel {
  provider: string;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

const MODEL_PROVIDER_MAP: Record<string, string> = {
  'claude-opus-4-20250514': 'anthropic',
  'claude-sonnet-4-20250514': 'anthropic',
  'claude-haiku-3-5-20241022': 'anthropic',
  'gpt-4o': 'openai',
  'gpt-4o-mini': 'openai',
  'gpt-4-turbo': 'openai',
  'o1': 'openai',
  'o1-mini': 'openai',
  'o3-mini': 'openai',
  'gemini-2.0-flash': 'gemini',
  'gemini-1.5-pro': 'gemini',
  'gemini-1.5-flash': 'gemini',
};

/**
 * Returns all known models grouped by provider.
 */
export function getAvailableModels(): Record<string, AvailableModel[]> {
  const grouped: Record<string, AvailableModel[]> = {};

  for (const [model, pricing] of Object.entries(PRICING)) {
    const provider = MODEL_PROVIDER_MAP[model] ?? 'unknown';
    if (!grouped[provider]) {
      grouped[provider] = [];
    }
    grouped[provider].push({
      provider,
      model,
      inputPer1M: pricing.inputPer1M,
      outputPer1M: pricing.outputPer1M,
      cachedInputPer1M: pricing.cachedInputPer1M,
    });
  }

  // Always include ollama as a provider option
  if (!grouped['ollama']) {
    grouped['ollama'] = [{
      provider: 'ollama',
      model: 'local',
      inputPer1M: 0,
      outputPer1M: 0,
    }];
  }

  return grouped;
}

export class CostCalculator {
  /**
   * Calculate cost in USD for a given provider, model, and token usage.
   */
  calculate(provider: AIProviderName, model: string, usage: TokenUsage): number {
    if (provider === 'ollama') {
      return 0;
    }

    const pricing = this.getPricing(provider, model);

    const nonCachedInput = usage.inputTokens - usage.cachedTokens;
    const inputCost = (nonCachedInput / 1_000_000) * pricing.inputPer1M;
    const cachedCost = pricing.cachedInputPer1M
      ? (usage.cachedTokens / 1_000_000) * pricing.cachedInputPer1M
      : 0;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPer1M;

    return inputCost + cachedCost + outputCost;
  }

  /**
   * Look up pricing for a model, falling back to provider defaults.
   */
  getPricing(provider: AIProviderName, model: string): ModelPricing {
    // Exact match
    if (PRICING[model]) {
      return PRICING[model];
    }

    // Prefix match (e.g. "claude-sonnet-4-20250514" matches "claude-sonnet-4-*")
    for (const [key, pricing] of Object.entries(PRICING)) {
      if (model.startsWith(key.split('-').slice(0, -1).join('-')) && key.split('-').length > 2) {
        return pricing;
      }
    }

    // Provider fallback
    return FALLBACK_PRICING[provider] ?? { inputPer1M: 0, outputPer1M: 0 };
  }
}
