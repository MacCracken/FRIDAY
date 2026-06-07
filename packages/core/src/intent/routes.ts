/**
 * Intent Routes — Phase 48: Machine Readable Organizational Intent
 *
 * CRUD for OrgIntent documents, activation, and enforcement log feed.
 */

import type { FastifyInstance } from 'fastify';
import type { IntentManager } from './manager.js';
import type { AuditChain } from '../logging/audit-chain.js';
import type { InputValidator } from '../security/input-validator.js';
import { OrgIntentDocSchema } from './schema.js';
import type { EnforcementEventType } from './schema.js';
import { sendError, toErrorMessage } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';

export interface IntentRoutesOptions {
  intentManager: IntentManager;
  auditChain?: AuditChain;
  validator?: InputValidator;
}

export function registerIntentRoutes(app: FastifyInstance, opts: IntentRoutesOptions): void {
  const { intentManager, auditChain } = opts;
  const storage = intentManager.getStorage();

  // ── GET /api/v1/intent — list all intent docs (metadata only) ──────────────
  app.get('/api/v1/intent', async (_req, reply) => {
    try {
      const intents = await storage.listIntents();
      return reply.send({ intents });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── POST /api/v1/intent — create intent doc ────────────────────────────────
  app.post('/api/v1/intent', async (req, reply) => {
    const parsed = OrgIntentDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.errors.map((e) => e.message).join('; '));
    }
    try {
      const record = await storage.createIntent(parsed.data);
      // Sync any rego policies to OPA sidecar on creation
      await intentManager.syncPoliciesWithOpa(record);
      await auditChain?.record({
        event: 'intent_doc_created',
        level: 'info',
        message: `Intent doc created: ${record.name}`,
        metadata: { intentId: record.id, name: record.name },
      });
      return reply.code(201).send({ intent: record });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/intent/active — get active intent doc ────────────────────
  app.get('/api/v1/intent/active', async (_req, reply) => {
    try {
      const record = await storage.getActiveIntent();
      if (!record) return sendError(reply, 404, 'No active intent document');
      return reply.send({ intent: record });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/intent/enforcement-log — query enforcement log ────────────
  app.get('/api/v1/intent/enforcement-log', async (req, reply) => {
    const q = req.query as Record<string, string>;
    try {
      const entries = await storage.queryEnforcementLog({
        eventType: q.eventType as EnforcementEventType | undefined,
        agentId: q.agentId,
        itemId: q.itemId,
        since: q.since ? Number(q.since) : undefined,
        limit: parsePagination(q, { defaultLimit: 100 }).limit,
      });
      return reply.send({ entries });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/intent/:id — get full intent doc ──────────────────────────
  app.get<{ Params: { id: string } }>('/api/v1/intent/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const record = await storage.getIntentDoc(id);
      if (!record) return sendError(reply, 404, 'Intent document not found');
      return reply.send({ intent: record });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── PUT /api/v1/intent/:id — update intent doc ────────────────────────────
  app.put<{ Params: { id: string } }>('/api/v1/intent/:id', async (req, reply) => {
    const { id } = req.params;
    const parsed = OrgIntentDocSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, parsed.error.errors.map((e) => e.message).join('; '));
    }
    try {
      const record = await storage.updateIntent(id, parsed.data);
      if (!record) return sendError(reply, 404, 'Intent document not found');
      // Sync rego policies to OPA sidecar (no-op if OPA not configured)
      await intentManager.syncPoliciesWithOpa(record);
      // If this is the active intent, reload in manager
      if (record.isActive) {
        await intentManager.reloadActiveIntent();
      }
      return reply.send({ intent: record });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── DELETE /api/v1/intent/:id ─────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/v1/intent/:id', async (req, reply) => {
    const { id } = req.params;
    try {
      const deleted = await storage.deleteIntent(id);
      if (!deleted) return sendError(reply, 404, 'Intent document not found');
      await intentManager.reloadActiveIntent();
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── POST /api/v1/intent/:id/activate — set as active ─────────────────────
  app.post<{ Params: { id: string } }>('/api/v1/intent/:id/activate', async (req, reply) => {
    const { id } = req.params;
    try {
      const record = await storage.getIntentDoc(id);
      if (!record) return sendError(reply, 404, 'Intent document not found');
      await storage.setActiveIntent(id);
      await intentManager.reloadActiveIntent();
      await auditChain?.record({
        event: 'intent_doc_activated',
        level: 'info',
        message: `Intent doc activated: ${record.name}`,
        metadata: { intentId: id, name: record.name },
      });
      return reply.send({ success: true });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/intent/signals/:id/value — read a signal value ──────────
  app.get<{ Params: { id: string } }>('/api/v1/intent/signals/:id/value', async (req, reply) => {
    const { id } = req.params;
    try {
      const result = await intentManager.readSignal(id);
      if (!result) return sendError(reply, 404, `Signal '${id}' not found in active intent`);
      return reply.send(result);
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/intent/:id/goals/:goalId/timeline — goal lifecycle events ─
  app.get<{ Params: { id: string; goalId: string } }>(
    '/api/v1/intent/:id/goals/:goalId/timeline',
    async (req, reply) => {
      const { id, goalId } = req.params;
      try {
        const record = await storage.getIntentDoc(id);
        if (!record) return sendError(reply, 404, 'Intent document not found');
        const entries = await intentManager.getGoalTimeline(id, goalId);
        return reply.send({ entries });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );
}
