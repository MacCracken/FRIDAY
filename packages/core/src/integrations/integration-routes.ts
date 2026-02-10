/**
 * Integration Routes — API endpoints for integration management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { IntegrationManager } from './manager.js';
import type { IntegrationStorage } from './storage.js';
import type { IntegrationCreate, IntegrationUpdate } from '@friday/shared';

export interface IntegrationRoutesOptions {
  integrationManager: IntegrationManager;
  integrationStorage: IntegrationStorage;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

export function registerIntegrationRoutes(
  app: FastifyInstance,
  opts: IntegrationRoutesOptions,
): void {
  const { integrationManager, integrationStorage } = opts;

  // ── Available Platforms ───────────────────────────────────

  app.get('/api/v1/integrations/platforms', async () => {
    return { platforms: integrationManager.getAvailablePlatforms() };
  });

  // ── List Integrations ────────────────────────────────────

  app.get('/api/v1/integrations', async (
    request: FastifyRequest<{ Querystring: { platform?: string; enabled?: string } }>,
  ) => {
    const filter: { platform?: any; enabled?: boolean } = {};
    if (request.query.platform) filter.platform = request.query.platform;
    if (request.query.enabled !== undefined) filter.enabled = request.query.enabled === 'true';

    const integrations = integrationManager.listIntegrations(filter);
    return {
      integrations,
      total: integrations.length,
      running: integrationManager.getRunningCount(),
    };
  });

  // ── Get Integration ──────────────────────────────────────

  app.get('/api/v1/integrations/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const integration = integrationManager.getIntegration(request.params.id);
    if (!integration) {
      return reply.code(404).send({ error: 'Integration not found' });
    }
    return {
      integration,
      running: integrationManager.isRunning(request.params.id),
      healthy: integrationManager.isHealthy(request.params.id),
    };
  });

  // ── Create Integration ───────────────────────────────────

  app.post('/api/v1/integrations', async (
    request: FastifyRequest<{ Body: IntegrationCreate }>,
    reply: FastifyReply,
  ) => {
    try {
      const integration = integrationManager.createIntegration(request.body);
      return reply.code(201).send({ integration });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Update Integration ───────────────────────────────────

  app.put('/api/v1/integrations/:id', async (
    request: FastifyRequest<{ Params: { id: string }; Body: IntegrationUpdate }>,
    reply: FastifyReply,
  ) => {
    const integration = integrationManager.updateIntegration(request.params.id, request.body);
    if (!integration) {
      return reply.code(404).send({ error: 'Integration not found' });
    }
    return { integration };
  });

  // ── Delete Integration ───────────────────────────────────

  app.delete('/api/v1/integrations/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const deleted = integrationManager.deleteIntegration(request.params.id);
    if (!deleted) {
      return reply.code(404).send({ error: 'Integration not found' });
    }
    return { message: 'Integration deleted' };
  });

  // ── Start / Stop ─────────────────────────────────────────

  app.post('/api/v1/integrations/:id/start', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      await integrationManager.startIntegration(request.params.id);
      return { message: 'Integration started' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  app.post('/api/v1/integrations/:id/stop', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      await integrationManager.stopIntegration(request.params.id);
      return { message: 'Integration stopped' };
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });

  // ── Messages ─────────────────────────────────────────────

  app.get('/api/v1/integrations/:id/messages', async (
    request: FastifyRequest<{ Params: { id: string }; Querystring: { limit?: string; offset?: string } }>,
  ) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
    const messages = integrationStorage.listMessages(request.params.id, { limit, offset });
    return { messages };
  });

  app.post('/api/v1/integrations/:id/messages', async (
    request: FastifyRequest<{ Params: { id: string }; Body: { chatId: string; text: string } }>,
    reply: FastifyReply,
  ) => {
    try {
      const platformMessageId = await integrationManager.sendMessage(
        request.params.id,
        request.body.chatId,
        request.body.text,
      );
      return reply.code(201).send({ platformMessageId });
    } catch (err) {
      return reply.code(400).send({ error: errorMessage(err) });
    }
  });
}
