/**
 * Training Routes — Export conversation and memory data as structured training datasets.
 *
 * Supported output formats:
 *   sharegpt    — ShareGPT JSONL (recommended for chat fine-tuning)
 *   instruction — Alpaca-style instruction JSONL
 *   raw         — Plain text corpus (one conversation per block)
 *
 * Also provides distillation and fine-tuning job management (Phase 64).
 *
 * All exports stream line-by-line to avoid buffering large datasets in memory.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { SecureYeoman } from '../secureyeoman.js';
import { sendError, toErrorMessage } from '../utils/errors.js';
import type { DistillationJobConfig, TeacherClient } from './distillation-manager.js';
import type { FinetuneJobConfig } from './finetune-manager.js';
import type { AIMessage } from '@secureyeoman/shared';
import { trainingStream } from './training-stream.js';
import type { ListEpisodesOptions } from './computer-use-manager.js';
import type { EvalDatasetCreate } from '@secureyeoman/shared';
import type {
  PreferencePairCreate,
  CurationRules,
  TrainingExperimentCreate,
  SideBySideRating,
} from '@secureyeoman/shared';
import { licenseGuard } from '../licensing/license-guard.js';
import { parsePagination } from '../utils/pagination.js';

export interface TrainingRoutesOptions {
  secureYeoman: SecureYeoman;
}

type ExportFormat = 'sharegpt' | 'instruction' | 'raw';

interface ExportBody {
  format?: ExportFormat | 'computer_use';
  from?: number;
  to?: number;
  personalityIds?: string[];
  includeMemories?: boolean;
  includeKnowledge?: boolean;
  limit?: number;
}

// ── Format helpers ─────────────────────────────────────────────────────────

interface ShareGptMessage {
  from: 'human' | 'gpt' | 'system';
  value: string;
}

function toShareGpt(
  conversationId: string,
  personalityId: string | null,
  messages: { role: string; content: string }[]
): string {
  const converted: ShareGptMessage[] = messages.map((m) => ({
    from: m.role === 'user' ? 'human' : 'gpt',
    value: m.content,
  }));
  return (
    JSON.stringify({
      id: conversationId,
      personality_id: personalityId,
      conversations: converted,
    }) + '\n'
  );
}

function toInstruction(
  messages: { role: string; content: string }[],
  personalityId: string | null
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const cur = messages[i]!;
    const next = messages[i + 1]!;
    if (cur.role === 'user' && next.role === 'assistant') {
      lines.push(
        JSON.stringify({
          instruction: cur.content,
          output: next.content,
          personality_id: personalityId,
        }) + '\n'
      );
      i++; // consume the pair
    }
  }
  return lines;
}

function toRawText(conversationId: string, messages: { role: string; content: string }[]): string {
  const parts = [`=== Conversation ${conversationId} ===`];
  for (const m of messages) {
    parts.push(`[${m.role.toUpperCase()}]: ${m.content}`);
  }
  return parts.join('\n') + '\n\n';
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerTrainingRoutes(app: FastifyInstance, opts: TrainingRoutesOptions): void {
  const { secureYeoman } = opts;
  const adaptiveLearningGuardOpts = licenseGuard('adaptive_learning', secureYeoman);

  /**
   * POST /api/v1/training/export
   * Streams a training dataset as JSONL or plain text.
   */
  app.post(
    '/api/v1/training/export',
    async (request: FastifyRequest<{ Body: ExportBody }>, reply: FastifyReply) => {
      const body = request.body ?? {};

      // Computer-use export — delegate to ComputerUseManager
      if (body.format === 'computer_use') {
        const cuManager = secureYeoman.getComputerUseManager();
        if (!cuManager) return sendError(reply, 503, 'Computer-use manager not available');

        const filename = `computer-use-export-${new Date().toISOString().slice(0, 10)}.jsonl`;
        reply.raw.setHeader('Content-Type', 'application/x-ndjson');
        reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        reply.raw.writeHead(200);

        try {
          for await (const line of cuManager.exportEpisodes('computer_use')) {
            reply.raw.write(line);
          }
        } catch (err) {
          const msg = toErrorMessage(err);
          reply.raw.write(`{"error":${JSON.stringify(msg)}}\n`);
        }
        reply.raw.end();
        return reply;
      }

      const conversationStorage = secureYeoman.getConversationStorage();
      if (!conversationStorage) {
        return sendError(reply, 503, 'Conversation storage not available');
      }

      const format: ExportFormat = body.format ?? 'sharegpt';
      const from = body.from;
      const to = body.to;
      const personalityIds = body.personalityIds;
      const cap = Math.min(body.limit ?? 10_000, 100_000);

      if (!['sharegpt', 'instruction', 'raw'].includes(format)) {
        return sendError(reply, 400, 'format must be sharegpt, instruction, or raw');
      }

      const contentType = format === 'raw' ? 'text/plain; charset=utf-8' : 'application/x-ndjson';
      const ext = format === 'raw' ? 'txt' : 'jsonl';
      const filename = `training-export-${new Date().toISOString().slice(0, 10)}.${ext}`;

      reply.raw.setHeader('Content-Type', contentType);
      reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      reply.raw.writeHead(200);

      let exported = 0;
      let offset = 0;
      const BATCH = 50;

      try {
        while (exported < cap) {
          // Fetch a batch of conversations
          const targets = personalityIds?.length ? personalityIds : [undefined];

          for (const pid of targets) {
            if (exported >= cap) break;

            const { conversations } = await conversationStorage.listConversations({
              limit: BATCH,
              offset,
              ...(pid !== undefined ? { personalityId: pid } : {}),
            });

            if (conversations.length === 0) break;

            for (const conv of conversations) {
              if (exported >= cap) break;

              // Filter by date range if specified
              if (from !== undefined && conv.createdAt < from) continue;
              if (to !== undefined && conv.createdAt > to) continue;

              const messages = await conversationStorage.getMessages(conv.id, {
                limit: 1000,
              });

              if (messages.length < 2) continue; // skip single-message conversations

              const plainMessages = messages.map((m) => ({
                role: m.role,
                content: m.content,
              }));

              if (format === 'sharegpt') {
                reply.raw.write(toShareGpt(conv.id, conv.personalityId, plainMessages));
              } else if (format === 'instruction') {
                const lines = toInstruction(plainMessages, conv.personalityId);
                for (const line of lines) {
                  reply.raw.write(line);
                }
              } else {
                reply.raw.write(toRawText(conv.id, plainMessages));
              }

              exported++;
            }

            offset += BATCH;
          }

          // If single personality or no pid, check if we got fewer than BATCH (end of results)
          if (!personalityIds?.length) {
            const { conversations: check } = await conversationStorage.listConversations({
              limit: 1,
              offset,
            });
            if (check.length === 0) break;
          } else {
            break; // personalityIds loop already exhausted
          }
        }
      } catch (err) {
        // Best-effort: stream an error marker and end
        const msg = toErrorMessage(err);
        reply.raw.write(`{"error":${JSON.stringify(msg)}}\n`);
      }

      reply.raw.end();
      return reply;
    }
  );

  /**
   * GET /api/v1/training/stats
   * Returns row counts useful for estimating export size.
   */
  app.get('/api/v1/training/stats', async (_request, reply: FastifyReply) => {
    const conversationStorage = secureYeoman.getConversationStorage();
    if (!conversationStorage) {
      return sendError(reply, 503, 'Conversation storage not available');
    }

    const { total: conversations } = await conversationStorage.listConversations({ limit: 1 });

    let memories = 0;
    let knowledge = 0;
    try {
      const brainManager = secureYeoman.getBrainManager();
      const stats = await brainManager.getStats();
      memories = (stats.memories as { total?: number })?.total ?? 0;
      knowledge = (stats.knowledge as { total?: number })?.total ?? 0;
    } catch {
      /* non-fatal — brain may not be initialized */
    }

    return { conversations, memories, knowledge };
  });

  // ── Distillation endpoints ────────────────────────────────────────────────

  /**
   * POST /api/v1/training/distillation/jobs
   * Create a new distillation job.
   */
  app.post(
    '/api/v1/training/distillation/jobs',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Body: DistillationJobConfig }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDistillationManager();
      if (!manager) return sendError(reply, 503, 'Distillation manager not available');

      const body = request.body;
      if (!body.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body.teacherProvider?.trim())
        return sendError(reply, 400, 'teacherProvider is required');
      if (!body.teacherModel?.trim()) return sendError(reply, 400, 'teacherModel is required');
      if (!body.outputPath?.trim()) return sendError(reply, 400, 'outputPath is required');

      const job = await manager.createJob(body);
      return reply.code(201).send(job);
    }
  );

  /**
   * GET /api/v1/training/distillation/jobs
   * List all distillation jobs.
   */
  app.get('/api/v1/training/distillation/jobs', async (_request, reply: FastifyReply) => {
    const manager = secureYeoman.getDistillationManager();
    if (!manager) return sendError(reply, 503, 'Distillation manager not available');

    const jobs = await manager.listJobs();
    return { jobs };
  });

  /**
   * GET /api/v1/training/distillation/jobs/:id
   * Get a specific distillation job.
   */
  app.get(
    '/api/v1/training/distillation/jobs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDistillationManager();
      if (!manager) return sendError(reply, 503, 'Distillation manager not available');

      const job = await manager.getJob(request.params.id);
      if (!job) return sendError(reply, 404, 'Job not found');
      return job;
    }
  );

  /**
   * DELETE /api/v1/training/distillation/jobs/:id
   * Cancel and delete a distillation job.
   */
  app.delete(
    '/api/v1/training/distillation/jobs/:id',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDistillationManager();
      if (!manager) return sendError(reply, 503, 'Distillation manager not available');

      const deleted = await manager.deleteJob(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Job not found');
      return reply.code(204).send();
    }
  );

  /**
   * POST /api/v1/training/distillation/jobs/:id/run
   * Start (or retry) a pending or failed distillation job in the background.
   * Returns 202 immediately; caller polls GET .../jobs/:id for status.
   */
  app.post(
    '/api/v1/training/distillation/jobs/:id/run',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { secureYeoman } = opts;
      const manager = secureYeoman.getDistillationManager();
      if (!manager) return sendError(reply, 503, 'Distillation manager not available');

      const conversationStorage = secureYeoman.getConversationStorage();
      if (!conversationStorage) return sendError(reply, 503, 'Conversation storage not available');

      let aiClient: ReturnType<typeof secureYeoman.getAIClient>;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        return sendError(reply, 503, 'AI client not available');
      }

      const job = await manager.getJob(request.params.id);
      if (!job) return sendError(reply, 404, 'Job not found');
      if (manager.isRunning(job.id)) return sendError(reply, 409, 'Job is already running');
      if (job.status !== 'pending' && job.status !== 'failed') {
        return sendError(reply, 409, `Job cannot be run in status '${job.status}'`);
      }

      const { teacherModel } = job;
      const teacherClient: TeacherClient = {
        async chat(req) {
          const response = await aiClient.chat({
            messages: req.messages as AIMessage[],
            model: teacherModel,
            stream: false,
          });
          return { content: response.content };
        },
      };

      // Fire and forget — client polls GET .../jobs/:id for status updates
      void manager.runJob(job.id, conversationStorage, teacherClient);

      return reply.code(202).send({ id: job.id, status: 'running' });
    }
  );

  // ── Fine-tuning endpoints ─────────────────────────────────────────────────

  /**
   * POST /api/v1/training/finetune/jobs
   * Create a new fine-tuning job.
   */
  app.post(
    '/api/v1/training/finetune/jobs',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Body: FinetuneJobConfig }>, reply: FastifyReply) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const body = request.body;
      if (!body.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body.baseModel?.trim()) return sendError(reply, 400, 'baseModel is required');
      if (!body.adapterName?.trim()) return sendError(reply, 400, 'adapterName is required');
      if (!body.datasetPath?.trim()) return sendError(reply, 400, 'datasetPath is required');

      const job = await manager.createJob(body);

      // Start the Docker container
      try {
        await manager.startJob(job.id);
      } catch (err) {
        // Non-fatal: job is created, Docker may not be available in dev
        const msg = toErrorMessage(err);
        return reply.code(201).send({ ...job, startError: msg });
      }

      const started = await manager.getJob(job.id);
      return reply.code(201).send(started ?? job);
    }
  );

  /**
   * GET /api/v1/training/finetune/jobs
   * List all fine-tuning jobs.
   */
  app.get('/api/v1/training/finetune/jobs', async (_request, reply: FastifyReply) => {
    const manager = secureYeoman.getFinetuneManager();
    if (!manager) return sendError(reply, 503, 'Finetune manager not available');

    const jobs = await manager.listJobs();
    return { jobs };
  });

  /**
   * GET /api/v1/training/finetune/jobs/:id
   * Get a specific fine-tuning job.
   */
  app.get(
    '/api/v1/training/finetune/jobs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const job = await manager.getJob(request.params.id);
      if (!job) return sendError(reply, 404, 'Job not found');
      return job;
    }
  );

  /**
   * GET /api/v1/training/finetune/jobs/:id/logs
   * SSE stream of Docker container logs.
   */
  app.get(
    '/api/v1/training/finetune/jobs/:id/logs',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const job = await manager.getJob(request.params.id);
      if (!job) return sendError(reply, 404, 'Job not found');

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        for await (const line of manager.streamLogs(request.params.id)) {
          reply.raw.write(`data: ${JSON.stringify({ log: line })}\n\n`);
        }
      } catch (err) {
        const msg = toErrorMessage(err);
        reply.raw.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      }

      reply.raw.end();
      return reply;
    }
  );

  /**
   * POST /api/v1/training/finetune/jobs/:id/register
   * Register a completed adapter with Ollama.
   */
  app.post(
    '/api/v1/training/finetune/jobs/:id/register',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const job = await manager.getJob(request.params.id);
      if (!job) return sendError(reply, 404, 'Job not found');
      if (job.status !== 'complete') {
        return sendError(reply, 400, `Job is not complete (status=${job.status})`);
      }

      const ollamaBaseUrl = 'http://localhost:11434';
      await manager.registerWithOllama(request.params.id, ollamaBaseUrl);
      return { success: true, adapterName: job.adapterName };
    }
  );

  /**
   * DELETE /api/v1/training/finetune/jobs/:id
   * Cancel and delete a fine-tuning job.
   */
  app.delete(
    '/api/v1/training/finetune/jobs/:id',
    adaptiveLearningGuardOpts,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const deleted = await manager.deleteJob(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Job not found');
      return reply.code(204).send();
    }
  );

  // ── Human Approval endpoints (Phase 73) ───────────────────────────────────

  /**
   * GET /api/v1/training/approvals
   * List approval requests. Pass ?status=pending to filter.
   */
  app.get(
    '/api/v1/training/approvals',
    async (
      request: FastifyRequest<{ Querystring: { runId?: string; status?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getPipelineApprovalManager();
      if (!manager) return sendError(reply, 503, 'Approval manager not available');

      const { runId, status } = request.query;
      const requests =
        status === 'pending' ? await manager.listPending() : await manager.listAll(runId);
      return { requests };
    }
  );

  /**
   * GET /api/v1/training/approvals/:id
   * Get a specific approval request.
   */
  app.get(
    '/api/v1/training/approvals/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getPipelineApprovalManager();
      if (!manager) return sendError(reply, 503, 'Approval manager not available');

      const req = await manager.getRequest(request.params.id);
      if (!req) return sendError(reply, 404, 'Approval request not found');
      return req;
    }
  );

  /**
   * POST /api/v1/training/approvals/:id/approve
   * Approve a pending human approval request.
   */
  app.post(
    '/api/v1/training/approvals/:id/approve',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getPipelineApprovalManager();
      if (!manager) return sendError(reply, 503, 'Approval manager not available');

      const body = request.body ?? {};
      const ok = await manager.approve(request.params.id, undefined, body.reason);
      if (!ok) return sendError(reply, 404, 'Approval request not found or already decided');
      return { approved: true };
    }
  );

  /**
   * POST /api/v1/training/approvals/:id/reject
   * Reject a pending human approval request.
   */
  app.post(
    '/api/v1/training/approvals/:id/reject',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { reason?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getPipelineApprovalManager();
      if (!manager) return sendError(reply, 503, 'Approval manager not available');

      const body = request.body ?? {};
      const ok = await manager.reject(request.params.id, undefined, body.reason);
      if (!ok) return sendError(reply, 404, 'Approval request not found or already decided');
      return { rejected: true };
    }
  );

  // ── Pipeline Lineage endpoints (Phase 73) ─────────────────────────────────

  /**
   * GET /api/v1/training/lineage
   * List recent pipeline lineage records (most recent first).
   */
  app.get('/api/v1/training/lineage', async (_request, reply: FastifyReply) => {
    const lineage = secureYeoman.getPipelineLineageStorage();
    if (!lineage) return sendError(reply, 503, 'Pipeline lineage storage not available');

    const records = await lineage.list(50);
    return { records };
  });

  /**
   * GET /api/v1/training/lineage/:runId
   * Get lineage record for a specific workflow run.
   */
  app.get(
    '/api/v1/training/lineage/:runId',
    async (request: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const lineage = secureYeoman.getPipelineLineageStorage();
      if (!lineage) return sendError(reply, 503, 'Pipeline lineage storage not available');

      const record = await lineage.getByRunId(request.params.runId);
      if (!record) return sendError(reply, 404, 'Lineage record not found');
      return record;
    }
  );

  // ── Phase 92: SSE training stream ─────────────────────────────────────────

  /**
   * GET /api/v1/training/stream
   * SSE endpoint streaming live training telemetry events.
   */
  app.get('/api/v1/training/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    function onEvent(event: unknown) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    trainingStream.on('event', onEvent);

    request.socket.on('close', () => {
      trainingStream.off('event', onEvent);
    });

    // Keep connection open — the client will close it
    await new Promise<void>((resolve) => {
      request.socket.on('close', resolve);
      request.socket.on('error', resolve);
    });

    return reply;
  });

  // ── Phase 92: Conversation quality endpoints ───────────────────────────────

  /**
   * GET /api/v1/training/quality
   * Return quality scores for conversations.
   */
  app.get(
    '/api/v1/training/quality',
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      const scorer = secureYeoman.getConversationQualityScorer();
      if (!scorer) return sendError(reply, 503, 'Quality scorer not available');

      const pool = secureYeoman.getPool?.();
      if (!pool) return sendError(reply, 503, 'Database pool not available');

      const { limit } = parsePagination(request.query, { maxLimit: 1000, defaultLimit: 100 });
      const { rows } = await pool.query<Record<string, unknown>>(
        `SELECT conversation_id, quality_score, signal_source, scored_at
         FROM   training.conversation_quality
         ORDER  BY quality_score ASC
         LIMIT  $1`,
        [limit]
      );

      return {
        conversations: rows.map((r) => ({
          conversationId: r.conversation_id,
          qualityScore: r.quality_score,
          signalSource: r.signal_source,
          scoredAt: r.scored_at instanceof Date ? r.scored_at.toISOString() : String(r.scored_at),
        })),
      };
    }
  );

  /**
   * POST /api/v1/training/quality/score
   * Manually trigger a scoring run for unscored conversations.
   */
  app.post(
    '/api/v1/training/quality/score',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const scorer = secureYeoman.getConversationQualityScorer();
      if (!scorer) return sendError(reply, 503, 'Quality scorer not available');

      const pool = secureYeoman.getPool?.();
      if (!pool) return sendError(reply, 503, 'Database pool not available');

      const scored = await scorer.scoreNewConversations(pool);
      return { scored };
    }
  );

  // ── Phase 92: Computer-use episode endpoints ───────────────────────────────

  /**
   * POST /api/v1/training/computer-use/episodes
   * Record a new computer-use episode.
   */
  app.post(
    '/api/v1/training/computer-use/episodes',
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const manager = secureYeoman.getComputerUseManager();
      if (!manager) return sendError(reply, 503, 'Computer-use manager not available');

      const body = request.body ?? {};
      if (!body.sessionId || typeof body.sessionId !== 'string')
        return sendError(reply, 400, 'sessionId is required');
      if (!body.skillName || typeof body.skillName !== 'string')
        return sendError(reply, 400, 'skillName is required');
      if (!body.actionType || typeof body.actionType !== 'string')
        return sendError(reply, 400, 'actionType is required');

      const ep = await manager.recordEpisode({
        sessionId: body.sessionId,
        skillName: body.skillName,
        stateEncoding: (body.stateEncoding as Record<string, unknown>) ?? {},
        actionType: body.actionType,
        actionTarget: (body.actionTarget as string) ?? '',
        actionValue: (body.actionValue as string) ?? '',
        reward: typeof body.reward === 'number' ? body.reward : 0,
        done: body.done === true,
      });

      // Broadcast reward event to training stream
      trainingStream.broadcast({ type: 'reward', value: ep.reward, ts: Date.now() });

      return reply.code(201).send(ep);
    }
  );

  /**
   * GET /api/v1/training/computer-use/episodes
   * List computer-use episodes with optional filters.
   */
  app.get(
    '/api/v1/training/computer-use/episodes',
    async (
      request: FastifyRequest<{
        Querystring: { skillName?: string; sessionId?: string; limit?: string };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getComputerUseManager();
      if (!manager) return sendError(reply, 503, 'Computer-use manager not available');

      const { limit } = parsePagination(request.query, { defaultLimit: 100 });
      const opts: ListEpisodesOptions = {
        skillName: request.query.skillName,
        sessionId: request.query.sessionId,
        limit,
      };

      const episodes = await manager.listEpisodes(opts);
      return { episodes };
    }
  );

  /**
   * GET /api/v1/training/computer-use/stats
   * Skill breakdown and session totals.
   */
  app.get(
    '/api/v1/training/computer-use/stats',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const manager = secureYeoman.getComputerUseManager();
      if (!manager) return sendError(reply, 503, 'Computer-use manager not available');

      const skillBreakdown = await manager.getSkillBreakdown();
      const totalEpisodes = skillBreakdown.reduce((s, r) => s + r.episodeCount, 0);
      const avgReward =
        totalEpisodes > 0
          ? skillBreakdown.reduce((s, r) => s + r.avgReward * r.episodeCount, 0) / totalEpisodes
          : 0;

      return { skillBreakdown, totals: { totalEpisodes, avgReward } };
    }
  );

  /**
   * DELETE /api/v1/training/computer-use/episodes/:id
   * Delete a computer-use episode.
   */
  app.delete(
    '/api/v1/training/computer-use/episodes/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getComputerUseManager();
      if (!manager) return sendError(reply, 503, 'Computer-use manager not available');

      const deleted = await manager.deleteEpisode(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Episode not found');
      return reply.code(204).send();
    }
  );

  // ── Phase 97: LLM-as-Judge endpoints ──────────────────────────────────────

  /**
   * POST /api/v1/training/judge/datasets
   * Create an eval dataset.
   */
  app.post(
    '/api/v1/training/judge/datasets',
    async (request: FastifyRequest<{ Body: EvalDatasetCreate }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const body = request.body;
      if (!body?.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body?.samples?.length) return sendError(reply, 400, 'samples must be a non-empty array');

      const dataset = await manager.createDataset(body);
      return reply.code(201).send(dataset);
    }
  );

  /**
   * GET /api/v1/training/judge/datasets
   * List eval datasets.
   */
  app.get(
    '/api/v1/training/judge/datasets',
    async (
      request: FastifyRequest<{ Querystring: { personalityId?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const datasets = await manager.listDatasets({
        personalityId: request.query.personalityId,
      });
      return { datasets };
    }
  );

  /**
   * GET /api/v1/training/judge/datasets/:id
   * Get a specific eval dataset.
   */
  app.get(
    '/api/v1/training/judge/datasets/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const dataset = await manager.getDataset(request.params.id);
      if (!dataset) return sendError(reply, 404, 'Dataset not found');
      return dataset;
    }
  );

  /**
   * DELETE /api/v1/training/judge/datasets/:id
   * Delete an eval dataset.
   */
  app.delete(
    '/api/v1/training/judge/datasets/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const deleted = await manager.deleteDataset(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Dataset not found');
      return reply.code(204).send();
    }
  );

  /**
   * POST /api/v1/training/judge/pointwise
   * Trigger a pointwise eval (202 async).
   */
  app.post(
    '/api/v1/training/judge/pointwise',
    async (
      request: FastifyRequest<{
        Body: { datasetId: string; modelName: string; finetuneJobId?: string; maxSamples?: number };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const body = request.body;
      if (!body?.datasetId) return sendError(reply, 400, 'datasetId is required');
      if (!body?.modelName) return sendError(reply, 400, 'modelName is required');

      let aiClient: ReturnType<typeof secureYeoman.getAIClient>;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        return sendError(reply, 503, 'AI client not available');
      }

      // Fire and forget — client polls GET /runs for results
      void manager.runPointwiseEval({
        datasetId: body.datasetId,
        modelName: body.modelName,
        finetuneJobId: body.finetuneJobId,
        maxSamples: body.maxSamples,
        modelFn: async (prompt) => {
          const response = await aiClient.chat({
            messages: [{ role: 'user', content: prompt }],
            model: body.modelName,
            stream: false,
          });
          return response.content;
        },
      });

      return reply.code(202).send({ status: 'started', modelName: body.modelName });
    }
  );

  /**
   * GET /api/v1/training/judge/runs
   * List eval run summaries.
   */
  app.get('/api/v1/training/judge/runs', async (_request, reply: FastifyReply) => {
    const manager = secureYeoman.getLlmJudgeManager();
    if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

    const runs = await manager.listEvalRuns();
    return { runs };
  });

  /**
   * GET /api/v1/training/judge/runs/:id
   * Get scores for a specific eval run.
   */
  app.get(
    '/api/v1/training/judge/runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const scores = await manager.getEvalRunScores(request.params.id);
      return { scores };
    }
  );

  /**
   * DELETE /api/v1/training/judge/runs/:id
   * Delete an eval run and its scores.
   */
  app.delete(
    '/api/v1/training/judge/runs/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const deleted = await manager.deleteEvalRun(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Eval run not found');
      return reply.code(204).send();
    }
  );

  /**
   * POST /api/v1/training/judge/pairwise
   * Trigger a pairwise comparison (202 async).
   */
  app.post(
    '/api/v1/training/judge/pairwise',
    async (
      request: FastifyRequest<{
        Body: { datasetId: string; modelA: string; modelB: string; maxSamples?: number };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const body = request.body;
      if (!body?.datasetId) return sendError(reply, 400, 'datasetId is required');
      if (!body?.modelA) return sendError(reply, 400, 'modelA is required');
      if (!body?.modelB) return sendError(reply, 400, 'modelB is required');

      let aiClient: ReturnType<typeof secureYeoman.getAIClient>;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        return sendError(reply, 503, 'AI client not available');
      }

      // Fire and forget — client polls GET /comparisons for results
      void manager.runPairwiseComparison({
        datasetId: body.datasetId,
        modelA: body.modelA,
        modelB: body.modelB,
        maxSamples: body.maxSamples,
        modelFnA: async (prompt) => {
          const response = await aiClient.chat({
            messages: [{ role: 'user', content: prompt }],
            model: body.modelA,
            stream: false,
          });
          return response.content;
        },
        modelFnB: async (prompt) => {
          const response = await aiClient.chat({
            messages: [{ role: 'user', content: prompt }],
            model: body.modelB,
            stream: false,
          });
          return response.content;
        },
      });

      return reply
        .status(202)
        .send({ status: 'started', modelA: body.modelA, modelB: body.modelB });
    }
  );

  /**
   * GET /api/v1/training/judge/comparisons
   * List pairwise comparison summaries.
   */
  app.get('/api/v1/training/judge/comparisons', async (_request, reply: FastifyReply) => {
    const manager = secureYeoman.getLlmJudgeManager();
    if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

    const comparisons = await manager.listComparisons();
    return { comparisons };
  });

  /**
   * GET /api/v1/training/judge/comparisons/:id
   * Get details for a specific pairwise comparison.
   */
  app.get(
    '/api/v1/training/judge/comparisons/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const results = await manager.getComparisonDetails(request.params.id);
      return { results };
    }
  );

  /**
   * POST /api/v1/training/judge/auto-eval
   * Configure/trigger auto-eval for a model.
   */
  app.post(
    '/api/v1/training/judge/auto-eval',
    async (
      request: FastifyRequest<{
        Body: {
          datasetId: string;
          modelName: string;
          finetuneJobId?: string;
          thresholds?: { groundedness?: number; coherence?: number };
        };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getLlmJudgeManager();
      if (!manager) return sendError(reply, 503, 'LLM Judge manager not available');

      const body = request.body;
      if (!body?.datasetId) return sendError(reply, 400, 'datasetId is required');
      if (!body?.modelName) return sendError(reply, 400, 'modelName is required');

      let aiClient: ReturnType<typeof secureYeoman.getAIClient>;
      try {
        aiClient = secureYeoman.getAIClient();
      } catch {
        return sendError(reply, 503, 'AI client not available');
      }

      const result = await manager.runAutoEval({
        enabled: true,
        datasetId: body.datasetId,
        thresholds: {
          groundedness: body.thresholds?.groundedness ?? 3.0,
          coherence: body.thresholds?.coherence ?? 3.0,
        },
        modelName: body.modelName,
        finetuneJobId: body.finetuneJobId,
        modelFn: async (prompt) => {
          const response = await aiClient.chat({
            messages: [{ role: 'user', content: prompt }],
            model: body.modelName,
            stream: false,
          });
          return response.content;
        },
      });

      return {
        passed: result.passed,
        summary: result.summary,
        failedDimensions: result.failedDimensions,
      };
    }
  );

  // ── Phase 98: Preference Annotation endpoints ───────────────────────────

  app.post(
    '/api/v1/training/preferences',
    async (request: FastifyRequest<{ Body: PreferencePairCreate }>, reply: FastifyReply) => {
      const manager = secureYeoman.getPreferenceManager();
      if (!manager) return sendError(reply, 503, 'Preference manager not available');

      const body = request.body;
      if (!body?.prompt?.trim()) return sendError(reply, 400, 'prompt is required');
      if (!body?.chosen?.trim()) return sendError(reply, 400, 'chosen is required');
      if (!body?.rejected?.trim()) return sendError(reply, 400, 'rejected is required');
      if (!body?.source) return sendError(reply, 400, 'source is required');

      const pair = await manager.recordAnnotation(body);
      return reply.code(201).send(pair);
    }
  );

  app.get(
    '/api/v1/training/preferences',
    async (
      request: FastifyRequest<{
        Querystring: { personalityId?: string; source?: string; limit?: string; offset?: string };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getPreferenceManager();
      if (!manager) return sendError(reply, 503, 'Preference manager not available');

      const { limit, offset } = parsePagination(request.query);
      const pairs = await manager.listAnnotations({
        personalityId: request.query.personalityId,
        source: request.query.source as 'annotation' | 'comparison' | 'multi_turn' | undefined,
        limit,
        offset,
      });
      return { pairs };
    }
  );

  app.delete(
    '/api/v1/training/preferences/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getPreferenceManager();
      if (!manager) return sendError(reply, 503, 'Preference manager not available');

      const deleted = await manager.deleteAnnotation(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Preference pair not found');
      return reply.code(204).send();
    }
  );

  app.post(
    '/api/v1/training/preferences/export',
    async (
      request: FastifyRequest<{ Body: { personalityId?: string; source?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getPreferenceManager();
      if (!manager) return sendError(reply, 503, 'Preference manager not available');

      const body = request.body ?? {};
      const filename = `dpo-export-${new Date().toISOString().slice(0, 10)}.jsonl`;
      reply.raw.setHeader('Content-Type', 'application/x-ndjson');
      reply.raw.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      reply.raw.writeHead(200);

      try {
        for await (const line of manager.exportAsDpo({
          personalityId: body.personalityId,
          source: body.source as 'annotation' | 'comparison' | 'multi_turn' | undefined,
        })) {
          reply.raw.write(line);
        }
      } catch (err) {
        const msg = toErrorMessage(err);
        reply.raw.write(`{"error":${JSON.stringify(msg)}}\n`);
      }

      reply.raw.end();
      return reply;
    }
  );

  // ── Phase 98: Dataset Curation endpoints ────────────────────────────────

  app.post(
    '/api/v1/training/curated-datasets/preview',
    async (request: FastifyRequest<{ Body: CurationRules }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDatasetCuratorManager();
      if (!manager) return sendError(reply, 503, 'Dataset curator not available');

      const preview = await manager.previewDataset(request.body ?? {});
      return preview;
    }
  );

  app.post(
    '/api/v1/training/curated-datasets',
    async (
      request: FastifyRequest<{
        Body: { name: string; personalityId?: string; rules: CurationRules; outputDir: string };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getDatasetCuratorManager();
      if (!manager) return sendError(reply, 503, 'Dataset curator not available');

      const body = request.body;
      if (!body?.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body?.outputDir?.trim()) return sendError(reply, 400, 'outputDir is required');

      const dataset = await manager.commitDataset(
        body.name,
        body.personalityId,
        body.rules ?? {},
        body.outputDir
      );
      return reply.code(201).send(dataset);
    }
  );

  app.get(
    '/api/v1/training/curated-datasets',
    async (
      request: FastifyRequest<{ Querystring: { status?: string; limit?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getDatasetCuratorManager();
      if (!manager) return sendError(reply, 503, 'Dataset curator not available');

      const { limit } = parsePagination(request.query);
      const datasets = await manager.listDatasets({
        status: request.query.status,
        limit,
      });
      return { datasets };
    }
  );

  app.get(
    '/api/v1/training/curated-datasets/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDatasetCuratorManager();
      if (!manager) return sendError(reply, 503, 'Dataset curator not available');

      const dataset = await manager.getDataset(request.params.id);
      if (!dataset) return sendError(reply, 404, 'Dataset not found');
      return dataset;
    }
  );

  app.delete(
    '/api/v1/training/curated-datasets/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getDatasetCuratorManager();
      if (!manager) return sendError(reply, 503, 'Dataset curator not available');

      const deleted = await manager.deleteDataset(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Dataset not found');
      return reply.code(204).send();
    }
  );

  // ── Phase 98: Experiment Registry endpoints ─────────────────────────────

  app.post(
    '/api/v1/training/experiments',
    async (request: FastifyRequest<{ Body: TrainingExperimentCreate }>, reply: FastifyReply) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const body = request.body;
      if (!body?.name?.trim()) return sendError(reply, 400, 'name is required');

      const experiment = await manager.createExperiment(body);
      return reply.code(201).send(experiment);
    }
  );

  app.get(
    '/api/v1/training/experiments',
    async (
      request: FastifyRequest<{ Querystring: { status?: string; limit?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const { limit } = parsePagination(request.query);
      const experiments = await manager.listExperiments({
        status: request.query.status as
          | 'draft'
          | 'running'
          | 'completed'
          | 'failed'
          | 'archived'
          | undefined,
        limit,
      });
      return { experiments };
    }
  );

  app.get(
    '/api/v1/training/experiments/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const experiment = await manager.getExperiment(request.params.id);
      if (!experiment) return sendError(reply, 404, 'Experiment not found');
      return experiment;
    }
  );

  app.patch(
    '/api/v1/training/experiments/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { status?: string; notes?: string; hyperparameters?: Record<string, unknown> };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const body = request.body ?? {};
      const experiment = await manager.updateExperiment(request.params.id, {
        ...body,
        status: body.status as
          | 'draft'
          | 'running'
          | 'completed'
          | 'failed'
          | 'archived'
          | undefined,
      });
      if (!experiment) return sendError(reply, 404, 'Experiment not found');
      return experiment;
    }
  );

  app.delete(
    '/api/v1/training/experiments/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const deleted = await manager.deleteExperiment(request.params.id);
      if (!deleted) return sendError(reply, 404, 'Experiment not found');
      return reply.code(204).send();
    }
  );

  app.get(
    '/api/v1/training/experiments/diff',
    async (
      request: FastifyRequest<{ Querystring: { idA: string; idB: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getExperimentRegistryManager();
      if (!manager) return sendError(reply, 503, 'Experiment registry not available');

      const { idA, idB } = request.query;
      if (!idA || !idB) return sendError(reply, 400, 'idA and idB query params are required');

      const diff = await manager.diffExperiments(idA, idB);
      if (!diff) return sendError(reply, 404, 'One or both experiments not found');
      return diff;
    }
  );

  // ── Phase 98: Model Deployment endpoints ────────────────────────────────

  app.post(
    '/api/v1/training/deploy',
    async (
      request: FastifyRequest<{
        Body: {
          personalityId: string;
          modelName: string;
          experimentId?: string;
          finetuneJobId?: string;
          ollamaBaseUrl?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getModelVersionManager();
      if (!manager) return sendError(reply, 503, 'Model version manager not available');

      const body = request.body;
      if (!body?.personalityId) return sendError(reply, 400, 'personalityId is required');
      if (!body?.modelName?.trim()) return sendError(reply, 400, 'modelName is required');

      const version = await manager.deployModel(body);
      return reply.code(201).send(version);
    }
  );

  app.post(
    '/api/v1/training/deploy/rollback',
    async (request: FastifyRequest<{ Body: { personalityId: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getModelVersionManager();
      if (!manager) return sendError(reply, 503, 'Model version manager not available');

      const body = request.body;
      if (!body?.personalityId) return sendError(reply, 400, 'personalityId is required');

      const version = await manager.rollback(body.personalityId);
      if (!version) return sendError(reply, 404, 'No previous model to rollback to');
      return version;
    }
  );

  app.get(
    '/api/v1/training/model-versions',
    async (
      request: FastifyRequest<{ Querystring: { personalityId: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getModelVersionManager();
      if (!manager) return sendError(reply, 503, 'Model version manager not available');

      if (!request.query.personalityId) {
        return sendError(reply, 400, 'personalityId query param is required');
      }

      const versions = await manager.listVersions(request.query.personalityId);
      return { versions };
    }
  );

  app.get(
    '/api/v1/training/model-versions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getModelVersionManager();
      if (!manager) return sendError(reply, 503, 'Model version manager not available');

      const version = await manager.getVersion(request.params.id);
      if (!version) return sendError(reply, 404, 'Model version not found');
      return version;
    }
  );

  // ── Phase 98: A/B Test endpoints ────────────────────────────────────────

  app.post(
    '/api/v1/training/ab-tests',
    async (
      request: FastifyRequest<{
        Body: {
          personalityId: string;
          name: string;
          modelA: string;
          modelB: string;
          trafficPctB: number;
          autoPromote?: boolean;
          minConversations?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const body = request.body;
      if (!body?.personalityId) return sendError(reply, 400, 'personalityId is required');
      if (!body?.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body?.modelA?.trim()) return sendError(reply, 400, 'modelA is required');
      if (!body?.modelB?.trim()) return sendError(reply, 400, 'modelB is required');

      const test = await manager.createTest(body);
      return reply.code(201).send(test);
    }
  );

  app.get(
    '/api/v1/training/ab-tests',
    async (
      request: FastifyRequest<{ Querystring: { personalityId?: string; status?: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const tests = await manager.listTests({
        personalityId: request.query.personalityId,
        status: request.query.status,
      });
      return { tests };
    }
  );

  app.get(
    '/api/v1/training/ab-tests/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const test = await manager.getTest(request.params.id);
      if (!test) return sendError(reply, 404, 'A/B test not found');
      return test;
    }
  );

  app.post(
    '/api/v1/training/ab-tests/:id/complete',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { winner: string } }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const body = request.body;
      if (!body?.winner) return sendError(reply, 400, 'winner is required');

      const test = await manager.completeTest(request.params.id, body.winner);
      if (!test) return sendError(reply, 404, 'A/B test not found or not running');
      return test;
    }
  );

  app.post(
    '/api/v1/training/ab-tests/:id/cancel',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const test = await manager.cancelTest(request.params.id);
      if (!test) return sendError(reply, 404, 'A/B test not found or not running');
      return test;
    }
  );

  app.post(
    '/api/v1/training/ab-tests/:id/evaluate',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getAbTestManager();
      if (!manager) return sendError(reply, 503, 'A/B test manager not available');

      const result = await manager.evaluateTest(request.params.id);
      return result;
    }
  );

  // ── Phase 98: Side-by-Side Rating ───────────────────────────────────────

  app.post(
    '/api/v1/training/side-by-side/rate',
    async (request: FastifyRequest<{ Body: SideBySideRating }>, reply: FastifyReply) => {
      const prefManager = secureYeoman.getPreferenceManager();
      if (!prefManager) return sendError(reply, 503, 'Preference manager not available');

      const body = request.body;
      if (!body?.prompt?.trim()) return sendError(reply, 400, 'prompt is required');
      if (!body?.responseA?.trim()) return sendError(reply, 400, 'responseA is required');
      if (!body?.responseB?.trim()) return sendError(reply, 400, 'responseB is required');
      if (body?.winner !== 'a' && body?.winner !== 'b') {
        return sendError(reply, 400, 'winner must be "a" or "b"');
      }

      const chosen = body.winner === 'a' ? body.responseA : body.responseB;
      const rejected = body.winner === 'a' ? body.responseB : body.responseA;

      const pair = await prefManager.recordAnnotation({
        prompt: body.prompt,
        chosen,
        rejected,
        source: 'comparison',
        personalityId: body.personalityId,
        annotatorId: body.annotatorId,
      });

      return reply.code(201).send(pair);
    }
  );

  // ── Phase 131: Advanced Training ──────────────────────────────────────

  // List checkpoints for a finetune job
  app.get(
    '/api/v1/training/finetune/jobs/:id/checkpoints',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const store = secureYeoman.getCheckpointStore?.();
      if (!store) return sendError(reply, 503, 'Checkpoint store not available');
      return store.listByJob(request.params.id);
    }
  );

  // Resume from checkpoint
  app.post(
    '/api/v1/training/finetune/jobs/:id/resume',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { checkpointPath: string };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getFinetuneManager();
      if (!manager) return sendError(reply, 503, 'Finetune manager not available');

      const originalJob = await manager.getJob(request.params.id);
      if (!originalJob) return sendError(reply, 404, 'Original job not found');

      const newJob = await manager.createJob({
        name: `${originalJob.name}-resumed`,
        baseModel: originalJob.baseModel,
        adapterName: originalJob.adapterName,
        datasetPath: originalJob.datasetPath,
        loraRank: originalJob.loraRank,
        loraAlpha: originalJob.loraAlpha,
        batchSize: originalJob.batchSize,
        epochs: originalJob.epochs,
        trainingMethod: originalJob.trainingMethod,
        numGpus: originalJob.numGpus,
        learningRate: originalJob.learningRate ?? undefined,
        warmupSteps: originalJob.warmupSteps ?? undefined,
        checkpointSteps: originalJob.checkpointSteps ?? undefined,
        resumeFromCheckpoint: request.body?.checkpointPath,
        parentJobId: originalJob.id,
      });

      try {
        await manager.startJob(newJob.id);
      } catch (err) {
        return reply.code(201).send({ ...newJob, startError: toErrorMessage(err) });
      }

      const started = await manager.getJob(newJob.id);
      return reply.code(201).send(started ?? newJob);
    }
  );

  // Export preference pairs to disk JSONL
  app.post(
    '/api/v1/training/preference-pairs/export-file',
    async (
      request: FastifyRequest<{
        Body: { path: string; personalityId?: string; source?: string };
      }>,
      reply: FastifyReply
    ) => {
      const prefManager = secureYeoman.getPreferenceManager();
      if (!prefManager) return sendError(reply, 503, 'Preference manager not available');

      const body = request.body;
      if (!body?.path?.trim()) return sendError(reply, 400, 'path is required');

      const count = await prefManager.exportAsJsonlFile(body.path, {
        personalityId: body.personalityId,
        source: body.source as
          | 'annotation'
          | 'comparison'
          | 'multi_turn'
          | 'constitutional'
          | undefined,
      });
      return { path: body.path, count };
    }
  );

  // Hyperparameter search endpoints
  app.post(
    '/api/v1/training/hyperparam/searches',
    async (
      request: FastifyRequest<{
        Body: {
          name: string;
          baseConfig: Record<string, unknown>;
          searchStrategy: 'grid' | 'random';
          paramSpace: Record<string, unknown>;
          maxTrials?: number;
          metricToOptimize?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const manager = secureYeoman.getHyperparamSearchManager?.();
      if (!manager) return sendError(reply, 503, 'Hyperparam search manager not available');

      const body = request.body;
      if (!body?.name?.trim()) return sendError(reply, 400, 'name is required');
      if (!body.baseConfig) return sendError(reply, 400, 'baseConfig is required');
      if (!body.searchStrategy) return sendError(reply, 400, 'searchStrategy is required');
      if (!body.paramSpace) return sendError(reply, 400, 'paramSpace is required');

      const search = await manager.create(body);
      return reply.code(201).send(search);
    }
  );

  app.get(
    '/api/v1/training/hyperparam/searches',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const manager = secureYeoman.getHyperparamSearchManager?.();
      if (!manager) return sendError(reply, 503, 'Hyperparam search manager not available');
      return manager.list();
    }
  );

  app.get(
    '/api/v1/training/hyperparam/searches/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getHyperparamSearchManager?.();
      if (!manager) return sendError(reply, 503, 'Hyperparam search manager not available');

      const search = await manager.get(request.params.id);
      if (!search) return sendError(reply, 404, 'Search not found');
      return search;
    }
  );

  app.post(
    '/api/v1/training/hyperparam/searches/:id/start',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getHyperparamSearchManager?.();
      if (!manager) return sendError(reply, 503, 'Hyperparam search manager not available');

      try {
        await manager.startSearch(request.params.id);
        return reply.code(202).send({ ok: true });
      } catch (err) {
        return sendError(reply, 400, toErrorMessage(err));
      }
    }
  );

  app.delete(
    '/api/v1/training/hyperparam/searches/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const manager = secureYeoman.getHyperparamSearchManager?.();
      if (!manager) return sendError(reply, 503, 'Hyperparam search manager not available');

      const cancelled = await manager.cancel(request.params.id);
      if (!cancelled) return sendError(reply, 404, 'Search not found or already completed');
      return { ok: true };
    }
  );
}
