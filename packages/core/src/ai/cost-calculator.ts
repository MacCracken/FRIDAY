/**
 * Cost Calculator
 *
 * Pricing lookup and cost calculation for AI model usage.
 * Prices are per 1M tokens (input / output) in USD.
 * Ollama models are always $0 (local inference).
 */

import type { TokenUsage, AIProviderName } from '@friday/shared';
import { GeminiProvider } from './providers/gemini.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenCodeProvider } from './providers/opencode.js';

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

  // Google Gemini (static fallback — dynamic models fetched via getAvailableModelsAsync)
  'gemini-2.0-flash': { inputPer1M: 0.1, outputPer1M: 0.4 },

  // OpenCode Zen
  'gpt-5.2': { inputPer1M: 1.75, outputPer1M: 14 },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
  'gemini-3-flash': { inputPer1M: 0.5, outputPer1M: 3 },
  'qwen3-coder': { inputPer1M: 0.45, outputPer1M: 1.5 },
  'big-pickle': { inputPer1M: 0, outputPer1M: 0 },
};

// Fallback pricing per provider when model is unknown
const FALLBACK_PRICING: Record<string, ModelPricing> = {
  anthropic: { inputPer1M: 3, outputPer1M: 15 },
  openai: { inputPer1M: 2.5, outputPer1M: 10 },
  gemini: { inputPer1M: 1.25, outputPer1M: 5 },
  ollama: { inputPer1M: 0, outputPer1M: 0 },
  opencode: { inputPer1M: 1, outputPer1M: 5 },
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
  'gpt-5.2': 'opencode',
  'claude-sonnet-4-5': 'opencode',
  'claude-haiku-4-5': 'opencode',
  'gemini-3-flash': 'opencode',
  'qwen3-coder': 'opencode',
  'big-pickle': 'opencode',
};

/**
 * Default environment variable name for each provider's API key.
 * Ollama requires no key (local inference).
 */
export const PROVIDER_KEY_ENV: Record<string, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  gemini: 'GOOGLE_GENERATIVE_AI_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  ollama: 'OLLAMA_HOST', // presence indicates Ollama is configured
};

/**
 * Returns all known models grouped by provider.
 * When `onlyAvailable` is true, providers whose API key env var is not set
 * are excluded (Ollama is always included since it needs no key).
 */
export function getAvailableModels(onlyAvailable = false): Record<string, AvailableModel[]> {
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

  // Add ollama placeholder if not already populated from pricing table
  if (!grouped['ollama']) {
    grouped['ollama'] = [{
      provider: 'ollama',
      model: 'local',
      inputPer1M: 0,
      outputPer1M: 0,
    }];
  }

  if (onlyAvailable) {
    for (const provider of Object.keys(grouped)) {
      const keyEnv = PROVIDER_KEY_ENV[provider];
      // If the provider's env var is not set, remove it
      if (keyEnv && !process.env[keyEnv]) {
        delete grouped[provider];
      }
    }
  }

  return grouped;
}

// ── Dynamic model discovery (cached) ─────────────────────────────────

let _dynamicCache: { result: Record<string, AvailableModel[]>; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Returns models grouped by provider, dynamically fetching models
 * from all provider APIs when their respective API keys are set.
 * Results are cached for 10 minutes to avoid repeated API calls.
 */
export async function getAvailableModelsAsync(onlyAvailable = false): Promise<Record<string, AvailableModel[]>> {
  const now = Date.now();

  if (_dynamicCache && now - _dynamicCache.ts < CACHE_TTL_MS) {
    return filterByAvailability(_dynamicCache.result, onlyAvailable);
  }

  // Start with the static table
  const grouped = getAvailableModels(false);

  // Build dynamic fetch tasks for each provider with credentials set
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const openaiKey = process.env['OPENAI_API_KEY'];
  const geminiKey = process.env['GOOGLE_GENERATIVE_AI_API_KEY'];
  const opencodeKey = process.env['OPENCODE_API_KEY'];
  const ollamaHost = process.env['OLLAMA_HOST'];

  const tasks: Array<{ provider: string; promise: Promise<AvailableModel[]> }> = [];

  if (anthropicKey) {
    tasks.push({
      provider: 'anthropic',
      promise: AnthropicProvider.fetchAvailableModels(anthropicKey).then((models) =>
        models.map((m) => {
          const knownPricing = PRICING[m.id];
          const fallback = FALLBACK_PRICING['anthropic']!;
          return {
            provider: 'anthropic',
            model: m.id,
            inputPer1M: knownPricing?.inputPer1M ?? fallback.inputPer1M,
            outputPer1M: knownPricing?.outputPer1M ?? fallback.outputPer1M,
            cachedInputPer1M: knownPricing?.cachedInputPer1M,
          };
        }),
      ),
    });
  }

  if (openaiKey) {
    tasks.push({
      provider: 'openai',
      promise: OpenAIProvider.fetchAvailableModels(openaiKey).then((models) =>
        models.map((m) => {
          const knownPricing = PRICING[m.id];
          const fallback = FALLBACK_PRICING['openai']!;
          return {
            provider: 'openai',
            model: m.id,
            inputPer1M: knownPricing?.inputPer1M ?? fallback.inputPer1M,
            outputPer1M: knownPricing?.outputPer1M ?? fallback.outputPer1M,
            cachedInputPer1M: knownPricing?.cachedInputPer1M,
          };
        }),
      ),
    });
  }

  if (geminiKey) {
    tasks.push({
      provider: 'gemini',
      promise: GeminiProvider.fetchAvailableModels(geminiKey).then((models) =>
        models.map((m) => {
          const knownPricing = PRICING[m.id];
          const fallback = FALLBACK_PRICING['gemini']!;
          return {
            provider: 'gemini',
            model: m.id,
            inputPer1M: knownPricing?.inputPer1M ?? fallback.inputPer1M,
            outputPer1M: knownPricing?.outputPer1M ?? fallback.outputPer1M,
            cachedInputPer1M: knownPricing?.cachedInputPer1M,
          };
        }),
      ),
    });
  }

  if (opencodeKey) {
    tasks.push({
      provider: 'opencode',
      promise: OpenCodeProvider.fetchAvailableModels(opencodeKey).then((models) =>
        models.map((m) => {
          const knownPricing = PRICING[m.id];
          const fallback = FALLBACK_PRICING['opencode']!;
          return {
            provider: 'opencode',
            model: m.id,
            inputPer1M: knownPricing?.inputPer1M ?? fallback.inputPer1M,
            outputPer1M: knownPricing?.outputPer1M ?? fallback.outputPer1M,
            cachedInputPer1M: knownPricing?.cachedInputPer1M,
          };
        }),
      ),
    });
  }

  if (ollamaHost) {
    tasks.push({
      provider: 'ollama',
      promise: OllamaProvider.fetchAvailableModels(ollamaHost).then((models) =>
        models.map((m) => ({
          provider: 'ollama',
          model: m.id,
          inputPer1M: 0,
          outputPer1M: 0,
        })),
      ),
    });
  }

  // Fetch all in parallel
  const results = await Promise.allSettled(tasks.map((t) => t.promise));

  for (let i = 0; i < tasks.length; i++) {
    const result = results[i];
    const { provider } = tasks[i];
    if (result.status === 'fulfilled' && result.value.length > 0) {
      grouped[provider] = result.value;
    }
    // On failure or empty result, keep the static models
  }

  _dynamicCache = { result: grouped, ts: now };
  return filterByAvailability(grouped, onlyAvailable);
}

function filterByAvailability(
  grouped: Record<string, AvailableModel[]>,
  onlyAvailable: boolean,
): Record<string, AvailableModel[]> {
  if (!onlyAvailable) return grouped;

  const filtered: Record<string, AvailableModel[]> = {};
  for (const [provider, models] of Object.entries(grouped)) {
    const keyEnv = PROVIDER_KEY_ENV[provider];
    if (keyEnv && !process.env[keyEnv]) continue;
    filtered[provider] = models;
  }
  return filtered;
}

/** @internal — exposed for testing */
export function _clearDynamicCache(): void {
  _dynamicCache = null;
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
