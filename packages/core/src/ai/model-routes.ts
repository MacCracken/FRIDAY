/**
 * Model Routes — View current model config and switch models at runtime.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SecureYeoman } from '../secureyeoman.js';
import { getAvailableModels } from './cost-calculator.js';

export interface ModelRoutesOptions {
  secureYeoman: SecureYeoman;
}

interface SwitchModelBody {
  provider: string;
  model: string;
}

export function registerModelRoutes(
  app: FastifyInstance,
  opts: ModelRoutesOptions,
): void {
  const { secureYeoman } = opts;

  app.get('/api/v1/model/info', async (_request, reply: FastifyReply) => {
    try {
      const config = secureYeoman.getConfig();
      const modelConfig = config.model;

      return {
        current: {
          provider: modelConfig.provider,
          model: modelConfig.model,
          maxTokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
        },
        available: getAvailableModels(true),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });

  app.post('/api/v1/model/switch', async (
    request: FastifyRequest<{ Body: SwitchModelBody }>,
    reply: FastifyReply,
  ) => {
    const { provider, model } = request.body;

    if (!provider || !model) {
      return reply.code(400).send({ error: 'provider and model are required' });
    }

    const validProviders = ['anthropic', 'openai', 'gemini', 'ollama', 'opencode'];
    if (!validProviders.includes(provider)) {
      return reply.code(400).send({
        error: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
      });
    }

    try {
      secureYeoman.switchModel(provider, model);
      return { success: true, model: `${provider}/${model}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: `Failed to switch model: ${message}` });
    }
  });

  // Cost optimization recommendations
  app.get('/api/v1/model/cost-recommendations', async (_request, reply: FastifyReply) => {
    try {
      const costOptimizer = secureYeoman.getCostOptimizer();
      if (!costOptimizer) {
        return reply.code(503).send({ error: 'Cost optimizer not available (AI client not initialized)' });
      }
      return costOptimizer.analyze();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return reply.code(500).send({ error: message });
    }
  });
}
