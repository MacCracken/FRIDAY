/**
 * WorkflowEngine — DAG-based workflow executor.
 *
 * Executes workflow definitions step-by-step using topological sort.
 * Supports 16 step types, Mustache-style template resolution, retry policies,
 * and four error-handling modes (fail, continue, skip, fallback).
 *
 * Phase 73 adds 5 ML pipeline step types:
 *   data_curation, training_job, evaluation, conditional_deploy, human_approval
 *
 * Phase 90 adds 2 CI/CD step types:
 *   ci_trigger — dispatch a CI job, returns { runId, url, status: 'queued' }
 *   ci_wait   — poll until completion, returns { status, conclusion, logs_url, durationMs }
 */

import type { SecureLogger } from '../logging/logger.js';
import type { SubAgentManager } from '../agents/manager.js';
import type { SwarmManager } from '../agents/swarm-manager.js';
import type { AuditChain } from '../logging/audit-chain.js';
import { WorkflowStorage } from './workflow-storage.js';
import {
  evaluateCondition as safeEvalCondition,
  validateConditionExpression as safeValidateCondition,
} from './safe-eval.js';
import * as szal from '../native/szal.js';
import { OutputSchemaValidator } from '../security/output-schema-validator.js';
import type { DataCurationManager } from '../training/data-curation.js';
import type { EvaluationManager } from '../training/evaluation-manager.js';
import type { PipelineApprovalManager } from '../training/approval-manager.js';
import type { PipelineLineageStorage } from '../training/pipeline-lineage.js';
import type { DistillationManager } from '../training/distillation-manager.js';
import type { FinetuneManager } from '../training/finetune-manager.js';
import type { WorkflowDefinition, WorkflowRun, WorkflowStep } from '@secureyeoman/shared';
import { execFileSync } from 'node:child_process';
import { assertPublicUrl } from '../utils/ssrf-guard.js';
import type { AlertManager } from '../telemetry/alert-manager.js';
import type { CouncilManager } from '../agents/council-manager.js';
import { emitJobCompletion } from '../telemetry/job-completion-events.js';
import { withSpan } from '../telemetry/instrument.js';
import { errorToString } from '../utils/errors.js';

// ── Magic-number constants ───────────────────────────────────────────────────
const DEFAULT_RETRY_BACKOFF_MS = 1000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_EXEC_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const WEBHOOK_TIMEOUT_MS = 30_000;
const MAX_WEBHOOK_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
const CI_FETCH_TIMEOUT_MS = 30_000;
const CI_ERROR_BODY_LIMIT = 1000;
const DEFAULT_CI_POLL_INTERVAL_MS = 10_000;

const _outputSchemaValidator = new OutputSchemaValidator();

export class WorkflowCycleError extends Error {
  constructor(cycleStepIds: string[]) {
    super(`Workflow contains a cycle involving steps: ${cycleStepIds.join(', ')}`);
    this.name = 'WorkflowCycleError';
  }
}

export interface WorkflowEngineContext {
  steps: Record<string, { output: unknown; status: string }>;
  input: Record<string, unknown>;
}

/** Agnostic platform config for crew delegation step types. */
export interface AgnosticEngineConfig {
  /** Agnostic platform base URL. */
  url: string;
  /** API key for auth (preferred over email/password). */
  apiKey?: string;
  /** Email for JWT auth (fallback). */
  email?: string;
  /** Password for JWT auth (fallback). */
  password?: string;
  /** Default poll interval for crew_wait steps. */
  pollIntervalMs?: number;
  /** Default timeout for crew_wait steps. */
  timeoutMs?: number;
}

/** Credential bundle for CI/CD step types (ci_trigger, ci_wait). Phase 90. */
export interface CicdEngineConfig {
  /** GitHub token for GitHub Actions steps. */
  githubToken?: string;
  /** Jenkins server base URL. */
  jenkinsUrl?: string;
  /** Jenkins Basic Auth username. */
  jenkinsUsername?: string;
  /** Jenkins Basic Auth API token. */
  jenkinsApiToken?: string;
  /** GitLab server URL (default: https://gitlab.com). */
  gitlabUrl?: string;
  /** GitLab Personal Access Token. */
  gitlabToken?: string;
  /** Northflank API key. */
  northflankApiKey?: string;
}

export interface WorkflowEngineDeps {
  storage: WorkflowStorage;
  subAgentManager?: SubAgentManager | null;
  swarmManager?: SwarmManager | null;
  auditChain?: AuditChain | null;
  logger: SecureLogger;
  // ML Pipeline deps (Phase 73)
  dataCurationManager?: DataCurationManager | null;
  distillationManager?: DistillationManager | null;
  finetuneManager?: FinetuneManager | null;
  evaluationManager?: EvaluationManager | null;
  approvalManager?: PipelineApprovalManager | null;
  lineageStorage?: PipelineLineageStorage | null;
  // CI/CD deps (Phase 90)
  cicdConfig?: CicdEngineConfig | null;
  // Alert pipeline (Phase 104)
  alertManager?: AlertManager | null;
  // Council of AIs
  councilManager?: CouncilManager | null;
  // Agnostic crew delegation
  agnosticConfig?: AgnosticEngineConfig | null;
}

export class WorkflowEngine {
  private readonly storage: WorkflowStorage;
  private readonly subAgentManager: SubAgentManager | null;
  private readonly swarmManager: SwarmManager | null;
  private readonly auditChain: AuditChain | null;
  private readonly logger: SecureLogger;
  // Condition evaluation uses safe-eval (no more compiled function cache)
  // ML Pipeline managers (Phase 73)
  private readonly dataCurationManager: DataCurationManager | null;
  private readonly distillationManager: DistillationManager | null;
  private readonly finetuneManager: FinetuneManager | null;
  private readonly evaluationManager: EvaluationManager | null;
  private readonly approvalManager: PipelineApprovalManager | null;
  private readonly lineageStorage: PipelineLineageStorage | null;
  // CI/CD config (Phase 90)
  private readonly cicdConfig: CicdEngineConfig | null;
  // Alert pipeline (Phase 104)
  private readonly alertManager: AlertManager | null;
  // Council of AIs
  private readonly councilManager: CouncilManager | null;
  // Agnostic crew delegation
  private readonly agnosticConfig: AgnosticEngineConfig | null;
  /** Tracks subworkflow nesting depth to prevent infinite recursion. */
  private subworkflowDepth = 0;
  private static readonly MAX_SUBWORKFLOW_DEPTH = 10;

  constructor(deps: WorkflowEngineDeps) {
    this.storage = deps.storage;
    this.subAgentManager = deps.subAgentManager ?? null;
    this.swarmManager = deps.swarmManager ?? null;
    this.auditChain = deps.auditChain ?? null;
    this.logger = deps.logger;
    this.dataCurationManager = deps.dataCurationManager ?? null;
    this.distillationManager = deps.distillationManager ?? null;
    this.finetuneManager = deps.finetuneManager ?? null;
    this.evaluationManager = deps.evaluationManager ?? null;
    this.approvalManager = deps.approvalManager ?? null;
    this.lineageStorage = deps.lineageStorage ?? null;
    this.cicdConfig = deps.cicdConfig ?? null;
    this.alertManager = deps.alertManager ?? null;
    this.councilManager = deps.councilManager ?? null;
    this.agnosticConfig = deps.agnosticConfig ?? null;
    // Validate external URLs at construction time to prevent SSRF
    if (this.agnosticConfig?.url) {
      assertPublicUrl(this.agnosticConfig.url, 'Agnostic platform URL');
    }
  }

  // ── Public API ────────────────────────────────────────────────

  async execute(run: WorkflowRun, definition: WorkflowDefinition): Promise<void> {
    this.logger.info({ runId: run.id, workflowId: definition.id }, 'Workflow run started');

    const startTime = Date.now();
    await this.storage.updateRun(run.id, { status: 'running', startedAt: startTime });

    const ctx: WorkflowEngineContext = {
      steps: {},
      input: run.input ?? {},
    };

    try {
      const tiers = this.topologicalSort(definition.steps);

      const MAX_PARALLEL_STEPS = 20;
      for (const tier of tiers) {
        // Batch parallel execution to prevent resource exhaustion
        for (let i = 0; i < tier.length; i += MAX_PARALLEL_STEPS) {
          const batch = tier.slice(i, i + MAX_PARALLEL_STEPS);
          await Promise.all(
            batch.map((stepId) => this.executeStep(stepId, definition, ctx, run.id))
          );
        }
      }

      const lastOutput = this.buildOutput(ctx);
      await this.storage.updateRun(run.id, {
        status: 'completed',
        output: lastOutput,
        completedAt: Date.now(),
      });

      this.logger.info({ runId: run.id }, 'Workflow run completed');

      emitJobCompletion(
        this.alertManager,
        {
          jobType: 'workflow',
          status: 'completed',
          jobId: run.id,
          jobName: definition.name,
          durationMs: Date.now() - startTime,
        },
        this.logger
      );
    } catch (err) {
      const error = errorToString(err);
      await this.storage.updateRun(run.id, {
        status: 'failed',
        error,
        completedAt: Date.now(),
      });
      this.logger.error({ runId: run.id, error }, 'Workflow run failed');

      emitJobCompletion(
        this.alertManager,
        {
          jobType: 'workflow',
          status: 'failed',
          jobId: run.id,
          jobName: definition.name,
          durationMs: Date.now() - startTime,
        },
        this.logger
      );
    }
  }

  // ── Topological Sort (Kahn's algorithm) ──────────────────────

  private topologicalSort(steps: WorkflowStep[]): string[][] {
    try {
      return szal.topologicalSort(
        steps.map((s) => ({
          id: s.id,
          dependsOn: s.dependsOn,
          triggerMode: s.triggerMode,
        }))
      );
    } catch {
      // szal throws on cycle — convert to WorkflowCycleError
      const cycleSteps = steps.map((s) => s.id);
      throw new WorkflowCycleError(cycleSteps);
    }
  }

  // ── Step Execution ────────────────────────────────────────────

  private async executeStep(
    stepId: string,
    definition: WorkflowDefinition,
    ctx: WorkflowEngineContext,
    runId: string
  ): Promise<void> {
    const step = definition.steps.find((s) => s.id === stepId);
    if (!step) return;

    // For 'any' trigger mode: skip if no dep completed (all failed/skipped)
    if (step.triggerMode === 'any' && step.dependsOn.length > 0) {
      const anyDepCompleted = step.dependsOn.some(
        (depId) => ctx.steps[depId]?.status === 'completed'
      );
      if (!anyDepCompleted) {
        ctx.steps[stepId] = { output: null, status: 'skipped' };
        await this.storage
          .createStepRun(runId, step.id, step.name, step.type)
          .then((sr) => this.storage.updateStepRun(sr.id, { status: 'skipped' }));
        return;
      }
    }

    // Evaluate optional condition — skip if falsy
    if (step.condition) {
      try {
        const condResult = this.evaluateCondition(step.condition, ctx);
        if (!condResult) {
          ctx.steps[stepId] = { output: null, status: 'skipped' };
          await this.storage
            .createStepRun(runId, step.id, step.name, step.type)
            .then((sr) => this.storage.updateStepRun(sr.id, { status: 'skipped' }));
          return;
        }
      } catch {
        ctx.steps[stepId] = { output: null, status: 'skipped' };
        return;
      }
    }

    const stepRun = await this.storage.createStepRun(runId, step.id, step.name, step.type);
    const startedAt = Date.now();
    await this.storage.updateStepRun(stepRun.id, { status: 'running', startedAt });

    let output: unknown = null;
    let error: string | null = null;

    const maxAttempts = step.retryPolicy?.maxAttempts ?? 1;
    const backoffMs = step.retryPolicy?.backoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        output = await withSpan(
          'secureyeoman.workflow',
          `workflow.step ${step.type}`,
          async (span) => {
            span.setAttribute('workflow.id', definition.id);
            span.setAttribute('workflow.run_id', runId);
            span.setAttribute('workflow.step_id', step.id);
            span.setAttribute('workflow.step_name', step.name);
            span.setAttribute('workflow.step_type', step.type);
            span.setAttribute('workflow.attempt', attempt + 1);
            const result = await this.dispatchStep(step, ctx, runId, definition.id);
            span.setAttribute('workflow.step_status', 'completed');
            return result;
          }
        );

        // ── Output schema validation (Phase 54 + Phase 83 strict mode) ──────
        const stepCfg = step.config as Record<string, unknown> | undefined;
        const stepOutputSchema = stepCfg?.outputSchema;
        const outputSchemaMode = (stepCfg?.outputSchemaMode as string | undefined) ?? 'audit';
        if (stepOutputSchema != null && output != null) {
          const schemaValidation = _outputSchemaValidator.validate(
            output,
            stepOutputSchema as Record<string, unknown>
          );
          if (!schemaValidation.valid) {
            this.logger.warn(
              {
                stepId: step.id,
                stepName: step.name,
                errors: schemaValidation.errors,
              },
              'Step output schema violation'
            );
            void this.auditChain
              ?.record({
                event: 'step_output_schema_violation',
                level: 'warn',
                message: `Step "${step.name}" output failed schema validation`,
                metadata: {
                  stepId: step.id,
                  errorCount: schemaValidation.errors.length,
                  errors: schemaValidation.errors.map((e) => `${e.path}: ${e.message}`),
                },
              })
              .catch((err: unknown) => {
                this.logger.warn({ err }, 'Failed to record step_output_schema_violation audit');
              });
            if (outputSchemaMode === 'strict') {
              throw new Error(
                `Step "${step.id}" output failed schema validation (${schemaValidation.errors.length} error(s)): ` +
                  schemaValidation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
              );
            }
          }
        }

        error = null;
        break;
      } catch (err) {
        error = errorToString(err);
        this.logger.warn(
          {
            stepId: step.id,
            attempt: attempt + 1,
            maxAttempts,
            error,
          },
          'Step execution failed'
        );
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
        }
      }
    }

    const completedAt = Date.now();
    const durationMs = completedAt - startedAt;

    if (error !== null) {
      // Handle onError policy
      switch (step.onError) {
        case 'continue':
          ctx.steps[stepId] = { output: null, status: 'failed' };
          await this.storage.updateStepRun(stepRun.id, {
            status: 'failed',
            error,
            completedAt,
            durationMs,
          });
          break;
        case 'skip':
          ctx.steps[stepId] = { output: null, status: 'skipped' };
          await this.storage.updateStepRun(stepRun.id, {
            status: 'skipped',
            completedAt,
            durationMs,
          });
          break;
        case 'fallback':
          ctx.steps[stepId] = { output: null, status: 'failed' };
          await this.storage.updateStepRun(stepRun.id, {
            status: 'failed',
            error,
            completedAt,
            durationMs,
          });
          // Queue fallback step — will be picked up in next tier if caller handles it
          if (step.fallbackStepId) {
            await this.executeStep(step.fallbackStepId, definition, ctx, runId);
          }
          break;
        default:
          // 'fail' — rethrow to abort the workflow
          await this.storage.updateStepRun(stepRun.id, {
            status: 'failed',
            error,
            completedAt,
            durationMs,
          });
          throw new Error(`Step "${step.id}" failed: ${error}`);
      }
    } else {
      ctx.steps[stepId] = { output, status: 'completed' };
      const outputRecord =
        output !== null && output !== undefined
          ? { result: typeof output === 'string' ? output : JSON.stringify(output) }
          : null;
      await this.storage.updateStepRun(stepRun.id, {
        status: 'completed',
        output: outputRecord,
        completedAt,
        durationMs,
      });
    }
  }

  // ── Step Dispatchers ──────────────────────────────────────────

  private async dispatchStep(
    step: WorkflowStep,
    ctx: WorkflowEngineContext,
    runId: string,
    workflowId: string
  ): Promise<unknown> {
    const cfg = step.config;

    switch (step.type) {
      case 'agent': {
        // Deterministic dispatch: if step.config.deterministic is true and a command
        // is specified, execute it directly and skip AI routing on success.
        if (cfg.deterministic && cfg.command) {
          try {
            const cmdStr = String(cfg.command);
            const parts = cmdStr.split(/\s+/).filter(Boolean);
            const ALLOWED_DETERMINISTIC_CMDS = new Set([
              'echo',
              'date',
              'curl',
              'jq',
              'python3',
              'node',
            ]);
            if (!ALLOWED_DETERMINISTIC_CMDS.has(parts[0]!)) {
              throw new Error(
                `Deterministic command '${parts[0]}' is not in the allowed commands list`
              );
            }
            const timeoutMs = Number(cfg.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
            const stdout = execFileSync(parts[0]!, parts.slice(1), {
              timeout: timeoutMs,
              encoding: 'utf-8',
              maxBuffer: MAX_EXEC_BUFFER_BYTES,
            });
            return stdout;
          } catch (err) {
            this.logger.warn(
              {
                stepId: step.id,
                command: String(cfg.command),
                error: errorToString(err),
              },
              'Deterministic command failed, falling through to agent dispatch'
            );
            // Fall through to normal agent dispatch
          }
        }

        if (!this.subAgentManager) {
          throw new Error('SubAgentManager not available for agent step');
        }
        const profile = this.resolveTemplate(String(cfg.profile ?? ''), ctx);
        const task = this.resolveTemplate(String(cfg.taskTemplate ?? ''), ctx);
        const contextStr = cfg.contextTemplate
          ? this.resolveTemplate(String(cfg.contextTemplate), ctx)
          : undefined;
        const result = await this.subAgentManager.delegate({
          profile,
          task,
          context: contextStr,
          modelOverride: cfg.modelOverride ? String(cfg.modelOverride) : undefined,
          maxTokenBudget: cfg.maxTokenBudget ? Number(cfg.maxTokenBudget) : undefined,
        });
        return result.result ?? null;
      }

      case 'tool':
      case 'mcp': {
        // Fallback: log that MCP client not wired — return null
        this.logger.warn({ stepId: step.id }, 'MCP tool step not wired to mcpClientManager');
        return null;
      }

      case 'condition': {
        const expr = String(cfg.expression ?? 'false');
        return this.evaluateCondition(expr, ctx);
      }

      case 'transform': {
        const template = String(cfg.outputTemplate ?? '');
        return this.resolveTemplate(template, ctx);
      }

      case 'resource': {
        // Log resource write intent — actual BrainManager wiring is optional
        const resourceType = String(cfg.resourceType ?? 'memory');
        const data = this.resolveTemplate(String(cfg.dataTemplate ?? ''), ctx);
        this.logger.info(
          {
            resourceType,
            stepId: step.id,
            dataLength: data.length,
          },
          'Workflow resource step'
        );
        return { resourceType, data };
      }

      case 'webhook': {
        const url = this.resolveTemplate(String(cfg.url ?? ''), ctx);
        assertPublicUrl(url, 'Webhook URL');
        const method = String(cfg.method ?? 'POST').toUpperCase();
        const body = cfg.bodyTemplate
          ? this.resolveTemplate(String(cfg.bodyTemplate), ctx)
          : undefined;
        // Use null-prototype object to prevent prototype pollution from user-supplied header keys
        const headers: Record<string, string> = Object.create(null) as Record<string, string>;
        headers['Content-Type'] = 'application/json';
        if (cfg.headersTemplate) {
          try {
            const resolvedHeaders = this.resolveTemplate(String(cfg.headersTemplate), ctx);
            const parsed = JSON.parse(resolvedHeaders) as Record<string, unknown>;
            for (const key of Object.keys(parsed)) {
              headers[key] = String(parsed[key]);
            }
          } catch {
            // ignore malformed headers template
          }
        }
        const response = await fetch(url, {
          method,
          headers,
          body: body ?? undefined,
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        // Cap response to 10 MB to prevent memory exhaustion
        const responseText = await response.text();
        if (responseText.length > MAX_WEBHOOK_RESPONSE_BYTES) {
          throw new Error(`Webhook response too large (${responseText.length} bytes)`);
        }
        return { status: response.status, body: responseText };
      }

      case 'subworkflow': {
        if (this.subworkflowDepth >= WorkflowEngine.MAX_SUBWORKFLOW_DEPTH) {
          throw new Error(
            `Subworkflow nesting depth exceeds limit (${WorkflowEngine.MAX_SUBWORKFLOW_DEPTH})`
          );
        }
        const subWorkflowId = String(cfg.workflowId ?? '');
        const subDefinition = await this.storage.getDefinition(subWorkflowId);
        if (!subDefinition) {
          throw new Error(`Sub-workflow not found: ${subWorkflowId}`);
        }
        const subInput: Record<string, unknown> = cfg.inputTemplate
          ? { data: this.resolveTemplate(String(cfg.inputTemplate), ctx) }
          : {};
        const subRun = await this.storage.createRun(
          subDefinition.id,
          subDefinition.name,
          subInput,
          'subworkflow'
        );
        this.subworkflowDepth++;
        try {
          await this.execute(subRun, subDefinition);
        } finally {
          this.subworkflowDepth--;
        }
        const updatedSubRun = await this.storage.getRun(subRun.id);
        return updatedSubRun?.output ?? null;
      }

      case 'swarm': {
        if (!this.swarmManager) {
          throw new Error('SwarmManager not available for swarm step');
        }
        const templateId = String(cfg.templateId ?? '');
        const task = this.resolveTemplate(String(cfg.taskTemplate ?? ''), ctx);
        const context = cfg.contextTemplate
          ? this.resolveTemplate(String(cfg.contextTemplate), ctx)
          : undefined;
        const tokenBudget = cfg.tokenBudget ? Number(cfg.tokenBudget) : undefined;
        const swarmResult = await this.swarmManager.executeSwarm({
          templateId,
          task,
          context,
          tokenBudget,
          initiatedBy: 'workflow',
        });
        return swarmResult.result ?? null;
      }

      case 'council': {
        if (!this.councilManager) {
          throw new Error('CouncilManager not available for council step');
        }
        const councilTemplateId = String(cfg.templateId ?? '');
        const councilTopic = this.resolveTemplate(String(cfg.topicTemplate ?? ''), ctx);
        const councilContext = cfg.contextTemplate
          ? this.resolveTemplate(String(cfg.contextTemplate), ctx)
          : undefined;
        const councilBudget = cfg.tokenBudget ? Number(cfg.tokenBudget) : undefined;
        const councilMaxRounds = cfg.maxRounds ? Number(cfg.maxRounds) : undefined;
        const councilResult = await this.councilManager.convene({
          templateId: councilTemplateId,
          topic: councilTopic,
          context: councilContext,
          tokenBudget: councilBudget,
          maxRounds: councilMaxRounds,
          initiatedBy: 'workflow',
        });
        return councilResult.decision ?? null;
      }

      // ── ML Pipeline step types (Phase 73) ────────────────────────

      case 'data_curation': {
        if (!this.dataCurationManager) {
          throw new Error('DataCurationManager not available for data_curation step');
        }
        const rawOutputDir = this.resolveTemplate(
          String(cfg.outputDir ?? '/tmp/secureyeoman-datasets'),
          ctx
        );
        const { resolve, normalize } = await import('node:path');
        const safeBase = resolve('/tmp/secureyeoman-datasets');
        const outputDir = resolve(safeBase, normalize(rawOutputDir));
        if (!outputDir.startsWith(safeBase)) {
          throw new Error('data_curation: outputDir path traversal detected');
        }
        const personalityIdsRaw = cfg.personalityIds;
        const personalityIds = Array.isArray(personalityIdsRaw)
          ? (personalityIdsRaw as string[])
          : personalityIdsRaw
            ? [this.resolveTemplate(String(personalityIdsRaw), ctx)]
            : undefined;
        const descriptor = await this.dataCurationManager.curateDataset({
          outputDir,
          personalityIds,
          minTurns: cfg.minTurns != null ? Number(cfg.minTurns) : undefined,
          maxConversations: cfg.maxConversations != null ? Number(cfg.maxConversations) : undefined,
          fromTs: cfg.fromTs != null ? Number(cfg.fromTs) : undefined,
          toTs: cfg.toTs != null ? Number(cfg.toTs) : undefined,
        });
        // Record lineage
        if (this.lineageStorage) {
          await this.lineageStorage.recordDataset(runId, workflowId, {
            datasetId: descriptor.datasetId,
            path: descriptor.path,
            sampleCount: descriptor.sampleCount,
            filters: descriptor.filters,
            snapshotAt: descriptor.snapshotAt,
          });
        }
        return descriptor;
      }

      case 'training_job': {
        const jobType = String(cfg.jobType ?? 'finetune') as 'distillation' | 'finetune';
        const jobId = this.resolveTemplate(String(cfg.jobId ?? ''), ctx);
        const timeoutMs = Number(cfg.timeoutMs ?? 3_600_000); // 1h default
        const pollIntervalMs = Number(cfg.pollIntervalMs ?? 30_000); // 30s default

        if (jobType === 'finetune') {
          if (!this.finetuneManager) {
            throw new Error('FinetuneManager not available for training_job step');
          }
          const job = await this.finetuneManager.getJob(jobId);
          if (!job) throw new Error(`Finetune job not found: ${jobId}`);
          if (job.status === 'pending') {
            await this.finetuneManager.startJob(jobId);
          }
          const finalJob = await this.pollUntilDone(
            () => this.finetuneManager!.getJob(jobId).then((j) => j?.status ?? 'failed'),
            ['complete', 'failed', 'cancelled'],
            timeoutMs,
            pollIntervalMs
          );
          const finalStatus = await this.finetuneManager.getJob(jobId);
          if (finalJob === 'failed' || finalJob === 'cancelled') {
            throw new Error(
              `Finetune job ${jobId} ended with status: ${finalJob} — ${finalStatus?.errorMessage ?? ''}`
            );
          }
          if (this.lineageStorage) {
            await this.lineageStorage.recordTrainingJob(runId, workflowId, {
              jobId,
              jobType: 'finetune',
              jobStatus: finalJob,
            });
          }
          return {
            jobId,
            jobType: 'finetune',
            status: finalJob,
            adapterPath: finalStatus?.adapterPath ?? null,
            experimentId: jobId,
          };
        } else {
          // distillation
          if (!this.distillationManager) {
            throw new Error('DistillationManager not available for training_job step');
          }
          const job = await this.distillationManager.getJob(jobId);
          if (!job) throw new Error(`Distillation job not found: ${jobId}`);
          // Distillation job must be started externally (requires teacher client)
          // This step just polls for completion.
          const finalStatus = await this.pollUntilDone(
            () => this.distillationManager!.getJob(jobId).then((j) => j?.status ?? 'failed'),
            ['complete', 'failed', 'cancelled'],
            timeoutMs,
            pollIntervalMs
          );
          if (finalStatus === 'failed' || finalStatus === 'cancelled') {
            const j = await this.distillationManager.getJob(jobId);
            throw new Error(
              `Distillation job ${jobId} ended with status: ${finalStatus} — ${j?.errorMessage ?? ''}`
            );
          }
          const finalJob = await this.distillationManager.getJob(jobId);
          if (this.lineageStorage) {
            await this.lineageStorage.recordTrainingJob(runId, workflowId, {
              jobId,
              jobType: 'distillation',
              jobStatus: finalStatus,
            });
          }
          return {
            jobId,
            jobType: 'distillation',
            status: finalStatus,
            outputPath: finalJob?.outputPath ?? null,
            experimentId: jobId,
          };
        }
      }

      case 'evaluation': {
        if (!this.evaluationManager) {
          throw new Error('EvaluationManager not available for evaluation step');
        }
        const datasetPath = cfg.datasetPath
          ? this.resolveTemplate(String(cfg.datasetPath), ctx)
          : undefined;
        const maxSamples = cfg.maxSamples != null ? Number(cfg.maxSamples) : undefined;
        // Inline samples if provided
        const samplesRaw = cfg.samples;
        const samples = Array.isArray(samplesRaw)
          ? (samplesRaw as { prompt: string; gold: string }[])
          : undefined;
        if (!datasetPath && (!samples || samples.length === 0)) {
          throw new Error('evaluation step requires either cfg.datasetPath or cfg.samples');
        }
        // Model function: use webhook-style call to a local model endpoint if provided
        const modelEndpoint = cfg.modelEndpoint
          ? this.resolveTemplate(String(cfg.modelEndpoint), ctx)
          : null;
        if (modelEndpoint) assertPublicUrl(modelEndpoint, 'Model endpoint URL');
        const modelFn = async (prompt: string): Promise<string> => {
          if (!modelEndpoint) return '(no model endpoint configured)';
          const response = await fetch(modelEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            signal: AbortSignal.timeout(60_000),
          });
          const json = (await response.json()) as { response?: string; text?: string };
          return json.response ?? json.text ?? '';
        };
        const result = await this.evaluationManager.runEvaluation({
          samples,
          datasetPath,
          maxSamples,
          modelFn,
        });
        if (this.lineageStorage) {
          // Filter out undefined optional metrics before storing (Record<string, number> contract)
          const definedMetrics: Record<string, number> = {};
          for (const [k, v] of Object.entries(result.metrics)) {
            if (typeof v === 'number') definedMetrics[k] = v;
          }
          await this.lineageStorage.recordEvaluation(runId, workflowId, {
            evalId: result.evalId,
            metrics: definedMetrics,
            completedAt: result.completedAt,
          });
        }
        return result;
      }

      case 'conditional_deploy': {
        // Read the metric value from context (e.g. {{steps.eval.output.metrics.char_similarity}})
        const metricPath = String(cfg.metricPath ?? '');
        const metricValueStr = this.resolveTemplate(`{{${metricPath}}}`, ctx);
        const metricValue = parseFloat(metricValueStr);
        const threshold = Number(cfg.threshold ?? 0.5);
        const modelVersion = cfg.modelVersion
          ? this.resolveTemplate(String(cfg.modelVersion), ctx)
          : '';
        const personalityId = cfg.personalityId
          ? this.resolveTemplate(String(cfg.personalityId), ctx)
          : '';
        const jobId = cfg.jobId ? this.resolveTemplate(String(cfg.jobId), ctx) : '';
        let ollamaUrl = 'http://ollama:11434';
        if (cfg.ollamaUrl) {
          ollamaUrl = this.resolveTemplate(String(cfg.ollamaUrl), ctx);
          assertPublicUrl(ollamaUrl, 'Ollama URL');
        }

        const passes = !isNaN(metricValue) && metricValue >= threshold;
        this.logger.info(
          {
            metricPath,
            metricValue,
            threshold,
            passes,
          },
          'conditional_deploy: evaluating threshold'
        );

        if (passes) {
          // Attempt to register fine-tuned adapter with Ollama if finetuneManager available
          if (this.finetuneManager && jobId) {
            try {
              await this.finetuneManager.registerWithOllama(jobId, ollamaUrl);
              this.logger.info({ jobId }, 'conditional_deploy: registered adapter with Ollama');
            } catch (err) {
              this.logger.warn(
                {
                  error: errorToString(err),
                },
                'conditional_deploy: Ollama registration failed (non-fatal)'
              );
            }
          }
          if (this.lineageStorage && (modelVersion || jobId)) {
            await this.lineageStorage.recordDeployment(runId, workflowId, {
              modelVersion: modelVersion || jobId,
              personalityId,
              deployedAt: Date.now(),
            });
          }
          return { deployed: true, metricValue, threshold, modelVersion, personalityId };
        } else {
          const reason = `Metric ${metricValue.toFixed(4)} < threshold ${threshold}`;
          this.logger.info({ reason }, 'conditional_deploy: threshold not met, skipping deploy');
          return { deployed: false, metricValue, threshold, reason };
        }
      }

      case 'human_approval': {
        if (!this.approvalManager) {
          throw new Error('ApprovalManager not available for human_approval step');
        }
        const timeoutMs = Number(cfg.timeoutMs ?? 86_400_000); // 24h default
        // Build report from context
        const reportTemplate = cfg.reportTemplate
          ? this.resolveTemplate(String(cfg.reportTemplate), ctx)
          : null;
        let report: Record<string, unknown> | undefined;
        if (reportTemplate) {
          try {
            report = JSON.parse(reportTemplate) as Record<string, unknown>;
          } catch {
            report = { summary: reportTemplate };
          }
        }
        const request = await this.approvalManager.createRequest({
          workflowRunId: runId,
          stepId: step.id,
          report,
          timeoutMs,
        });
        this.logger.info(
          {
            requestId: request.id,
            runId,
            timeoutMs,
          },
          'human_approval: approval request created, waiting for decision'
        );
        // Block until approved/rejected/timed-out
        await this.approvalManager.waitForDecision(request.id);
        return { approved: true, requestId: request.id };
      }

      case 'ci_trigger': {
        // Fire a CI/CD job and return immediately with the queued run info.
        const provider = String(cfg.provider ?? 'github-actions');
        const owner = this.resolveTemplate(String(cfg.owner ?? ''), ctx);
        const repo = this.resolveTemplate(String(cfg.repo ?? ''), ctx);
        const ref = this.resolveTemplate(String(cfg.ref ?? 'main'), ctx);
        const workflowId = this.resolveTemplate(String(cfg.workflowId ?? ''), ctx);
        const inputsRaw = cfg.inputs ? this.resolveTemplate(JSON.stringify(cfg.inputs), ctx) : '{}';
        let inputs: Record<string, string> = {};
        try {
          inputs = JSON.parse(inputsRaw) as Record<string, string>;
        } catch {
          this.logger.warn(
            { inputsRaw, stepId: step.id },
            'ci_trigger: inputs JSON parse failed, using empty'
          );
        }

        this.logger.info(
          {
            provider,
            owner,
            repo,
            ref,
            workflowId,
          },
          'ci_trigger: dispatching CI job'
        );

        if (provider === 'github-actions') {
          const token = this.cicdConfig?.githubToken;
          const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ ref, inputs }),
              signal: AbortSignal.timeout(CI_FETCH_TIMEOUT_MS),
            }
          );
          if (!res.ok && res.status !== 204) {
            const errBody = (await res.text()).slice(0, CI_ERROR_BODY_LIMIT);
            throw new Error(`GitHub Actions dispatch failed (${res.status}): ${errBody}`);
          }
          // GHA dispatch returns 204 — no run ID is synchronously available.
          // Return a sentinel so ci_wait can poll by listing runs.
          return {
            runId: 'dispatched',
            url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`,
            status: 'queued',
            provider,
            owner,
            repo,
            ref,
            workflowId,
          };
        }

        if (provider === 'gitlab') {
          const gitlabUrl = (this.cicdConfig?.gitlabUrl ?? 'https://gitlab.com').replace(/\/$/, '');
          const gitlabToken = this.cicdConfig?.gitlabToken;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (gitlabToken) headers['PRIVATE-TOKEN'] = gitlabToken;
          const projectId = this.resolveTemplate(String(cfg.projectId ?? ''), ctx);
          const variables = inputs;
          const variableList = Object.entries(variables).map(([key, value]) => ({ key, value }));
          const res = await fetch(
            `${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipeline`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({ ref, variables: variableList }),
              signal: AbortSignal.timeout(CI_FETCH_TIMEOUT_MS),
            }
          );
          if (!res.ok) {
            const errBody = (await res.text()).slice(0, CI_ERROR_BODY_LIMIT);
            throw new Error(`GitLab pipeline trigger failed (${res.status}): ${errBody}`);
          }
          const data = (await res.json()) as { id: number; web_url: string };
          return {
            runId: String(data.id),
            url: data.web_url,
            status: 'queued',
            provider,
            projectId,
            ref,
          };
        }

        throw new Error(
          `ci_trigger: unsupported provider "${provider}". Supported: github-actions, gitlab`
        );
      }

      case 'ci_wait': {
        // Poll a CI run until it reaches a terminal state.
        const provider = String(cfg.provider ?? 'github-actions');
        const runId = this.resolveTemplate(String(cfg.runId ?? ''), ctx);
        const pollMs = Number(cfg.pollIntervalMs ?? DEFAULT_CI_POLL_INTERVAL_MS);
        const timeoutMs = Number(cfg.timeoutMs ?? 1_800_000); // 30 min default

        this.logger.info({ provider, runId, pollMs, timeoutMs }, 'ci_wait: polling CI run');

        const deadline = Date.now() + timeoutMs;
        const startedAt = Date.now();

        if (provider === 'github-actions') {
          const owner = this.resolveTemplate(String(cfg.owner ?? ''), ctx);
          const repo = this.resolveTemplate(String(cfg.repo ?? ''), ctx);
          const token = this.cicdConfig?.githubToken;
          const headers: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          };
          if (token) headers.Authorization = `Bearer ${token}`;
          const terminalStatuses = new Set(['completed']);
          while (Date.now() < deadline) {
            const res = await fetch(
              `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`,
              { headers, signal: AbortSignal.timeout(15_000) }
            );
            if (res.ok) {
              const data = (await res.json()) as {
                status: string;
                conclusion: string;
                logs_url?: string;
                html_url: string;
              };
              if (terminalStatuses.has(data.status)) {
                return {
                  status: data.status,
                  conclusion: data.conclusion,
                  logs_url: data.logs_url ?? data.html_url,
                  durationMs: Date.now() - startedAt,
                };
              }
            }
            await new Promise((r) => setTimeout(r, pollMs));
          }
          throw new Error(
            `ci_wait: GitHub Actions run ${runId} did not complete within ${timeoutMs}ms`
          );
        }

        if (provider === 'gitlab') {
          const gitlabUrl = (this.cicdConfig?.gitlabUrl ?? 'https://gitlab.com').replace(/\/$/, '');
          const gitlabToken = this.cicdConfig?.gitlabToken;
          const projectId = this.resolveTemplate(String(cfg.projectId ?? ''), ctx);
          const headers: Record<string, string> = {};
          if (gitlabToken) headers['PRIVATE-TOKEN'] = gitlabToken;
          const terminalStatuses = new Set(['success', 'failed', 'canceled', 'skipped']);
          while (Date.now() < deadline) {
            const res = await fetch(
              `${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/pipelines/${encodeURIComponent(runId)}`,
              { headers, signal: AbortSignal.timeout(15_000) }
            );
            if (res.ok) {
              const data = (await res.json()) as { status: string; web_url: string };
              if (terminalStatuses.has(data.status)) {
                return {
                  status: data.status,
                  conclusion: data.status,
                  logs_url: data.web_url,
                  durationMs: Date.now() - startedAt,
                };
              }
            }
            await new Promise((r) => setTimeout(r, pollMs));
          }
          throw new Error(
            `ci_wait: GitLab pipeline ${runId} did not complete within ${timeoutMs}ms`
          );
        }

        throw new Error(
          `ci_wait: unsupported provider "${provider}". Supported: github-actions, gitlab`
        );
      }

      case 'diagram_generation': {
        const diagramType = String(cfg.diagramType ?? 'architecture');
        const descTemplate = String(cfg.descriptionTemplate ?? '');
        const description = this.resolveTemplate(descTemplate, ctx);
        const style = String(cfg.style ?? 'minimal');
        const format = String(cfg.format ?? 'svg');

        this.logger.info('diagram_generation: delegating to MCP excalidraw tools');

        // The diagram_generation step stores its config for downstream
        // consumption. Actual scene generation is handled by the agent step
        // preceding this one (which calls excalidraw_from_description).
        // This step acts as a typed config container for workflow orchestration.
        return {
          diagramType,
          description,
          style,
          format,
          toolChain: ['excalidraw_from_description', 'excalidraw_validate', 'excalidraw_render'],
        };
      }

      case 'document_analysis': {
        const analysisType = String(cfg.analysisType ?? 'summary');
        const docTemplate = String(cfg.documentTemplate ?? '');
        const document = this.resolveTemplate(docTemplate, ctx);
        const outputFormat = String(cfg.outputFormat ?? 'markdown');

        this.logger.info('document_analysis: delegating to PDF analysis tools');

        return {
          analysisType,
          document,
          outputFormat,
          toolChain: ['pdf_extract_text', 'pdf_extract_pages', 'pdf_analyze', 'pdf_summarize'],
        };
      }

      // ── Agnostic Crew Delegation ──────────────────────────────────────
      case 'agnostic_crew': {
        const preset = this.resolveTemplate(String(cfg.preset ?? ''), ctx);
        const title = this.resolveTemplate(String(cfg.title ?? step.name), ctx);
        const description = this.resolveTemplate(String(cfg.description ?? ''), ctx);
        const priority = String(cfg.priority ?? 'medium');
        const process = String(cfg.process ?? 'sequential');

        // Try native agnosai execution first (no HTTP round-trip)
        const nativeAgnosai = await import('../native/agnosai.js').catch(() => null);
        if (nativeAgnosai) {
          const crewSpec = JSON.stringify({
            name: title,
            agents: [
              {
                agent_key: preset || 'default',
                role: preset || 'agent',
                goal: description || title,
                tools: [],
              },
            ],
            tasks: [
              {
                description: description || title,
                priority: priority === 'high' ? 3 : priority === 'low' ? 1 : 2,
              },
            ],
            process,
          });

          const crewState = await nativeAgnosai.runCrew(crewSpec);
          if (crewState) {
            this.logger.info(
              { preset, title, priority },
              'agnostic_crew: executed via native agnosai'
            );
            return { crewId: crewState.crew_id, status: crewState.status, preset, title };
          }
        }

        // Fallback: HTTP to Agnostic platform
        if (!this.agnosticConfig) {
          throw new Error('agnostic_crew: Agnostic platform not configured and native unavailable');
        }

        const targetUrl = cfg.targetUrl
          ? this.resolveTemplate(String(cfg.targetUrl), ctx)
          : undefined;

        // SSRF guard: validate targetUrl is a public URL before forwarding to Agnostic
        if (targetUrl) {
          assertPublicUrl(targetUrl);
        }

        this.logger.info(
          { preset, title, priority },
          'agnostic_crew: submitting crew to Agnostic platform via HTTP'
        );

        const headers = await this.getAgnosticHeaders();
        const body: Record<string, unknown> = {
          title,
          description,
          priority,
          process,
          ...(preset ? { preset } : {}),
          ...(targetUrl ? { target_url: targetUrl } : {}),
        };

        const res = await fetch(`${this.agnosticConfig.url}/api/v1/crews`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CI_FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          throw new Error(
            `agnostic_crew: Agnostic API returned ${res.status}: ${errBody.slice(0, CI_ERROR_BODY_LIMIT)}`
          );
        }

        const data = (await res.json()) as { crew_id?: string; id?: string; status?: string };
        const crewId = data.crew_id ?? data.id ?? '';

        return { crewId, status: data.status ?? 'queued', preset, title };
      }

      case 'agnostic_crew_wait': {
        if (!this.agnosticConfig) {
          throw new Error('agnostic_crew_wait: Agnostic platform not configured');
        }
        const crewIdTemplate = String(cfg.crewId ?? '');
        const crewId = this.resolveTemplate(crewIdTemplate, ctx);
        if (!crewId) {
          throw new Error('agnostic_crew_wait: crewId is required');
        }

        const pollIntervalMs = Number(
          cfg.pollIntervalMs ?? this.agnosticConfig.pollIntervalMs ?? 10_000
        );
        const timeoutMs = Number(cfg.timeoutMs ?? this.agnosticConfig.timeoutMs ?? 1_800_000);

        this.logger.info(
          { crewId, pollIntervalMs, timeoutMs },
          'agnostic_crew_wait: polling Agnostic crew until completion'
        );

        const headers = await this.getAgnosticHeaders();
        const startTime = Date.now();

        const finalStatus = await this.pollUntilDone(
          async () => {
            const res = await fetch(`${this.agnosticConfig!.url}/api/v1/crews/${crewId}`, {
              headers,
              signal: AbortSignal.timeout(CI_FETCH_TIMEOUT_MS),
            });
            if (!res.ok) return 'error';
            const data = (await res.json()) as { status?: string };
            return data.status ?? 'unknown';
          },
          ['completed', 'failed', 'cancelled'],
          timeoutMs,
          pollIntervalMs
        );

        // Fetch final results
        const finalRes = await fetch(`${this.agnosticConfig.url}/api/v1/crews/${crewId}`, {
          headers,
          signal: AbortSignal.timeout(CI_FETCH_TIMEOUT_MS),
        });
        const finalData = finalRes.ok
          ? ((await finalRes.json()) as Record<string, unknown>)
          : { status: finalStatus };

        return {
          crewId,
          status: finalStatus,
          results: finalData,
          durationMs: Date.now() - startTime,
        };
      }

      // ── DAG expansion step types (Phase 150) ──────────────────────────

      case 'loop': {
        const maxIterations = Number(cfg.maxIterations ?? 100);
        const conditionExpr = cfg.conditionExpression ? String(cfg.conditionExpression) : undefined;
        const bodyStepIds = Array.isArray(cfg.stepIds) ? (cfg.stepIds as string[]) : [];

        let lastOutput: unknown = null;
        let iterations = 0;

        for (let i = 0; i < maxIterations; i++) {
          // Check break condition before each iteration (if provided)
          if (conditionExpr && i > 0) {
            const shouldStop = this.evaluateCondition(conditionExpr, ctx);
            if (shouldStop) break;
          }

          // Provide loop metadata in context
          ctx.steps[`${step.id}_iteration`] = {
            output: { index: i, iteration: i + 1 },
            status: 'completed',
          };

          // Execute each body step in order.
          // Body step configs are stored in cfg.stepConfigs keyed by step ID.
          const stepConfigs = (cfg.stepConfigs ?? Object.create(null)) as Record<
            string,
            Record<string, unknown>
          >;
          for (const bodyId of bodyStepIds) {
            const bodyConfig =
              stepConfigs[bodyId] ?? (Object.create(null) as Record<string, unknown>);
            const bodyType = (bodyConfig.type as string) ?? 'transform';
            const refStep = {
              id: `${bodyId}_loop_${i}`,
              type: bodyType as WorkflowStep['type'],
              name: `${bodyId} (iter ${i + 1})`,
              config: bodyConfig,
              dependsOn: [] as string[],
              triggerMode: 'all' as const,
              onError: 'fail' as const,
            };
            lastOutput = await this.dispatchStep(refStep, ctx, runId, workflowId);
            ctx.steps[`${bodyId}_loop_${i}`] = { output: lastOutput, status: 'completed' };
          }

          // If no body steps, just run a transform on the iteration template
          if (bodyStepIds.length === 0 && cfg.bodyTemplate) {
            lastOutput = this.resolveTemplate(String(cfg.bodyTemplate), ctx);
          }

          iterations++;
        }

        return { iterations, lastOutput };
      }

      case 'parallel_map': {
        const inputListPath = String(cfg.inputListPath ?? 'input.items');
        const maxConcurrency = Number(cfg.maxConcurrency ?? 5);

        // Resolve the input list from context
        const parts = inputListPath.trim().split('.');
        let listValue: unknown = { steps: ctx.steps, input: ctx.input };
        for (const part of parts) {
          if (listValue === null || listValue === undefined) break;
          listValue = (listValue as Record<string, unknown>)[part];
        }

        if (!Array.isArray(listValue)) {
          throw new Error(
            `parallel_map: inputListPath '${inputListPath}' did not resolve to an array`
          );
        }

        const taskTemplate = String(cfg.taskTemplate ?? '{{item}}');
        const items = listValue as unknown[];

        // Process in batches of maxConcurrency
        const results: unknown[] = [];
        for (let i = 0; i < items.length; i += maxConcurrency) {
          const batch = items.slice(i, i + maxConcurrency);
          const batchResults = await Promise.all(
            batch.map(async (item, batchIdx) => {
              const idx = i + batchIdx;
              // Create a temporary context with the current item
              const itemCtx: WorkflowEngineContext = {
                steps: { ...ctx.steps, [`${step.id}_item`]: { output: item, status: 'completed' } },
                input: { ...ctx.input, item, index: idx },
              };
              return this.resolveTemplate(taskTemplate, itemCtx);
            })
          );
          results.push(...batchResults);
        }

        return { results, count: results.length };
      }

      case 'code_execution': {
        const runtime = String(cfg.runtime ?? 'node');
        const code = cfg.codeTemplate
          ? this.resolveTemplate(String(cfg.codeTemplate), ctx)
          : String(cfg.code ?? '');
        const timeoutMs = Number(cfg.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);

        if (!code.trim()) {
          throw new Error('code_execution: code is empty');
        }
        // Cap code size to prevent resource exhaustion (100KB)
        const MAX_CODE_SIZE = 100_000;
        if (code.length > MAX_CODE_SIZE) {
          throw new Error(`code_execution: code exceeds ${MAX_CODE_SIZE} character limit`);
        }

        const RUNTIME_MAP: Record<string, string> = {
          node: 'node',
          python: 'python3',
          python3: 'python3',
          shell: 'bash',
          bash: 'bash',
        };

        const cmd = RUNTIME_MAP[runtime];
        if (!cmd) {
          throw new Error(
            `code_execution: unsupported runtime '${runtime}'. Supported: node, python3, bash`
          );
        }

        try {
          const stdout = execFileSync(cmd, ['-e', code], {
            timeout: timeoutMs,
            encoding: 'utf-8',
            maxBuffer: MAX_EXEC_BUFFER_BYTES,
          });
          return { stdout: stdout.trim(), stderr: '', exitCode: 0 };
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; status?: number };
          return {
            stdout: execErr.stdout ?? '',
            stderr: execErr.stderr ?? errorToString(err),
            exitCode: execErr.status ?? 1,
          };
        }
      }

      case 'delay': {
        const durationMs = cfg.durationMs ? Number(cfg.durationMs) : undefined;
        const untilTimestamp = cfg.untilTimestamp ? Number(cfg.untilTimestamp) : undefined;

        let delayedMs: number;
        if (untilTimestamp) {
          delayedMs = Math.max(0, untilTimestamp - Date.now());
        } else {
          delayedMs = Math.max(0, durationMs ?? 0);
        }

        // Cap delay at 1 hour to prevent runaway workflows
        const MAX_DELAY_MS = 3_600_000;
        delayedMs = Math.min(delayedMs, MAX_DELAY_MS);

        if (delayedMs > 0) {
          await new Promise((r) => setTimeout(r, delayedMs));
        }

        return { delayedMs };
      }

      case 'notification': {
        const channel = String(cfg.channel ?? 'webhook');
        const messageTemplate = String(cfg.messageTemplate ?? '');
        const message = this.resolveTemplate(messageTemplate, ctx);
        const recipients = Array.isArray(cfg.recipients) ? (cfg.recipients as string[]) : [];

        if (channel === 'webhook') {
          // Send via webhook — reuse webhook step logic
          const url = this.resolveTemplate(String(cfg.url ?? ''), ctx);
          if (!url) throw new Error('notification: url is required for webhook channel');
          assertPublicUrl(url, 'Notification webhook URL');
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, recipients, source: 'secureyeoman-workflow' }),
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
          });
          return { channel, sent: res.ok, status: res.status };
        }

        // For other channels (slack, email, discord, telegram, ntfy) — log intent.
        // Full integration requires NotificationManager wiring (future).
        this.logger.info(
          { channel, recipients, messageLength: message.length, stepId: step.id },
          'Notification step: channel delivery logged (full dispatch requires NotificationManager)'
        );
        return { channel, sent: false, pending: true, message };
      }

      case 'data_validation': {
        const dataPath = String(cfg.dataPath ?? '');
        const onFailure = String(cfg.onFailure ?? 'fail');

        // Resolve the data to validate from context
        let data: unknown;
        if (dataPath) {
          const pathParts = dataPath.trim().split('.');
          let val: unknown = { steps: ctx.steps, input: ctx.input };
          for (const p of pathParts) {
            if (val === null || val === undefined) break;
            val = (val as Record<string, unknown>)[p];
          }
          data = val;
        } else {
          // Default: validate the previous step's output
          const depIds = step.dependsOn;
          data = depIds.length > 0 ? ctx.steps[depIds[depIds.length - 1]!]?.output : null;
        }

        const schema = cfg.schema as Record<string, unknown> | undefined;
        if (!schema) {
          throw new Error('data_validation: schema is required');
        }

        // Use the existing OutputSchemaValidator
        const validation = _outputSchemaValidator.validate(data, schema);

        if (!validation.valid) {
          if (onFailure === 'fail') {
            throw new Error(`data_validation failed: ${validation.errors?.join('; ')}`);
          }
          // 'warn' or 'skip' — continue with validation result
          this.logger.warn(
            { stepId: step.id, errors: validation.errors },
            'data_validation: validation failed (non-fatal)'
          );
        }

        return { valid: validation.valid, errors: validation.errors ?? [] };
      }

      case 'cache_lookup': {
        const cacheKeyTemplate = String(cfg.cacheKey ?? '');
        const cacheKey = this.resolveTemplate(cacheKeyTemplate, ctx);

        // Check if a previous step with the same cache key produced output.
        // The convention is: steps that want to be cacheable store output at
        // ctx.steps[`cache_${key}`]. This step checks for that entry.
        const cacheStepKey = `cache_${cacheKey}`;
        const cached = ctx.steps[cacheStepKey];
        if (cached?.status === 'completed' && cached.output !== null) {
          return { hit: true, value: cached.output, cacheKey };
        }

        return { hit: false, value: null, cacheKey };
      }

      case 'a2a_delegate': {
        const peerId = this.resolveTemplate(String(cfg.peerId ?? ''), ctx);
        const taskTemplate = String(cfg.taskTemplate ?? '');
        const task = this.resolveTemplate(taskTemplate, ctx);
        const contextTemplate = cfg.contextTemplate
          ? this.resolveTemplate(String(cfg.contextTemplate), ctx)
          : undefined;
        const timeoutMs = Number(cfg.timeoutMs ?? 120_000);

        if (!peerId) throw new Error('a2a_delegate: peerId is required');
        if (!task) throw new Error('a2a_delegate: taskTemplate is required');

        // A2A delegation via HTTP to peer SY instance
        assertPublicUrl(peerId, 'A2A peer URL');
        const a2aUrl = `${peerId.replace(/\/+$/, '')}/api/v1/a2a/tasks`;

        const res = await fetch(a2aUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, context: contextTemplate }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          throw new Error(`a2a_delegate: peer returned ${res.status}: ${errBody.slice(0, 500)}`);
        }

        const result = (await res.json()) as Record<string, unknown>;
        return { taskId: result.taskId ?? result.id, result: result.result ?? result };
      }

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  // ── Polling helper ────────────────────────────────────────────

  /**
   * Poll a status function until it returns one of the terminal statuses,
   * or until the deadline is reached.
   */
  private async pollUntilDone(
    getStatus: () => Promise<string>,
    terminalStatuses: string[],
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await getStatus();
      if (terminalStatuses.includes(status)) return status;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Job did not complete within ${timeoutMs}ms timeout`);
  }

  // ── Agnostic Auth ────────────────────────────────────────────

  private agnosticToken: string | null = null;
  private agnosticTokenPromise: Promise<string | null> | null = null;

  private async getAgnosticHeaders(): Promise<Record<string, string>> {
    if (!this.agnosticConfig) return {};

    if (this.agnosticConfig.apiKey) {
      return { 'X-API-Key': this.agnosticConfig.apiKey };
    }

    // JWT auth via email/password — use promise mutex to avoid concurrent fetches
    if (!this.agnosticToken && this.agnosticConfig.email && this.agnosticConfig.password) {
      if (!this.agnosticTokenPromise) {
        this.agnosticTokenPromise = (async () => {
          const res = await fetch(`${this.agnosticConfig!.url}/api/v1/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              username: this.agnosticConfig!.email!,
              password: this.agnosticConfig!.password!,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) {
            const data = (await res.json()) as { access_token?: string };
            this.agnosticToken = data.access_token ?? null;
          }
          return this.agnosticToken;
        })();
      }
      await this.agnosticTokenPromise;
      this.agnosticTokenPromise = null;
    }

    return this.agnosticToken ? { Authorization: `Bearer ${this.agnosticToken}` } : {};
  }

  /** Parse a numeric config value, throwing on NaN. */
  private resolveNumber(raw: unknown, fallback: number, label: string): number {
    const n = Number(raw ?? fallback);
    if (isNaN(n)) throw new Error(`${label}: expected number, got '${raw}'`);
    return n;
  }

  // ── Template Resolution ───────────────────────────────────────

  resolveTemplate(template: string, ctx: WorkflowEngineContext): string {
    return szal.resolveTemplate(template, { steps: ctx.steps, input: ctx.input });
  }

  // ── Condition Validation ─────────────────────────────────────

  /**
   * Validate a condition expression at save time (static check — no execution context).
   * Returns { valid: true } or { valid: false, error: <syntax error message> }.
   */
  static validateConditionExpression(expr: string): { valid: boolean; error?: string } {
    return safeValidateCondition(expr);
  }

  /**
   * Validate all condition expressions across workflow steps.
   * Returns an array of errors (empty if all valid).
   */
  static validateWorkflowConditions(
    steps: WorkflowStep[]
  ): { stepId: string; expression: string; error: string }[] {
    const errors: { stepId: string; expression: string; error: string }[] = [];
    for (const step of steps) {
      const condition = (step as Record<string, unknown>).condition as string | undefined;
      if (condition) {
        const result = WorkflowEngine.validateConditionExpression(condition);
        if (!result.valid) {
          errors.push({ stepId: step.id, expression: condition, error: result.error! });
        }
      }
    }
    return errors;
  }

  // ── Condition Evaluation ──────────────────────────────────────

  evaluateCondition(expr: string, ctx: WorkflowEngineContext): boolean {
    try {
      // Try szal's Rust-backed evaluator first (== != && || path resolution)
      // Fall back to safe-eval for expressions with comparison operators (> < >= <=)
      const context = { steps: ctx.steps, input: ctx.input };
      if (/[<>]/.test(expr)) {
        return safeEvalCondition(expr, context);
      }
      return szal.evaluateCondition(expr, context);
    } catch (err) {
      this.logger.warn(
        {
          expression: expr,
          error: errorToString(err),
        },
        'Workflow condition evaluation failed'
      );
      return false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private buildOutput(ctx: WorkflowEngineContext): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [id, step] of Object.entries(ctx.steps)) {
      output[id] = step.output;
    }
    return output;
  }
}
