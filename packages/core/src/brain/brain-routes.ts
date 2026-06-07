/**
 * Brain Routes — API endpoints for memory, knowledge, and skill management.
 *
 * Phase 8.8: Added input validation, limit caps, and rate limiting.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BrainManager } from './manager.js';
import type { HeartbeatManager } from '../body/heartbeat.js';
import type { HeartbeatLogStorage } from '../body/heartbeat-log-storage.js';
import type { ExternalBrainSync } from './external-sync.js';
import type { SoulManager } from '../soul/manager.js';
import type { CognitiveMemoryManager } from './cognitive-memory-manager.js';
import type { CognitiveMemoryStorage } from './cognitive-memory-store.js';
import type { MemoryType, MemoryQuery, KnowledgeQuery } from './types.js';
import { toErrorMessage, sendError } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';
import { canAccessResource } from '../gateway/ownership-guard.js';

export interface BrainRoutesOptions {
  brainManager: BrainManager;
  heartbeatManager?: HeartbeatManager;
  heartbeatLogStorage?: HeartbeatLogStorage;
  externalSync?: ExternalBrainSync;
  soulManager?: SoulManager;
  cognitiveMemoryManager?: CognitiveMemoryManager;
  cognitiveStorage?: CognitiveMemoryStorage;
}

/** Hard cap on query limit parameter to prevent unbounded queries. */
const MAX_QUERY_LIMIT = 200;

/** Rate limit tracking for mutation endpoints. */
const MAX_RATE_LIMIT_ENTRIES = 50_000;
const rateLimitWindows = new Map<string, { count: number; resetAt: number }>();

// Periodic cleanup of expired rate limit entries
const _rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitWindows) {
    if (now >= entry.resetAt) rateLimitWindows.delete(key);
  }
}, 60_000);
_rateLimitCleanupTimer.unref?.();

function checkBrainRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = rateLimitWindows.get(key);

  if (!entry || now >= entry.resetAt) {
    // Evict oldest if at capacity
    if (rateLimitWindows.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitWindows.has(key)) {
      const oldest = rateLimitWindows.keys().next().value;
      if (oldest !== undefined) rateLimitWindows.delete(oldest);
    }
    rateLimitWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}

function validateContent(content: unknown, reply: FastifyReply): string | null {
  if (typeof content !== 'string' || content.trim().length === 0) {
    void sendError(reply, 400, 'Content is required and must be a non-empty string');
    return null;
  }
  return content;
}

export function registerBrainRoutes(app: FastifyInstance, opts: BrainRoutesOptions): void {
  const {
    brainManager,
    heartbeatManager,
    heartbeatLogStorage,
    externalSync,
    soulManager,
    cognitiveMemoryManager,
    cognitiveStorage,
  } = opts;

  // ── Memories ─────────────────────────────────────────────────

  app.get(
    '/api/v1/brain/memories',
    async (
      request: FastifyRequest<{
        Querystring: {
          type?: string;
          source?: string;
          search?: string;
          minImportance?: string;
          limit?: string;
          personalityId?: string;
        };
      }>
    ) => {
      const q = request.query;
      const query: MemoryQuery = {};
      if (q.type) query.type = q.type as MemoryType;
      if (q.source) query.source = q.source;
      if (q.search) query.search = q.search;
      if (q.minImportance) query.minImportance = Number(q.minImportance);
      if (q.personalityId) query.personalityId = q.personalityId;
      query.limit = parsePagination({ limit: q.limit }, { maxLimit: MAX_QUERY_LIMIT }).limit;

      const memories = await brainManager.recall(query);
      return { memories };
    }
  );

  app.post(
    '/api/v1/brain/memories',
    async (
      request: FastifyRequest<{
        Body: {
          type: MemoryType;
          content: string;
          source: string;
          context?: Record<string, string>;
          importance?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const clientIp = request.ip ?? 'unknown';
      if (!checkBrainRateLimit(`brain:memories:post:${clientIp}`, 60)) {
        return sendError(reply, 429, 'Rate limit exceeded for memory creation');
      }

      try {
        const { type, content, source, context, importance } = request.body;
        const validContent = validateContent(content, reply);
        if (validContent === null) return;

        const memory = await brainManager.remember(type, validContent, source, context, importance);
        return await reply.code(201).send({ memory });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.delete(
    '/api/v1/brain/memories/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const memory = await brainManager.getMemory(request.params.id);
        if (!memory) return sendError(reply, 404, 'Memory not found');
        if (!canAccessResource(request, memory)) return sendError(reply, 403, 'Access denied');
        await brainManager.forget(request.params.id);
        return reply.code(204).send();
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── Knowledge ────────────────────────────────────────────────

  app.get(
    '/api/v1/brain/knowledge',
    async (
      request: FastifyRequest<{
        Querystring: {
          topic?: string;
          search?: string;
          minConfidence?: string;
          limit?: string;
          personalityId?: string;
        };
      }>
    ) => {
      const q = request.query;
      const query: KnowledgeQuery = {};
      if (q.topic) query.topic = q.topic;
      if (q.search) query.search = q.search;
      if (q.minConfidence) query.minConfidence = Number(q.minConfidence);
      if (q.personalityId) query.personalityId = q.personalityId;
      query.limit = parsePagination({ limit: q.limit }, { maxLimit: MAX_QUERY_LIMIT }).limit;

      const knowledge = await brainManager.queryKnowledge(query);
      return { knowledge };
    }
  );

  app.post(
    '/api/v1/brain/knowledge',
    async (
      request: FastifyRequest<{
        Body: { topic: string; content: string; source: string; confidence?: number };
      }>,
      reply: FastifyReply
    ) => {
      const clientIp = request.ip ?? 'unknown';
      if (!checkBrainRateLimit(`brain:knowledge:post:${clientIp}`, 60)) {
        return sendError(reply, 429, 'Rate limit exceeded for knowledge creation');
      }

      try {
        const { topic, content, source, confidence } = request.body;
        const validContent = validateContent(content, reply);
        if (validContent === null) return;

        const entry = await brainManager.learn(topic, validContent, source, confidence);
        return await reply.code(201).send({ knowledge: entry });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.put(
    '/api/v1/brain/knowledge/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { content?: string; confidence?: number };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const existing = await brainManager.getKnowledge(request.params.id);
        if (!existing) return sendError(reply, 404, 'Knowledge entry not found');
        if (!canAccessResource(request, existing)) return sendError(reply, 403, 'Access denied');
        const { content, confidence } = request.body;
        const knowledge = await brainManager.updateKnowledge(request.params.id, {
          content,
          confidence,
        });
        return { knowledge };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.delete(
    '/api/v1/brain/knowledge/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const existing = await brainManager.getKnowledge(request.params.id);
        if (!existing) return sendError(reply, 404, 'Knowledge entry not found');
        if (!canAccessResource(request, existing)) return sendError(reply, 403, 'Access denied');
        await brainManager.deleteKnowledge(request.params.id);
        return reply.code(204).send();
      } catch (err) {
        return sendError(reply, 404, toErrorMessage(err));
      }
    }
  );

  // ── Stats ────────────────────────────────────────────────────

  app.get(
    '/api/v1/brain/stats',
    async (request: FastifyRequest<{ Querystring: { personalityId?: string } }>) => {
      const { personalityId } = request.query;
      const stats = await brainManager.getStats(personalityId || undefined);
      return { stats };
    }
  );

  // ── Maintenance ──────────────────────────────────────────────

  app.post('/api/v1/brain/maintenance', async (_request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = _request.ip ?? 'unknown';
    if (!checkBrainRateLimit(`brain:maintenance:${clientIp}`, 5)) {
      return sendError(reply, 429, 'Rate limit exceeded for maintenance');
    }
    const result = await brainManager.runMaintenance();
    return { result };
  });

  // ── Heartbeat ──────────────────────────────────────────────

  app.get(
    '/api/v1/brain/heartbeat/status',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!heartbeatManager) {
        return sendError(reply, 503, 'Heartbeat system not available');
      }
      const status = heartbeatManager.getStatus();
      const enabledPersonalities = await (soulManager?.getEnabledPersonalities() ??
        Promise.resolve([]));
      const activePersonalityCount = Math.max(1, enabledPersonalities.length);
      return {
        ...status,
        activePersonalityCount,
        totalTasks: status.tasks.length * activePersonalityCount,
        enabledTasks: status.tasks.filter((t) => t.enabled).length * activePersonalityCount,
      };
    }
  );

  app.post(
    '/api/v1/brain/heartbeat/beat',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!heartbeatManager) {
        return sendError(reply, 503, 'Heartbeat system not available');
      }
      try {
        const result = await heartbeatManager.beat();
        return { result };
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/heartbeat/tasks',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!heartbeatManager) {
        return sendError(reply, 503, 'Heartbeat system not available');
      }
      const status = heartbeatManager.getStatus();

      // The heartbeat is system-wide — it serves every personality that exists.
      // List all personalities (not just is_active=true) so the UI always shows
      // the full roster regardless of which ones have been explicitly enabled.
      const [allResult, defaultPersonality] = await Promise.all([
        soulManager?.listPersonalities({ limit: 200 }) ?? Promise.resolve({ personalities: [] }),
        soulManager?.getActivePersonality() ?? Promise.resolve(null),
      ]);
      const allPersonalities = allResult.personalities.map((p) => ({ id: p.id, name: p.name }));

      const tasks = status.tasks.map((t) => ({
        ...t,
        // Legacy single fields kept for backwards compat — point at the default
        personalityId: defaultPersonality?.id ?? null,
        personalityName: defaultPersonality?.name ?? null,
        // All personalities this heartbeat serves
        personalities: allPersonalities,
      }));
      return { tasks };
    }
  );

  app.put(
    '/api/v1/brain/heartbeat/tasks/:name',
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Body: { intervalMs?: number; enabled?: boolean; config?: Record<string, unknown> };
      }>,
      reply: FastifyReply
    ) => {
      if (!heartbeatManager) {
        return sendError(reply, 503, 'Heartbeat system not available');
      }
      try {
        const { intervalMs, enabled, config } = request.body;
        heartbeatManager.updateTask(request.params.name, { intervalMs, enabled, config });
        const status = heartbeatManager.getStatus();
        const task = status.tasks.find((t) => t.name === request.params.name);
        return { task };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/heartbeat/history',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      if (!heartbeatManager) {
        return sendError(reply, 503, 'Heartbeat system not available');
      }
      const { limit } = parsePagination(request.query, {
        defaultLimit: 10,
        maxLimit: MAX_QUERY_LIMIT,
      });
      const memories = await brainManager.recall({ source: 'heartbeat', limit });
      return { history: memories };
    }
  );

  // ── Heartbeat Execution Log ───────────────────────────────
  // Registered here (not under proactive routes) so it's always available
  // regardless of whether the proactive system is enabled.

  app.get(
    '/api/v1/proactive/heartbeat/log',
    async (
      request: FastifyRequest<{
        Querystring: { checkName?: string; status?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!heartbeatLogStorage) return sendError(reply, 503, 'Heartbeat log storage not available');
      const { checkName, status, limit, offset } = request.query;
      const pg = parsePagination({ limit, offset });
      return heartbeatLogStorage.list({
        checkName,
        status: status as 'ok' | 'warning' | 'error' | undefined,
        limit: pg.limit,
        offset: pg.offset,
      });
    }
  );

  // ── Audit Logs Bridge ─────────────────────────────────────

  app.get(
    '/api/v1/brain/logs',
    async (
      request: FastifyRequest<{
        Querystring: {
          level?: string;
          event?: string;
          limit?: string;
          offset?: string;
          from?: string;
          to?: string;
          order?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const q = request.query;
        const auditPg = parsePagination(q, { maxLimit: MAX_QUERY_LIMIT, defaultLimit: 50 });
        const result = await brainManager.queryAuditLogs({
          level: q.level ? q.level.split(',') : undefined,
          event: q.event ? q.event.split(',') : undefined,
          limit: auditPg.limit,
          offset: auditPg.offset,
          from: q.from ? Number(q.from) : undefined,
          to: q.to ? Number(q.to) : undefined,
          order: q.order as 'asc' | 'desc' | undefined,
        });
        return result;
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/logs/search',
    async (
      request: FastifyRequest<{
        Querystring: { q: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { q, limit, offset } = request.query;
        if (!q) {
          return sendError(reply, 400, 'Query parameter "q" is required');
        }
        const searchPg = parsePagination(
          { limit, offset },
          { maxLimit: MAX_QUERY_LIMIT, defaultLimit: 50 }
        );
        const result = await brainManager.searchAuditLogs(q, {
          limit: searchPg.limit,
          offset: searchPg.offset,
        });
        return result;
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── Semantic Search ───────────────────────────────────────

  app.get(
    '/api/v1/brain/search/similar',
    async (
      request: FastifyRequest<{
        Querystring: {
          query: string;
          limit?: string;
          threshold?: string;
          type?: string;
          personalityId?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const { query, limit, threshold, type, personalityId } = request.query;
        if (!query) {
          return sendError(reply, 400, 'Query parameter "query" is required');
        }
        const semPg = parsePagination({ limit }, { maxLimit: MAX_QUERY_LIMIT, defaultLimit: 20 });
        const results = await brainManager.semanticSearch(query, {
          limit: semPg.limit,
          threshold: threshold ? Number(threshold) : undefined,
          type: type as 'memories' | 'knowledge' | 'all' | undefined,
          personalityId,
        });
        return { results };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.post('/api/v1/brain/reindex', async (_request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = _request.ip ?? 'unknown';
    if (!checkBrainRateLimit(`brain:reindex:${clientIp}`, 5)) {
      return sendError(reply, 429, 'Rate limit exceeded for reindex');
    }

    try {
      const stats = await brainManager.getStats();
      return {
        message: 'Reindex triggered',
        memoriesCount: stats.memories.total,
        knowledgeCount: stats.knowledge.total,
      };
    } catch (err) {
      return sendError(reply, 400, toErrorMessage(err));
    }
  });

  // ── Consolidation ──────────────────────────────────────────

  app.post(
    '/api/v1/brain/consolidation/run',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const clientIp = _request.ip ?? 'unknown';
      if (!checkBrainRateLimit(`brain:consolidation:run:${clientIp}`, 5)) {
        return sendError(reply, 429, 'Rate limit exceeded for consolidation');
      }

      try {
        const report = await brainManager.runConsolidation();
        return { report };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/consolidation/schedule',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const schedule = brainManager.getConsolidationSchedule();
      if (schedule === null) {
        return sendError(reply, 503, 'Consolidation not available');
      }
      return { schedule };
    }
  );

  app.put(
    '/api/v1/brain/consolidation/schedule',
    async (
      request: FastifyRequest<{
        Body: { schedule: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        brainManager.setConsolidationSchedule(request.body.schedule);
        return { schedule: request.body.schedule };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/consolidation/history',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      try {
        const { limit } = parsePagination(request.query, {
          defaultLimit: 50,
          maxLimit: MAX_QUERY_LIMIT,
        });
        const memories = await brainManager.recall({ source: 'consolidation', limit });
        return { history: memories };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── External Brain Sync ───────────────────────────────────

  app.get('/api/v1/brain/sync/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!externalSync) {
      return sendError(reply, 503, 'External brain sync not configured');
    }
    return externalSync.getStatus();
  });

  app.post('/api/v1/brain/sync', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!externalSync) {
      return sendError(reply, 503, 'External brain sync not configured');
    }

    const clientIp = _request.ip ?? 'unknown';
    if (!checkBrainRateLimit(`brain:sync:${clientIp}`, 5)) {
      return sendError(reply, 429, 'Rate limit exceeded for sync');
    }

    try {
      const result = await externalSync.sync();
      return { result };
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── External Brain Config ───────────────────────────────────

  app.get('/api/v1/brain/sync/config', async (_request: FastifyRequest, _reply: FastifyReply) => {
    if (!externalSync) {
      return { configured: false, enabled: false };
    }
    return {
      configured: true,
      enabled: externalSync.isEnabled(),
      provider: externalSync.getProvider(),
      path: externalSync.getPath(),
    };
  });

  app.put(
    '/api/v1/brain/sync/config',
    async (
      request: FastifyRequest<{
        Body: {
          enabled?: boolean;
          provider?: string;
          path?: string;
          subdir?: string;
          syncIntervalMs?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      if (!externalSync) {
        return sendError(reply, 503, 'External brain sync not initialized');
      }

      // Validate path/subdir if provided — reject traversal and home expansion
      const body = request.body as Record<string, unknown>;
      for (const field of ['path', 'subdir']) {
        const val = body[field];
        if (
          typeof val === 'string' &&
          (/\.\.[\\/]/.test(val) || val.includes('~') || val.includes('%2e'))
        ) {
          return sendError(reply, 400, 'Invalid path: path traversal detected');
        }
      }

      try {
        await externalSync.updateConfig(
          request.body as Partial<import('@secureyeoman/shared').ExternalBrainConfig>
        );
        return { success: true };
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── Cognitive Memory (Phase 124) ──────────────────────────────

  app.get(
    '/api/v1/brain/cognitive-stats',
    async (
      request: FastifyRequest<{ Querystring: { personalityId?: string } }>,
      reply: FastifyReply
    ) => {
      if (!cognitiveMemoryManager) {
        return sendError(reply, 503, 'Cognitive memory system not available');
      }
      try {
        const { personalityId } = request.query;
        const stats = await cognitiveMemoryManager.getCognitiveStats(personalityId || undefined);
        return { stats };
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  app.get(
    '/api/v1/brain/associations/:itemId',
    async (
      request: FastifyRequest<{
        Params: { itemId: string };
        Querystring: { limit?: string; minWeight?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!cognitiveStorage) {
        return sendError(reply, 503, 'Cognitive memory system not available');
      }
      try {
        const { itemId } = request.params;

        // Resolve itemId to its underlying memory or knowledge entry for ownership check
        const memory = await brainManager.getMemory(itemId);
        const owner = memory ?? (await brainManager.getKnowledge(itemId));
        if (!owner) return sendError(reply, 404, 'Item not found');
        if (!canAccessResource(request, owner)) return sendError(reply, 403, 'Access denied');

        const { limit, minWeight } = request.query;
        const associations = await cognitiveStorage.getAssociations(itemId, {
          limit: limit ? Math.min(Number(limit), MAX_QUERY_LIMIT) : 20,
          minWeight: minWeight ? Number(minWeight) : undefined,
        });
        return { associations };
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  app.post(
    '/api/v1/brain/cognitive/maintenance',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (!cognitiveMemoryManager) {
        return sendError(reply, 503, 'Cognitive memory system not available');
      }

      const clientIp = _request.ip ?? 'unknown';
      if (!checkBrainRateLimit(`brain:cognitive:maintenance:${clientIp}`, 5)) {
        return sendError(reply, 429, 'Rate limit exceeded for cognitive maintenance');
      }

      try {
        const result = await cognitiveMemoryManager.runMaintenance();
        return { result };
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );
}
