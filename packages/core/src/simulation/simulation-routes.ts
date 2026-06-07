/**
 * Simulation Routes — REST endpoints for tick driver and mood engine.
 *
 * All routes gated by enterprise `simulation` license.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { TickDriver } from './tick-driver.js';
import type { MoodEngine } from './mood-engine.js';
import type { SpatialEngine } from './spatial-engine.js';
import type { ExperimentRunner } from './experiment-runner.js';
import type { RelationshipGraph } from './relationship-graph.js';
import type { SimulationStore } from './simulation-store.js';
import { licenseGuard } from '../licensing/license-guard.js';
import {
  TickConfigCreateSchema,
  MoodEventCreateSchema,
  EntityLocationUpsertSchema,
  SpatialZoneCreateSchema,
  ProximityRuleCreateSchema,
  EntityRelationshipCreateSchema,
  RelationshipEventCreateSchema,
  EntityGroupCreateSchema,
} from '@secureyeoman/shared';
import { sendError } from '../utils/errors.js';

/** Parse a query-string number, returning undefined if missing/invalid/non-finite. */
function safeNum(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

interface SimulationRouteOpts {
  store: SimulationStore;
  tickDriver: TickDriver;
  moodEngine: MoodEngine;
  spatialEngine?: SpatialEngine;
  experimentRunner?: ExperimentRunner;
  relationshipGraph?: RelationshipGraph;
  secureYeoman?: {
    getLicenseManager(): import('../licensing/license-manager.js').LicenseManager;
  } | null;
}

export function registerSimulationRoutes(app: FastifyInstance, opts: SimulationRouteOpts): void {
  const {
    tickDriver,
    moodEngine,
    spatialEngine,
    experimentRunner,
    relationshipGraph,
    store,
    secureYeoman,
  } = opts;
  const guard = licenseGuard('simulation', secureYeoman);

  // ── Tick Driver Routes ──────────────────────────────────────────────

  // GET /api/v1/simulation/tick/:personalityId — get tick state
  app.get(
    '/api/v1/simulation/tick/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const config = await tickDriver.getState(request.params.personalityId);
      if (!config) {
        return sendError(reply, 404, 'Tick config not found');
      }
      return reply.send(config);
    }
  );

  // POST /api/v1/simulation/tick/:personalityId — create/update tick config & start
  app.post(
    '/api/v1/simulation/tick/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = TickConfigCreateSchema.safeParse({
        ...(request.body as Record<string, unknown>),
        personalityId: request.params.personalityId,
      });
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid tick config', {
          extra: { issues: parsed.error.issues },
        });
      }
      const config = await tickDriver.startPersonality(parsed.data);
      return reply.code(201).send(config);
    }
  );

  // POST /api/v1/simulation/tick/:personalityId/advance — manual tick advance
  app.post(
    '/api/v1/simulation/tick/:personalityId/advance',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const event = await tickDriver.advanceTick(request.params.personalityId);
      if (!event) {
        return sendError(reply, 404, 'Tick config not found');
      }
      return reply.send(event);
    }
  );

  // POST /api/v1/simulation/tick/:personalityId/pause
  app.post(
    '/api/v1/simulation/tick/:personalityId/pause',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const config = await tickDriver.pausePersonality(request.params.personalityId);
      if (!config) {
        return sendError(reply, 404, 'Tick config not found');
      }
      return reply.send(config);
    }
  );

  // POST /api/v1/simulation/tick/:personalityId/resume
  app.post(
    '/api/v1/simulation/tick/:personalityId/resume',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const config = await tickDriver.resumePersonality(request.params.personalityId);
      if (!config) {
        return sendError(reply, 404, 'Tick config not found');
      }
      return reply.send(config);
    }
  );

  // DELETE /api/v1/simulation/tick/:personalityId — stop & remove
  app.delete(
    '/api/v1/simulation/tick/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const deleted = await tickDriver.stopPersonality(request.params.personalityId);
      if (!deleted) {
        return sendError(reply, 404, 'Tick config not found');
      }
      return reply.code(204).send();
    }
  );

  // ── Mood Routes ─────────────────────────────────────────────────────

  // GET /api/v1/personalities/:id/mood — current mood state
  app.get(
    '/api/v1/personalities/:id/mood',
    guard,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const mood = await moodEngine.getMood(request.params.id);
      if (!mood) {
        return sendError(reply, 404, 'Mood state not found');
      }
      return reply.send(mood);
    }
  );

  // POST /api/v1/personalities/:id/mood/event — submit mood event
  app.post(
    '/api/v1/personalities/:id/mood/event',
    guard,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const parsed = MoodEventCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid mood event', {
          extra: { issues: parsed.error.issues },
        });
      }
      const mood = await moodEngine.applyEvent(request.params.id, parsed.data);
      return reply.send(mood);
    }
  );

  // GET /api/v1/personalities/:id/mood/history — mood event history
  app.get(
    '/api/v1/personalities/:id/mood/history',
    guard,
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string; since?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const events = await store.listMoodEvents(request.params.id, {
        limit: safeNum(qs.limit),
        since: safeNum(qs.since),
      });
      return reply.send({ items: events });
    }
  );

  // POST /api/v1/personalities/:id/mood/reset — reset to baseline
  app.post(
    '/api/v1/personalities/:id/mood/reset',
    guard,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const mood = await moodEngine.getMood(request.params.id);
      if (!mood) {
        return sendError(reply, 404, 'Mood state not found');
      }
      const reset = await moodEngine.applyEvent(request.params.id, {
        eventType: 'reset',
        valenceDelta: mood.baselineValence - mood.valence,
        arousalDelta: mood.baselineArousal - mood.arousal,
        source: 'system',
        metadata: { reason: 'manual reset' },
      });
      return reply.send(reset);
    }
  );

  // ── Spatial & Proximity Routes ────────────────────────────────────

  if (!spatialEngine) return;

  // POST /api/v1/simulation/spatial/:personalityId/entities — upsert entity location
  app.post(
    '/api/v1/simulation/spatial/:personalityId/entities',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = EntityLocationUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid entity location', {
          extra: { issues: parsed.error.issues },
        });
      }
      const loc = await spatialEngine.updateEntityLocation(
        request.params.personalityId,
        parsed.data
      );
      return reply.send(loc);
    }
  );

  // GET /api/v1/simulation/spatial/:personalityId/entities — list entity locations
  app.get(
    '/api/v1/simulation/spatial/:personalityId/entities',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string };
        Querystring: { zoneId?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const items = await spatialEngine.listEntities(request.params.personalityId, {
        zoneId: qs.zoneId,
        limit: safeNum(qs.limit),
      });
      return reply.send({ items });
    }
  );

  // DELETE /api/v1/simulation/spatial/:personalityId/entities/:entityId
  app.delete(
    '/api/v1/simulation/spatial/:personalityId/entities/:entityId',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; entityId: string } }>,
      reply: FastifyReply
    ) => {
      const deleted = await spatialEngine.removeEntity(
        request.params.personalityId,
        request.params.entityId
      );
      if (!deleted) return sendError(reply, 404, 'Entity not found');
      return reply.code(204).send();
    }
  );

  // POST /api/v1/simulation/spatial/:personalityId/zones — create zone
  app.post(
    '/api/v1/simulation/spatial/:personalityId/zones',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = SpatialZoneCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid zone definition', {
          extra: { issues: parsed.error.issues },
        });
      }
      const zone = await spatialEngine.createZone(request.params.personalityId, parsed.data);
      return reply.code(201).send(zone);
    }
  );

  // GET /api/v1/simulation/spatial/:personalityId/zones — list zones
  app.get(
    '/api/v1/simulation/spatial/:personalityId/zones',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const items = await spatialEngine.listZones(request.params.personalityId);
      return reply.send({ items });
    }
  );

  // DELETE /api/v1/simulation/spatial/:personalityId/zones/:zoneId
  app.delete(
    '/api/v1/simulation/spatial/:personalityId/zones/:zoneId',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; zoneId: string } }>,
      reply: FastifyReply
    ) => {
      const deleted = await spatialEngine.deleteZone(
        request.params.personalityId,
        request.params.zoneId
      );
      if (!deleted) return sendError(reply, 404, 'Zone not found');
      return reply.code(204).send();
    }
  );

  // POST /api/v1/simulation/spatial/:personalityId/rules — create proximity rule
  app.post(
    '/api/v1/simulation/spatial/:personalityId/rules',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = ProximityRuleCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid proximity rule', {
          extra: { issues: parsed.error.issues },
        });
      }
      const rule = await spatialEngine.addRule(request.params.personalityId, parsed.data);
      return reply.code(201).send(rule);
    }
  );

  // GET /api/v1/simulation/spatial/:personalityId/rules — list rules
  app.get(
    '/api/v1/simulation/spatial/:personalityId/rules',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const items = await spatialEngine.listRules(request.params.personalityId);
      return reply.send({ items });
    }
  );

  // DELETE /api/v1/simulation/spatial/:personalityId/rules/:ruleId
  app.delete(
    '/api/v1/simulation/spatial/:personalityId/rules/:ruleId',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; ruleId: string } }>,
      reply: FastifyReply
    ) => {
      const deleted = await spatialEngine.deleteRule(
        request.params.ruleId,
        request.params.personalityId
      );
      if (!deleted) return sendError(reply, 404, 'Rule not found');
      return reply.code(204).send();
    }
  );

  // GET /api/v1/simulation/spatial/:personalityId/proximity — proximity event history
  app.get(
    '/api/v1/simulation/spatial/:personalityId/proximity',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string };
        Querystring: { limit?: string; sinceTick?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const items = await spatialEngine.listProximityEvents(request.params.personalityId, {
        limit: safeNum(qs.limit),
        sinceTick: safeNum(qs.sinceTick),
      });
      return reply.send({ items });
    }
  );

  // ── Experiment Runner Routes ──────────────────────────────────────

  if (!experimentRunner) return;

  // POST /api/v1/simulation/experiments/:personalityId/sessions — create session
  app.post(
    '/api/v1/simulation/experiments/:personalityId/sessions',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      if (!body.name || !body.objective || !body.metricName || !body.baselineParams) {
        return sendError(
          reply,
          400,
          'Missing required fields: name, objective, metricName, baselineParams'
        );
      }
      const session = await experimentRunner.createSession(
        request.params.personalityId,
        body as unknown as Parameters<typeof experimentRunner.createSession>[1]
      );
      return reply.code(201).send(session);
    }
  );

  // GET /api/v1/simulation/experiments/:personalityId/sessions — list sessions
  app.get(
    '/api/v1/simulation/experiments/:personalityId/sessions',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const items = await experimentRunner.listSessions(request.params.personalityId);
      return reply.send({ items });
    }
  );

  // GET /api/v1/simulation/experiments/sessions/:sessionId — get session
  app.get(
    '/api/v1/simulation/experiments/sessions/:sessionId',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const session = await experimentRunner.getSession(request.params.sessionId);
      if (!session) return sendError(reply, 404, 'Session not found');
      return reply.send(session);
    }
  );

  // POST /api/v1/simulation/experiments/sessions/:sessionId/pause
  app.post(
    '/api/v1/simulation/experiments/sessions/:sessionId/pause',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const session = await experimentRunner.pauseSession(request.params.sessionId);
      if (!session) return sendError(reply, 404, 'Session not found');
      return reply.send(session);
    }
  );

  // POST /api/v1/simulation/experiments/sessions/:sessionId/resume
  app.post(
    '/api/v1/simulation/experiments/sessions/:sessionId/resume',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const session = await experimentRunner.resumeSession(request.params.sessionId);
      if (!session) return sendError(reply, 404, 'Session not found');
      return reply.send(session);
    }
  );

  // POST /api/v1/simulation/experiments/sessions/:sessionId/complete
  app.post(
    '/api/v1/simulation/experiments/sessions/:sessionId/complete',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const session = await experimentRunner.completeSession(request.params.sessionId);
      if (!session) return sendError(reply, 404, 'Session not found');
      return reply.send(session);
    }
  );

  // POST /api/v1/simulation/experiments/sessions/:sessionId/submit — manual experiment
  app.post(
    '/api/v1/simulation/experiments/sessions/:sessionId/submit',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      if (!body.description || !body.modifications) {
        return sendError(reply, 400, 'Missing required fields: description, modifications');
      }
      const run = await experimentRunner.submitExperiment(request.params.sessionId, {
        description: body.description as string,
        modifications: body.modifications as Record<string, unknown>,
        expectedOutcome: (body.expectedOutcome as string) ?? '',
      });
      if (!run) return sendError(reply, 404, 'Session not found or not active');
      return reply.send(run);
    }
  );

  // GET /api/v1/simulation/experiments/sessions/:sessionId/runs — list runs
  app.get(
    '/api/v1/simulation/experiments/sessions/:sessionId/runs',
    guard,
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
        Querystring: { limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const items = await experimentRunner.listRuns(request.params.sessionId, {
        limit: safeNum(qs.limit),
      });
      return reply.send({ items });
    }
  );

  // GET /api/v1/simulation/experiments/sessions/:sessionId/best — get best run
  app.get(
    '/api/v1/simulation/experiments/sessions/:sessionId/best',
    guard,
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const run = await experimentRunner.getBestRun(request.params.sessionId);
      if (!run) return sendError(reply, 404, 'No best run found');
      return reply.send(run);
    }
  );

  // ── Relationship Graph Routes ──────────────────────────────────────

  if (!relationshipGraph) return;

  // POST /api/v1/simulation/relationships/:personalityId — create relationship
  app.post(
    '/api/v1/simulation/relationships/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = EntityRelationshipCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid relationship data', {
          extra: { issues: parsed.error.issues },
        });
      }
      const rel = await relationshipGraph.createRelationship(
        request.params.personalityId,
        parsed.data
      );
      return reply.code(201).send(rel);
    }
  );

  // GET /api/v1/simulation/relationships/:personalityId — list relationships
  app.get(
    '/api/v1/simulation/relationships/:personalityId',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string };
        Querystring: { entityId?: string; type?: string; minAffinity?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const items = await relationshipGraph.listRelationships(request.params.personalityId, {
        entityId: qs.entityId,
        type: qs.type,
        minAffinity: safeNum(qs.minAffinity),
        limit: safeNum(qs.limit),
      });
      return reply.send({ items });
    }
  );

  // GET /api/v1/simulation/relationships/:personalityId/:sourceId/:targetId — get specific
  app.get(
    '/api/v1/simulation/relationships/:personalityId/:sourceId/:targetId',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string; sourceId: string; targetId: string };
      }>,
      reply: FastifyReply
    ) => {
      const rel = await relationshipGraph.getRelationship(
        request.params.personalityId,
        request.params.sourceId,
        request.params.targetId
      );
      if (!rel) return sendError(reply, 404, 'Relationship not found');
      return reply.send(rel);
    }
  );

  // PUT /api/v1/simulation/relationships/:personalityId/:sourceId/:targetId — update
  app.put(
    '/api/v1/simulation/relationships/:personalityId/:sourceId/:targetId',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string; sourceId: string; targetId: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body as Record<string, unknown>;
      const updates: { affinity?: number; trust?: number; metadata?: Record<string, unknown> } = {};
      if (body.affinity != null) {
        const a = Number(body.affinity);
        if (!Number.isFinite(a)) return sendError(reply, 400, 'affinity must be a finite number');
        updates.affinity = a;
      }
      if (body.trust != null) {
        const t = Number(body.trust);
        if (!Number.isFinite(t)) return sendError(reply, 400, 'trust must be a finite number');
        updates.trust = t;
      }
      if (body.metadata != null) updates.metadata = body.metadata as Record<string, unknown>;

      const rel = await relationshipGraph.updateRelationship(
        request.params.personalityId,
        request.params.sourceId,
        request.params.targetId,
        updates
      );
      if (!rel) return sendError(reply, 404, 'Relationship not found');
      return reply.send(rel);
    }
  );

  // DELETE /api/v1/simulation/relationships/:personalityId/:sourceId/:targetId — delete
  app.delete(
    '/api/v1/simulation/relationships/:personalityId/:sourceId/:targetId',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string; sourceId: string; targetId: string };
      }>,
      reply: FastifyReply
    ) => {
      const deleted = await relationshipGraph.deleteRelationship(
        request.params.personalityId,
        request.params.sourceId,
        request.params.targetId
      );
      if (!deleted) return sendError(reply, 404, 'Relationship not found');
      return reply.code(204).send();
    }
  );

  // POST /api/v1/simulation/relationships/:personalityId/interact — record interaction
  app.post(
    '/api/v1/simulation/relationships/:personalityId/interact',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = RelationshipEventCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid interaction data', {
          extra: { issues: parsed.error.issues },
        });
      }
      const event = await relationshipGraph.recordInteraction(
        request.params.personalityId,
        parsed.data
      );
      return reply.send(event);
    }
  );

  // GET /api/v1/simulation/relationships/:personalityId/events — list events
  app.get(
    '/api/v1/simulation/relationships/:personalityId/events',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string };
        Querystring: { entityId?: string; limit?: string; since?: string };
      }>,
      reply: FastifyReply
    ) => {
      const qs = request.query;
      const items = await relationshipGraph.listEvents(request.params.personalityId, {
        entityId: qs.entityId,
        limit: safeNum(qs.limit),
        since: safeNum(qs.since),
      });
      return reply.send({ items });
    }
  );

  // ── Group Routes ───────────────────────────────────────────────────

  // POST /api/v1/simulation/groups/:personalityId — create group
  app.post(
    '/api/v1/simulation/groups/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const parsed = EntityGroupCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'Invalid group data', {
          extra: { issues: parsed.error.issues },
        });
      }
      const group = await relationshipGraph.createGroup(request.params.personalityId, parsed.data);
      return reply.code(201).send(group);
    }
  );

  // GET /api/v1/simulation/groups/:personalityId — list groups
  app.get(
    '/api/v1/simulation/groups/:personalityId',
    guard,
    async (request: FastifyRequest<{ Params: { personalityId: string } }>, reply: FastifyReply) => {
      const items = await relationshipGraph.listGroups(request.params.personalityId);
      return reply.send({ items });
    }
  );

  // GET /api/v1/simulation/groups/:personalityId/:groupId/members — get members
  app.get(
    '/api/v1/simulation/groups/:personalityId/:groupId/members',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; groupId: string } }>,
      reply: FastifyReply
    ) => {
      const members = await relationshipGraph.getGroupMembers(
        request.params.personalityId,
        request.params.groupId
      );
      return reply.send({ members });
    }
  );

  // POST /api/v1/simulation/groups/:personalityId/:groupId/members — add member
  app.post(
    '/api/v1/simulation/groups/:personalityId/:groupId/members',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; groupId: string } }>,
      reply: FastifyReply
    ) => {
      const body = request.body as Record<string, unknown>;
      if (!body.entityId || typeof body.entityId !== 'string') {
        return sendError(reply, 400, 'Missing required field: entityId');
      }
      try {
        await relationshipGraph.addToGroup(
          request.params.personalityId,
          request.params.groupId,
          body.entityId
        );
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return sendError(reply, 404, err.message);
        }
        throw err;
      }
    }
  );

  // DELETE /api/v1/simulation/groups/:personalityId/:groupId/members/:entityId — remove member
  app.delete(
    '/api/v1/simulation/groups/:personalityId/:groupId/members/:entityId',
    guard,
    async (
      request: FastifyRequest<{
        Params: { personalityId: string; groupId: string; entityId: string };
      }>,
      reply: FastifyReply
    ) => {
      const removed = await relationshipGraph.removeFromGroup(
        request.params.personalityId,
        request.params.groupId,
        request.params.entityId
      );
      if (!removed) return sendError(reply, 404, 'Member or group not found');
      return reply.code(204).send();
    }
  );

  // DELETE /api/v1/simulation/groups/:personalityId/:groupId — delete group
  app.delete(
    '/api/v1/simulation/groups/:personalityId/:groupId',
    guard,
    async (
      request: FastifyRequest<{ Params: { personalityId: string; groupId: string } }>,
      reply: FastifyReply
    ) => {
      const deleted = await relationshipGraph.deleteGroup(
        request.params.personalityId,
        request.params.groupId
      );
      if (!deleted) return sendError(reply, 404, 'Group not found');
      return reply.code(204).send();
    }
  );
}
