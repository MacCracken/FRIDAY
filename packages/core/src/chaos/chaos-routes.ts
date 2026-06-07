/**
 * Chaos Routes — REST API for chaos engineering experiments.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ChaosManager } from './chaos-manager.js';
import type { ChaosExperimentStatus } from '@secureyeoman/shared';
import { sendError } from '../utils/errors.js';
import type { SecureYeoman } from '../secureyeoman.js';
import { licenseGuard } from '../licensing/license-guard.js';

export interface ChaosRouteOptions {
  chaosManager: ChaosManager;
  secureYeoman?: SecureYeoman;
}

export function registerChaosRoutes(app: FastifyInstance, opts: ChaosRouteOptions): void {
  const { chaosManager, secureYeoman } = opts;
  const featureGuardOpts = licenseGuard('compliance_governance', secureYeoman);

  // ── List experiments ───────────────────────────────────────────

  app.get(
    '/api/v1/chaos/experiments',
    async (
      req: FastifyRequest<{
        Querystring: { status?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      const q = req.query;
      const result = await chaosManager.listExperiments({
        status: q.status as ChaosExperimentStatus | undefined,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        offset: q.offset ? parseInt(q.offset, 10) : undefined,
      });
      return reply.send(result);
    }
  );

  // ── Get experiment ─────────────────────────────────────────────

  app.get(
    '/api/v1/chaos/experiments/:experimentId',
    async (req: FastifyRequest<{ Params: { experimentId: string } }>, reply: FastifyReply) => {
      const experiment = await chaosManager.getExperiment(req.params.experimentId);
      if (!experiment) return sendError(reply, 404, 'Experiment not found');
      return reply.send(experiment);
    }
  );

  // ── Create experiment ──────────────────────────────────────────

  app.post(
    '/api/v1/chaos/experiments',
    featureGuardOpts,
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const experiment = await chaosManager.createExperiment(
          req.body as Parameters<ChaosManager['createExperiment']>[0]
        );
        return reply.code(201).send(experiment);
      } catch (err) {
        return sendError(reply, 400, (err as Error).message);
      }
    }
  );

  // ── Run experiment ─────────────────────────────────────────────

  app.post(
    '/api/v1/chaos/experiments/:experimentId/run',
    featureGuardOpts,
    async (req: FastifyRequest<{ Params: { experimentId: string } }>, reply: FastifyReply) => {
      try {
        const result = await chaosManager.runExperiment(req.params.experimentId);
        return reply.send(result);
      } catch (err) {
        return sendError(reply, 400, (err as Error).message);
      }
    }
  );

  // ── Schedule experiment ────────────────────────────────────────

  app.post(
    '/api/v1/chaos/experiments/:experimentId/schedule',
    featureGuardOpts,
    async (
      req: FastifyRequest<{
        Params: { experimentId: string };
        Body: { scheduledAt: number };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const body = req.body;
        if (!body.scheduledAt || body.scheduledAt <= Date.now()) {
          return sendError(reply, 400, 'scheduledAt must be a future timestamp');
        }
        const experiment = await chaosManager.scheduleExperiment(
          req.params.experimentId,
          body.scheduledAt
        );
        return reply.send(experiment);
      } catch (err) {
        return sendError(reply, 400, (err as Error).message);
      }
    }
  );

  // ── Abort experiment ───────────────────────────────────────────

  app.post(
    '/api/v1/chaos/experiments/:experimentId/abort',
    featureGuardOpts,
    async (req: FastifyRequest<{ Params: { experimentId: string } }>, reply: FastifyReply) => {
      const aborted = await chaosManager.abortExperiment(req.params.experimentId);
      if (!aborted) return sendError(reply, 404, 'Experiment not running');
      return reply.send({ ok: true });
    }
  );

  // ── Delete experiment ──────────────────────────────────────────

  app.delete(
    '/api/v1/chaos/experiments/:experimentId',
    featureGuardOpts,
    async (req: FastifyRequest<{ Params: { experimentId: string } }>, reply: FastifyReply) => {
      try {
        const deleted = await chaosManager.deleteExperiment(req.params.experimentId);
        if (!deleted) return sendError(reply, 404, 'Experiment not found');
        return reply.send({ ok: true });
      } catch (err) {
        return sendError(reply, 400, (err as Error).message);
      }
    }
  );

  // ── Get results ────────────────────────────────────────────────

  app.get(
    '/api/v1/chaos/experiments/:experimentId/results',
    async (req: FastifyRequest<{ Params: { experimentId: string } }>, reply: FastifyReply) => {
      const results = await chaosManager.getResults(req.params.experimentId);
      return reply.send({ items: results, total: results.length });
    }
  );

  // ── Status overview ────────────────────────────────────────────

  app.get('/api/v1/chaos/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      runningExperiments: chaosManager.runningCount,
      enabled: true,
    });
  });
}
