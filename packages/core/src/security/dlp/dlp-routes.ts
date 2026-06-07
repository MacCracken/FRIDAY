/**
 * DLP Routes — REST endpoints for Data Loss Prevention & Content Classification.
 */

import type { FastifyInstance } from 'fastify';
import type { ClassificationEngine } from './classification-engine.js';
import type { ClassificationStore } from './classification-store.js';
import type { DlpManager } from './dlp-manager.js';
import type { DlpPolicyStore } from './dlp-policy-store.js';
import type { WatermarkEngine, WatermarkAlgorithm } from './watermark-engine.js';
import type { WatermarkStore } from './watermark-store.js';
import type { EgressMonitor } from './egress-monitor.js';
import type { RetentionStore } from './retention-store.js';
import type { RetentionManager } from './retention-manager.js';
import type { ClassificationLevel } from './types.js';
import { sendError, toErrorMessage } from '../../utils/errors.js';
import type { SecureYeoman } from '../../secureyeoman.js';
import { licenseGuard } from '../../licensing/license-guard.js';

export interface DlpRouteDeps {
  classificationEngine: ClassificationEngine;
  classificationStore: ClassificationStore;
  dlpManager?: DlpManager;
  dlpPolicyStore?: DlpPolicyStore;
  watermarkEngine?: WatermarkEngine;
  watermarkStore?: WatermarkStore;
  egressMonitor?: EgressMonitor;
  retentionStore?: RetentionStore;
  retentionManager?: RetentionManager;
  secureYeoman?: SecureYeoman;
}

export function registerDlpRoutes(app: FastifyInstance, deps: DlpRouteDeps): void {
  const {
    classificationEngine,
    classificationStore,
    dlpManager,
    dlpPolicyStore,
    watermarkEngine,
    watermarkStore,
    egressMonitor,
    retentionStore,
    retentionManager,
    secureYeoman,
  } = deps;
  const featureGuardOpts = licenseGuard('dlp_security', secureYeoman);

  // ── POST /api/v1/security/dlp/classify ──────────────────────────────────

  app.post<{ Body: { text: string; contentId?: string; contentType?: string } }>(
    '/api/v1/security/dlp/classify',
    featureGuardOpts,
    async (req, reply) => {
      try {
        const { text, contentId, contentType } = req.body;
        if (!text && text !== '') {
          return sendError(reply, 400, 'Missing required field: text');
        }
        const result = classificationEngine.classify(text);

        if (contentId && contentType) {
          await classificationStore.create({
            contentId,
            contentType: contentType as
              | 'conversation'
              | 'document'
              | 'memory'
              | 'knowledge'
              | 'message',
            classificationLevel: result.level,
            autoLevel: result.autoLevel,
            manualOverride: false,
            overriddenBy: null,
            rulesTriggered: result.rulesTriggered,
            classifiedAt: Date.now(),
            tenantId: 'default',
          });
        }

        return reply.send({ classification: result });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  // ── GET /api/v1/security/dlp/classifications/:contentId ─────────────────

  app.get<{ Params: { contentId: string }; Querystring: { contentType?: string } }>(
    '/api/v1/security/dlp/classifications/:contentId',
    async (req, reply) => {
      try {
        const { contentId } = req.params;
        const contentType = req.query.contentType ?? 'message';
        const record = await classificationStore.getByContentId(contentId, contentType);
        return reply.send({ classification: record });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    }
  );

  // ── PUT /api/v1/security/dlp/classifications/:contentId ─────────────────

  app.put<{
    Params: { contentId: string };
    Body: { level: ClassificationLevel; contentType?: string };
  }>('/api/v1/security/dlp/classifications/:contentId', async (req, reply) => {
    try {
      const { contentId } = req.params;
      const { level, contentType } = req.body;
      if (!level) {
        return sendError(reply, 400, 'Missing required field: level');
      }
      const updated = await classificationStore.override(
        contentId,
        contentType ?? 'message',
        level,
        (req as any).authUser?.userId ?? 'system'
      );
      return reply.send({ updated: updated > 0 });
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── GET /api/v1/security/dlp/classifications ────────────────────────────

  app.get<{
    Querystring: {
      level?: ClassificationLevel;
      contentType?: string;
      limit?: string;
      offset?: string;
    };
  }>('/api/v1/security/dlp/classifications', async (req, reply) => {
    try {
      const query = req.query;
      const parsedLimit = query.limit ? parseInt(query.limit, 10) : undefined;
      const parsedOffset = query.offset ? parseInt(query.offset, 10) : undefined;
      const result = await classificationStore.list({
        level: query.level,
        contentType: query.contentType,
        limit: parsedLimit && !Number.isNaN(parsedLimit) ? parsedLimit : undefined,
        offset: parsedOffset && !Number.isNaN(parsedOffset) ? parsedOffset : undefined,
      });
      return reply.send(result);
    } catch (err) {
      return sendError(reply, 500, toErrorMessage(err));
    }
  });

  // ── Phase 136-B: Outbound Scanning & Policy Management ──────────────

  if (dlpManager && dlpPolicyStore) {
    // ── POST /api/v1/security/dlp/scan ──────────────────────────────────

    app.post<{
      Body: {
        content: string;
        destination: string;
        contentType?: string;
        userId?: string;
        personalityId?: string;
      };
    }>('/api/v1/security/dlp/scan', async (req, reply) => {
      try {
        const { content, destination, contentType, userId, personalityId } = req.body;
        if (!content) {
          return sendError(reply, 400, 'Missing required field: content');
        }
        if (!destination) {
          return sendError(reply, 400, 'Missing required field: destination');
        }
        const result = await dlpManager.scanOutbound(content, destination, {
          contentType,
          userId: userId ?? (req as any).authUser?.userId,
          personalityId,
        });
        return reply.send({ scan: result });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // ── POST /api/v1/security/dlp/policies ──────────────────────────────

    app.post<{
      Body: {
        name: string;
        description?: string;
        enabled?: boolean;
        rules: { type: string; value: string }[];
        action: 'block' | 'warn' | 'log';
        classificationLevels?: string[];
        appliesTo?: string[];
      };
    }>('/api/v1/security/dlp/policies', async (req, reply) => {
      try {
        const { name, description, enabled, rules, action, classificationLevels, appliesTo } =
          req.body;
        if (!name) {
          return sendError(reply, 400, 'Missing required field: name');
        }
        if (!rules || !Array.isArray(rules)) {
          return sendError(reply, 400, 'Missing required field: rules');
        }
        if (!action) {
          return sendError(reply, 400, 'Missing required field: action');
        }
        const id = await dlpPolicyStore.create({
          name,
          description: description ?? null,
          enabled: enabled ?? true,
          rules: rules as any,
          action,
          classificationLevels: (classificationLevels ?? [
            'confidential',
            'restricted',
          ]) as ClassificationLevel[],
          appliesTo: appliesTo ?? ['email', 'slack', 'webhook', 'api'],
          tenantId: 'default',
        });
        return reply.code(201).send({ id });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // ── GET /api/v1/security/dlp/policies ───────────────────────────────

    app.get<{
      Querystring: { active?: string; appliesTo?: string; limit?: string; offset?: string };
    }>('/api/v1/security/dlp/policies', async (req, reply) => {
      try {
        const query = req.query;
        const result = await dlpPolicyStore.list({
          active: query.active !== undefined ? query.active === 'true' : undefined,
          appliesTo: query.appliesTo,
          limit: query.limit ? parseInt(query.limit, 10) : undefined,
          offset: query.offset ? parseInt(query.offset, 10) : undefined,
        });
        return reply.send(result);
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // ── GET /api/v1/security/dlp/policies/:id ───────────────────────────

    app.get<{ Params: { id: string } }>('/api/v1/security/dlp/policies/:id', async (req, reply) => {
      try {
        const policy = await dlpPolicyStore.getById(req.params.id);
        if (!policy) {
          return sendError(reply, 404, 'Policy not found');
        }
        return reply.send({ policy });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // ── PUT /api/v1/security/dlp/policies/:id ───────────────────────────

    app.put<{
      Params: { id: string };
      Body: {
        name?: string;
        description?: string;
        enabled?: boolean;
        rules?: { type: string; value: string }[];
        action?: 'block' | 'warn' | 'log';
        classificationLevels?: string[];
        appliesTo?: string[];
      };
    }>('/api/v1/security/dlp/policies/:id', async (req, reply) => {
      try {
        const changes = req.body;
        const updated = await dlpPolicyStore.update(req.params.id, changes as any);
        return reply.send({ updated: updated > 0 });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // ── DELETE /api/v1/security/dlp/policies/:id ────────────────────────

    app.delete<{ Params: { id: string } }>(
      '/api/v1/security/dlp/policies/:id',
      async (req, reply) => {
        try {
          const deleted = await dlpPolicyStore.delete(req.params.id);
          return reply.send({ deleted: deleted > 0 });
        } catch (err) {
          return sendError(reply, 500, toErrorMessage(err));
        }
      }
    );
  }

  // ── Egress monitoring routes (Phase 136-F) ─────────────────────────

  if (egressMonitor) {
    // GET /api/v1/security/dlp/egress/stats?from=X&to=Y
    app.get<{
      Querystring: { from?: string; to?: string };
    }>('/api/v1/security/dlp/egress/stats', async (req, reply) => {
      try {
        const query = req.query;
        const from = query.from ? parseInt(query.from, 10) : Date.now() - 24 * 60 * 60 * 1000;
        const to = query.to ? parseInt(query.to, 10) : Date.now();
        const stats = await egressMonitor.getStats(from, to);
        return reply.send(stats);
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // GET /api/v1/security/dlp/egress/anomalies
    app.get('/api/v1/security/dlp/egress/anomalies', async (_req, reply) => {
      try {
        const anomalies = await egressMonitor.getAnomalies();
        return reply.send({ anomalies });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // GET /api/v1/security/dlp/egress/destinations
    app.get('/api/v1/security/dlp/egress/destinations', async (_req, reply) => {
      try {
        const destinations = await egressMonitor.getDestinations();
        return reply.send({ destinations });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });
  }

  // ── Watermark routes (Phase 136-E) ─────────────────────────────────

  if (watermarkEngine && watermarkStore) {
    // POST /api/v1/security/dlp/watermark/embed
    app.post<{
      Body: { text: string; contentId: string; userId?: string; algorithm?: WatermarkAlgorithm };
    }>('/api/v1/security/dlp/watermark/embed', async (req, reply) => {
      try {
        const { text, contentId, userId, algorithm } = req.body;
        if (!text && text !== '') {
          return sendError(reply, 400, 'Missing required field: text');
        }
        if (!contentId) {
          return sendError(reply, 400, 'Missing required field: contentId');
        }

        const engine = algorithm
          ? new (watermarkEngine.constructor as new (algo: WatermarkAlgorithm) => WatermarkEngine)(
              algorithm
            )
          : watermarkEngine;

        const resolvedUserId = userId ?? (req as any).authUser?.userId ?? 'system';
        const payload = {
          tenantId: 'default',
          userId: resolvedUserId,
          contentId,
          timestamp: Date.now(),
        };

        const watermarked = engine.embed(text, payload);

        // Record in store
        await watermarkStore.record({
          contentId,
          contentType: 'text',
          watermarkData: JSON.stringify(payload),
          algorithm: algorithm ?? engine.getAlgorithm(),
          createdAt: payload.timestamp,
          tenantId: 'default',
        });

        return reply.send({
          watermarked,
          contentId,
          algorithm: algorithm ?? engine.getAlgorithm(),
        });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // POST /api/v1/security/dlp/watermark/extract
    app.post<{ Body: { text: string; algorithm?: WatermarkAlgorithm } }>(
      '/api/v1/security/dlp/watermark/extract',
      async (req, reply) => {
        try {
          const { text, algorithm } = req.body;
          if (!text && text !== '') {
            return sendError(reply, 400, 'Missing required field: text');
          }

          const engine = algorithm
            ? new (watermarkEngine.constructor as new (
                algo: WatermarkAlgorithm
              ) => WatermarkEngine)(algorithm)
            : watermarkEngine;

          const payload = engine.extract(text);
          return reply.send({ found: payload !== null, payload });
        } catch (err) {
          return sendError(reply, 500, toErrorMessage(err));
        }
      }
    );

    // POST /api/v1/security/dlp/watermark/detect
    app.post<{ Body: { text: string; algorithm?: WatermarkAlgorithm } }>(
      '/api/v1/security/dlp/watermark/detect',
      async (req, reply) => {
        try {
          const { text, algorithm } = req.body;
          if (!text && text !== '') {
            return sendError(reply, 400, 'Missing required field: text');
          }

          const engine = algorithm
            ? new (watermarkEngine.constructor as new (
                algo: WatermarkAlgorithm
              ) => WatermarkEngine)(algorithm)
            : watermarkEngine;

          const detected = engine.detect(text);
          return reply.send({ detected });
        } catch (err) {
          return sendError(reply, 500, toErrorMessage(err));
        }
      }
    );
  }

  // ── Retention policy routes (Phase 136-D) ────────────────────────────

  if (retentionStore && retentionManager) {
    // POST /api/v1/security/dlp/retention
    app.post<{
      Body: {
        contentType: string;
        retentionDays: number;
        classificationLevel?: ClassificationLevel;
        enabled?: boolean;
      };
    }>('/api/v1/security/dlp/retention', async (req, reply) => {
      try {
        const { contentType, retentionDays, classificationLevel, enabled } = req.body;
        if (!contentType) {
          return sendError(reply, 400, 'Missing required field: contentType');
        }
        if (!retentionDays || retentionDays <= 0) {
          return sendError(reply, 400, 'retentionDays must be a positive number');
        }
        const id = await retentionStore.create({
          contentType: contentType as any,
          retentionDays,
          classificationLevel: classificationLevel ?? null,
          enabled: enabled ?? true,
          lastPurgeAt: null,
          tenantId: 'default',
        });
        return reply.code(201).send({ id });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // GET /api/v1/security/dlp/retention
    app.get('/api/v1/security/dlp/retention', async (_req, reply) => {
      try {
        const policies = await retentionStore.list();
        return reply.send({ policies });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // PUT /api/v1/security/dlp/retention/:id
    app.put<{
      Params: { id: string };
      Body: {
        retentionDays?: number;
        enabled?: boolean;
        classificationLevel?: ClassificationLevel;
      };
    }>('/api/v1/security/dlp/retention/:id', async (req, reply) => {
      try {
        const updated = await retentionStore.update(req.params.id, req.body);
        return reply.send({ updated: updated > 0 });
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });

    // DELETE /api/v1/security/dlp/retention/:id
    app.delete<{ Params: { id: string } }>(
      '/api/v1/security/dlp/retention/:id',
      async (req, reply) => {
        try {
          const deleted = await retentionStore.delete(req.params.id);
          return reply.send({ deleted: deleted > 0 });
        } catch (err) {
          return sendError(reply, 500, toErrorMessage(err));
        }
      }
    );

    // POST /api/v1/security/dlp/retention/preview
    app.post('/api/v1/security/dlp/retention/preview', async (_req, reply) => {
      try {
        const preview = await retentionManager.preview();
        return reply.send(preview);
      } catch (err) {
        return sendError(reply, 500, toErrorMessage(err));
      }
    });
  }
}
