/**
 * Brain Routes — API endpoints for memory, knowledge, and skill management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BrainManager } from './manager.js';
import type { MemoryType, MemoryQuery, KnowledgeQuery } from './types.js';

export interface BrainRoutesOptions {
  brainManager: BrainManager;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export function registerBrainRoutes(
  app: FastifyInstance,
  opts: BrainRoutesOptions,
): void {
  const { brainManager } = opts;

  // ── Memories ─────────────────────────────────────────────────

  app.get('/api/v1/brain/memories', async (
    request: FastifyRequest<{
      Querystring: { type?: string; source?: string; search?: string; minImportance?: string; limit?: string }
    }>,
  ) => {
    const q = request.query;
    const query: MemoryQuery = {};
    if (q.type) query.type = q.type as MemoryType;
    if (q.source) query.source = q.source;
    if (q.search) query.search = q.search;
    if (q.minImportance) query.minImportance = Number(q.minImportance);
    if (q.limit) query.limit = Number(q.limit);

    const memories = brainManager.recall(query);
    return { memories };
  });

  app.post('/api/v1/brain/memories', async (
    request: FastifyRequest<{
      Body: { type: MemoryType; content: string; source: string; context?: Record<string, string>; importance?: number }
    }>,
    reply: FastifyReply,
  ) => {
    try {
      const { type, content, source, context, importance } = request.body;
      const memory = brainManager.remember(type, content, source, context, importance);
      return reply.code(201).send({ memory });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.delete('/api/v1/brain/memories/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      brainManager.forget(request.params.id);
      return { message: 'Memory deleted' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Knowledge ────────────────────────────────────────────────

  app.get('/api/v1/brain/knowledge', async (
    request: FastifyRequest<{
      Querystring: { topic?: string; search?: string; minConfidence?: string; limit?: string }
    }>,
  ) => {
    const q = request.query;
    const query: KnowledgeQuery = {};
    if (q.topic) query.topic = q.topic;
    if (q.search) query.search = q.search;
    if (q.minConfidence) query.minConfidence = Number(q.minConfidence);
    if (q.limit) query.limit = Number(q.limit);

    const knowledge = brainManager.queryKnowledge(query);
    return { knowledge };
  });

  app.post('/api/v1/brain/knowledge', async (
    request: FastifyRequest<{
      Body: { topic: string; content: string; source: string; confidence?: number }
    }>,
    reply: FastifyReply,
  ) => {
    try {
      const { topic, content, source, confidence } = request.body;
      const entry = brainManager.learn(topic, content, source, confidence);
      return reply.code(201).send({ knowledge: entry });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Stats ────────────────────────────────────────────────────

  app.get('/api/v1/brain/stats', async () => {
    const stats = brainManager.getStats();
    return { stats };
  });

  // ── Maintenance ──────────────────────────────────────────────

  app.post('/api/v1/brain/maintenance', async () => {
    const result = brainManager.runMaintenance();
    return { result };
  });
}
