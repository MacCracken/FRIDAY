/**
 * Proactive Routes — REST API for proactive assistance system.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ProactiveManager } from './manager.js';
import type { HeartbeatLogStorage } from '../body/heartbeat-log-storage.js';
import { sendError, toErrorMessage } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';

export function registerProactiveRoutes(
  app: FastifyInstance,
  opts: { proactiveManager: ProactiveManager; logStorage?: HeartbeatLogStorage }
): void {
  const { proactiveManager, logStorage } = opts;

  // ── Trigger routes ──────────────────────────────────────────────

  app.get(
    '/api/v1/proactive/triggers',
    async (
      request: FastifyRequest<{
        Querystring: { type?: string; enabled?: string; limit?: string; offset?: string };
      }>
    ) => {
      const { limit, offset } = parsePagination(request.query);
      const filter: { type?: string; enabled?: boolean; limit?: number; offset?: number } = {
        limit,
        offset,
      };
      if (request.query.type) filter.type = request.query.type;
      if (request.query.enabled !== undefined) filter.enabled = request.query.enabled === 'true';
      return proactiveManager.listTriggers(filter);
    }
  );

  app.get('/api/v1/proactive/triggers/builtin', async () => {
    const triggers = proactiveManager.getBuiltinTriggers();
    return { triggers, total: triggers.length };
  });

  app.get(
    '/api/v1/proactive/triggers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const trigger = await proactiveManager.getTrigger(request.params.id);
      if (!trigger) return sendError(reply, 404, 'Trigger not found');
      return trigger;
    }
  );

  app.post(
    '/api/v1/proactive/triggers',
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          description?: string;
          enabled?: boolean;
          type: string;
          condition: Record<string, unknown>;
          action: Record<string, unknown>;
          approvalMode?: string;
          cooldownMs?: number;
          limitPerDay?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const trigger = await proactiveManager.createTrigger(request.body as any);
        return reply.code(201).send(trigger);
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.patch(
    '/api/v1/proactive/triggers/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Record<string, unknown>;
      }>,
      reply: FastifyReply
    ) => {
      const trigger = await proactiveManager.updateTrigger(request.params.id, request.body);
      if (!trigger) return sendError(reply, 404, 'Trigger not found');
      return trigger;
    }
  );

  app.delete(
    '/api/v1/proactive/triggers/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = await proactiveManager.deleteTrigger(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Trigger not found');
      return reply.code(204).send();
    }
  );

  app.post(
    '/api/v1/proactive/triggers/:id/enable',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const trigger = await proactiveManager.enableTrigger(request.params.id);
      if (!trigger) return sendError(reply, 404, 'Trigger not found');
      return trigger;
    }
  );

  app.post(
    '/api/v1/proactive/triggers/:id/disable',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const trigger = await proactiveManager.disableTrigger(request.params.id);
      if (!trigger) return sendError(reply, 404, 'Trigger not found');
      return trigger;
    }
  );

  app.post(
    '/api/v1/proactive/triggers/:id/test',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      return proactiveManager.testTrigger(request.params.id);
    }
  );

  app.post(
    '/api/v1/proactive/triggers/builtin/:id/enable',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const trigger = await proactiveManager.enableBuiltinTrigger(request.params.id);
      if (!trigger) return sendError(reply, 404, 'Built-in trigger not found');
      return trigger;
    }
  );

  // ── Suggestion routes ───────────────────────────────────────────

  app.get(
    '/api/v1/proactive/suggestions',
    async (
      request: FastifyRequest<{
        Querystring: { status?: string; triggerId?: string; limit?: string; offset?: string };
      }>
    ) => {
      const q = request.query;
      const { limit, offset } = parsePagination(q);
      return proactiveManager.listSuggestions({
        status: q.status as any,
        triggerId: q.triggerId,
        limit,
        offset,
      });
    }
  );

  app.post(
    '/api/v1/proactive/suggestions/:id/approve',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      return proactiveManager.approveSuggestion(request.params.id);
    }
  );

  app.post(
    '/api/v1/proactive/suggestions/:id/dismiss',
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const dismissed = await proactiveManager.dismissSuggestion(request.params.id);
      return { success: dismissed };
    }
  );

  app.delete('/api/v1/proactive/suggestions/expired', async (_request, reply: FastifyReply) => {
    await proactiveManager.clearExpiredSuggestions();
    return reply.code(204).send();
  });

  // ── Pattern routes ──────────────────────────────────────────────

  app.get('/api/v1/proactive/patterns', async () => {
    const patterns = await proactiveManager.detectPatterns();
    return { patterns };
  });

  app.post(
    '/api/v1/proactive/patterns/:id/convert',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const trigger = await proactiveManager.convertPatternToTrigger(request.params.id);
      if (!trigger) return sendError(reply, 404, 'Pattern not found');
      return trigger;
    }
  );

  // ── Status route ────────────────────────────────────────────────

  app.get('/api/v1/proactive/status', async () => {
    return proactiveManager.getStatus();
  });

  // ── Heartbeat Execution Log ──────────────────────────────────────

  app.get(
    '/api/v1/proactive/heartbeat/log',
    async (
      request: FastifyRequest<{
        Querystring: { checkName?: string; status?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!logStorage) return sendError(reply, 503, 'Heartbeat log storage not available');
      const { checkName, status } = request.query;
      const { limit, offset } = parsePagination(request.query);
      return logStorage.list({
        checkName,
        status: status as 'ok' | 'warning' | 'error' | undefined,
        limit,
        offset,
      });
    }
  );
}
