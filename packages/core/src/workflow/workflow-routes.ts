/**
 * Workflow Routes — REST API for the workflow engine.
 *
 * NOTE: /api/v1/workflows/runs/:runId is registered BEFORE /api/v1/workflows/:id
 * to avoid route parameter collision in Fastify. Similarly, /export and /import
 * are registered before /:id for the same reason.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WorkflowManager } from './workflow-manager.js';
import type { WorkflowVersionManager } from './workflow-version-manager.js';
import { sendError, toErrorMessage } from '../utils/errors.js';
import { parsePagination } from '../utils/pagination.js';
import type { WorkflowExport } from '@secureyeoman/shared';

/** Known integration keywords to detect from step config strings. */
const INTEGRATION_KEYWORDS = [
  'github',
  'gmail',
  'slack',
  'discord',
  'telegram',
  'notion',
  'jira',
  'stripe',
  'twitter',
  'youtube',
  'spotify',
  'linear',
  'airtable',
  'figma',
  'gitlab',
  'azure',
  'aws',
] as const;

export function registerWorkflowRoutes(
  app: FastifyInstance,
  opts: { workflowManager: WorkflowManager; workflowVersionManager?: WorkflowVersionManager | null }
): void {
  const { workflowManager, workflowVersionManager } = opts;

  // ── Run detail (registered before /:id to avoid collision) ───

  app.get(
    '/api/v1/workflows/runs/:runId',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const run = await workflowManager.getRun(request.params.runId);
      if (!run) return sendError(reply, 404, 'Run not found');
      return { run };
    }
  );

  app.delete(
    '/api/v1/workflows/runs/:runId',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const run = await workflowManager.cancelRun(request.params.runId);
      if (!run) return sendError(reply, 404, 'Run not found');
      return { run };
    }
  );

  // ── Definition CRUD ───────────────────────────────────────────

  app.get(
    '/api/v1/workflows',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>,
      _reply: FastifyReply
    ) => {
      const { limit, offset } = parsePagination(request.query);
      return workflowManager.listDefinitions({ limit, offset });
    }
  );

  app.post(
    '/api/v1/workflows',
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          description?: string;
          steps?: unknown[];
          edges?: unknown[];
          triggers?: unknown[];
          isEnabled?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const definition = await workflowManager.createDefinition({
          name: request.body.name,
          description: request.body.description,
          steps: (request.body.steps ?? []) as any,
          edges: (request.body.edges ?? []) as any,
          triggers: (request.body.triggers ?? []) as any,
          isEnabled: request.body.isEnabled ?? true,
          version: 1,
          createdBy: 'system',
          autonomyLevel: 'L2',
        });
        return reply.code(201).send({ definition });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── Export a workflow definition ──────────────────────────────

  app.get(
    '/api/v1/workflows/:id/export',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const definition = await workflowManager.getDefinition(request.params.id);
      if (!definition) return sendError(reply, 404, 'Workflow not found');

      // Infer required tools from step config toolName fields
      const tools: string[] = [];
      const integrations: string[] = [];

      for (const step of definition.steps ?? []) {
        const cfg = (step as any).config ?? {};
        if (typeof cfg.toolName === 'string' && !tools.includes(cfg.toolName)) {
          tools.push(cfg.toolName);
        }
        // Scan all string values in the step for integration keywords
        const cfgStr = JSON.stringify(cfg).toLowerCase();
        for (const kw of INTEGRATION_KEYWORDS) {
          if (cfgStr.includes(kw) && !integrations.includes(kw)) {
            integrations.push(kw);
          }
        }
      }

      const exportPayload: WorkflowExport = {
        exportedAt: Date.now(),
        requires: {
          ...(tools.length > 0 && { tools }),
          ...(integrations.length > 0 && { integrations }),
        },
        workflow: definition,
      };

      return reply.code(200).send(exportPayload);
    }
  );

  // ── Import a workflow definition ──────────────────────────────

  app.post(
    '/api/v1/workflows/import',
    async (
      request: FastifyRequest<{ Body: { workflow: WorkflowExport; overwrite?: boolean } }>,
      reply: FastifyReply
    ) => {
      const { workflow: payload } = request.body ?? {};
      if (!payload?.workflow?.name) {
        return sendError(reply, 400, 'Invalid export: missing workflow.name');
      }
      if (!Array.isArray(payload.workflow.steps)) {
        return sendError(reply, 400, 'Invalid export: workflow.steps must be an array');
      }

      const requires = payload.requires ?? {};
      const compatibility = { compatible: true, gaps: {} as Record<string, string[]> };
      // Warn about missing integrations (informational — we don't block import)
      if (requires.integrations?.length) {
        compatibility.gaps.integrations = requires.integrations;
      }
      if (requires.tools?.length) {
        compatibility.gaps.tools = requires.tools;
      }
      compatibility.compatible = Object.keys(compatibility.gaps).length === 0;

      try {
        const definition = await workflowManager.createDefinition({
          name: payload.workflow.name,
          description: payload.workflow.description ?? '',
          steps: payload.workflow.steps ?? [],
          edges: payload.workflow.edges ?? [],
          triggers: payload.workflow.triggers ?? [],
          isEnabled: true,
          version: 1,
          createdBy: 'imported',
          autonomyLevel: payload.workflow.autonomyLevel ?? 'L2',
        });
        return reply.code(201).send({ definition, compatibility });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── Workflow Versioning (Phase 114) ──────────────────────────

  app.get(
    '/api/v1/workflows/:id/versions',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const { limit, offset } = parsePagination(request.query, { defaultLimit: 50 });
        return await workflowVersionManager.listVersions(request.params.id, { limit, offset });
      } catch (e) {
        return sendError(reply, 500, toErrorMessage(e));
      }
    }
  );

  app.get(
    '/api/v1/workflows/:id/versions/:idOrTag',
    async (
      request: FastifyRequest<{ Params: { id: string; idOrTag: string } }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const version = await workflowVersionManager.getVersion(
          request.params.id,
          request.params.idOrTag
        );
        if (!version) return sendError(reply, 404, 'Version not found');
        return version;
      } catch (e) {
        return sendError(reply, 500, toErrorMessage(e));
      }
    }
  );

  app.post(
    '/api/v1/workflows/:id/versions/tag',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { tag?: string } }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const tag = (request.body as any)?.tag;
        const version = await workflowVersionManager.tagRelease(
          request.params.id,
          tag || undefined
        );
        return await reply.code(201).send(version);
      } catch (e) {
        return sendError(reply, 400, toErrorMessage(e));
      }
    }
  );

  app.post(
    '/api/v1/workflows/:id/versions/:vId/rollback',
    async (
      request: FastifyRequest<{ Params: { id: string; vId: string } }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const version = await workflowVersionManager.rollback(
          request.params.id,
          request.params.vId
        );
        return version;
      } catch (e) {
        return sendError(reply, 400, toErrorMessage(e));
      }
    }
  );

  app.get(
    '/api/v1/workflows/:id/drift',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        return await workflowVersionManager.getDrift(request.params.id);
      } catch (e) {
        return sendError(reply, 500, toErrorMessage(e));
      }
    }
  );

  app.get(
    '/api/v1/workflows/:id/versions/:a/diff/:b',
    async (
      request: FastifyRequest<{ Params: { id: string; a: string; b: string } }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const diff = await workflowVersionManager.diffVersions(request.params.a, request.params.b);
        return { diff };
      } catch (e) {
        return sendError(reply, 500, toErrorMessage(e));
      }
    }
  );

  app.get(
    '/api/v1/workflows/:id/versions/:vId/export',
    async (
      request: FastifyRequest<{ Params: { id: string; vId: string } }>,
      reply: FastifyReply
    ) => {
      if (!workflowVersionManager) return sendError(reply, 501, 'Versioning not available');
      try {
        const version = await workflowVersionManager.getVersion(
          request.params.id,
          request.params.vId
        );
        if (!version) return sendError(reply, 404, 'Version not found');
        return {
          exportedAt: Date.now(),
          requires: {},
          workflow: version.snapshot,
          versionTag: version.versionTag,
        };
      } catch (e) {
        return sendError(reply, 500, toErrorMessage(e));
      }
    }
  );

  // ── Get a single workflow ─────────────────────────────────────

  app.get(
    '/api/v1/workflows/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const definition = await workflowManager.getDefinition(request.params.id);
      if (!definition) return sendError(reply, 404, 'Workflow not found');
      return { definition };
    }
  );

  app.put(
    '/api/v1/workflows/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Record<string, unknown>;
      }>,
      reply: FastifyReply
    ) => {
      // Capture previous level for escalation detection
      let prevLevel: string | undefined;
      try {
        const prev = await workflowManager.getDefinition(request.params.id);
        prevLevel = prev?.autonomyLevel;
      } catch {
        /* best-effort */
      }

      const definition = await workflowManager.updateDefinition(request.params.id, request.body);
      if (!definition) return sendError(reply, 404, 'Workflow not found');

      const warnings: string[] = [];
      const newLevel = (request.body as any).autonomyLevel;
      if (prevLevel && newLevel && newLevel !== prevLevel) {
        const levelNum = (l: string) => Number(l.replace('L', ''));
        if (levelNum(newLevel) > levelNum(prevLevel)) {
          warnings.push(
            `Autonomy escalated from ${prevLevel} to ${newLevel} — confirm this changes the human oversight level`
          );
        }
      }

      const response: { definition: typeof definition; warnings?: string[] } = { definition };
      if (warnings.length > 0) response.warnings = warnings;
      return response;
    }
  );

  app.delete(
    '/api/v1/workflows/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = await workflowManager.deleteDefinition(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Workflow not found');
      return reply.code(204).send();
    }
  );

  // ── Trigger a run ─────────────────────────────────────────────

  app.post(
    '/api/v1/workflows/:id/run',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { input?: Record<string, unknown>; triggeredBy?: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const run = await workflowManager.triggerRun(
          request.params.id,
          request.body?.input,
          request.body?.triggeredBy ?? 'manual'
        );
        return reply.code(202).send({ run });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  // ── List runs for a workflow ──────────────────────────────────

  app.get(
    '/api/v1/workflows/:id/runs',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Querystring: { limit?: string; offset?: string };
      }>,
      _reply: FastifyReply
    ) => {
      const { limit, offset } = parsePagination(request.query);
      return workflowManager.listRuns(request.params.id, { limit, offset });
    }
  );
}
