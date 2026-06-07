/**
 * CouncilManager — Orchestrates multi-round group deliberation where agents
 * see each other's positions, rebut, and converge toward a decision.
 *
 * A Council is a self-contained deliberation engine. It hides all internal
 * complexity (rounds, voting, convergence) and exposes a single `convene()` call.
 */

import type { SecureLogger } from '../logging/logger.js';
import type { SubAgentManager } from './manager.js';
import { CouncilStorage } from './council-storage.js';
import { CATALOG_COUNCIL_TEMPLATES } from './council-catalog.js';
import { AIClient } from '../ai/client.js';
import type {
  CouncilTemplate,
  CouncilTemplateCreate,
  CouncilRun,
  CouncilRunParams,
  CouncilPosition,
} from '@secureyeoman/shared';
import { errorToString } from '../utils/errors.js';

export interface CouncilManagerDeps {
  storage: CouncilStorage;
  subAgentManager: SubAgentManager;
  aiClientConfig: { model: { provider: string; model: string } & Record<string, unknown> };
  aiClientDeps: Record<string, unknown>;
  logger: SecureLogger;
}

export class CouncilManager {
  private readonly storage: CouncilStorage;
  private readonly subAgentManager: SubAgentManager;
  private readonly aiClientConfig: CouncilManagerDeps['aiClientConfig'];
  private readonly aiClientDeps: Record<string, unknown>;
  private readonly logger: SecureLogger;

  constructor(deps: CouncilManagerDeps) {
    this.storage = deps.storage;
    this.subAgentManager = deps.subAgentManager;
    this.aiClientConfig = deps.aiClientConfig;
    this.aiClientDeps = deps.aiClientDeps;
    this.logger = deps.logger;
  }

  async initialize(): Promise<void> {
    // No builtin templates — council_templates table starts empty.
    // Templates are installed explicitly via catalog or community sync.
    this.logger.debug('CouncilManager initialized (no built-in templates)');
  }

  // ── Catalog ─────────────────────────────────────────────────────

  getCatalog(): CouncilTemplateCreate[] {
    return CATALOG_COUNCIL_TEMPLATES;
  }

  async installFromCatalog(name: string): Promise<CouncilTemplate> {
    const entry = CATALOG_COUNCIL_TEMPLATES.find((t) => t.name === name);
    if (!entry) throw new Error(`Catalog template not found: ${name}`);

    const existing = await this.storage.getTemplateByName(name);
    if (existing) throw new Error(`Template already installed: ${name}`);

    return this.storage.createTemplate(entry);
  }

  // ── Templates ───────────────────────────────────────────────────

  async listTemplates(opts?: {
    limit?: number;
    offset?: number;
  }): Promise<{ templates: CouncilTemplate[]; total: number }> {
    return this.storage.listTemplates(opts);
  }

  async getTemplate(id: string): Promise<CouncilTemplate | null> {
    return this.storage.getTemplate(id);
  }

  async createTemplate(data: CouncilTemplateCreate): Promise<CouncilTemplate> {
    return this.storage.createTemplate(data);
  }

  async updateTemplate(
    id: string,
    data: Partial<CouncilTemplateCreate>
  ): Promise<CouncilTemplate | null> {
    const existing = await this.storage.getTemplate(id);
    if (!existing) return null;
    if (existing.isBuiltin) throw new Error('Cannot edit built-in templates');
    return this.storage.updateTemplate(id, data);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.storage.deleteTemplate(id);
  }

  // ── Runs ────────────────────────────────────────────────────────

  async getRun(id: string): Promise<CouncilRun | null> {
    const run = await this.storage.getRun(id);
    if (!run) return null;
    const positions = await this.storage.getPositionsForRun(id);
    return { ...run, positions };
  }

  async listRuns(filter?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ runs: CouncilRun[]; total: number }> {
    return this.storage.listRuns(filter);
  }

  async cancelRun(id: string): Promise<void> {
    const run = await this.storage.getRun(id);
    if (!run) throw new Error(`Council run not found: ${id}`);
    if (run.status !== 'pending' && run.status !== 'running') {
      throw new Error(`Cannot cancel council in status: ${run.status}`);
    }
    await this.storage.updateRun(id, { status: 'cancelled', completedAt: Date.now() });
  }

  // ── Convene (main entry point) ──────────────────────────────────

  async convene(params: CouncilRunParams): Promise<CouncilRun> {
    const template = await this.storage.getTemplate(params.templateId);
    if (!template) {
      throw new Error(`Council template not found: ${params.templateId}`);
    }

    const run = await this.storage.createRun(params, template);
    await this.storage.updateRun(run.id, { status: 'running', startedAt: Date.now() });

    try {
      const maxRounds = params.maxRounds ?? template.maxRounds;
      const tokenBudget = params.tokenBudget ?? 500000;
      // Budget: divide across all member calls + facilitator calls
      const callsEstimate = template.members.length * maxRounds + 2;
      const perCallBudget = Math.floor(tokenBudget / callsEstimate);
      let tokensUsed = 0;

      // ── Round loop ──────────────────────────────────────────────
      let completedRounds = 0;

      for (let round = 1; round <= maxRounds; round++) {
        // Get prior round positions for context (round 2+)
        const priorPositions =
          round > 1 ? await this.storage.getPositionsForRound(run.id, round - 1) : [];

        // ── Position phase — parallel dispatch to all members ────
        const memberResults = await Promise.allSettled(
          template.members.map(async (member) => {
            const prompt = this.buildMemberPrompt(member, template, params, round, priorPositions);
            const delegation = await this.subAgentManager.delegate({
              profile: member.profileName,
              task: prompt,
              maxTokenBudget: perCallBudget,
            });
            tokensUsed += delegation.tokenUsage?.total ?? 0;
            return { member, response: delegation.result ?? '' };
          })
        );

        // Parse and store positions
        for (const settledResult of memberResults) {
          if (settledResult.status === 'fulfilled') {
            const { member, response } = settledResult.value;
            const parsed = this.parsePositionResponse(response, round);
            await this.storage.createPosition({
              councilRunId: run.id,
              memberRole: member.role,
              profileName: member.profileName,
              round,
              position: parsed.position,
              confidence: parsed.confidence,
              keyPoints: parsed.keyPoints,
              agreements: parsed.agreements,
              disagreements: parsed.disagreements,
            });
          } else {
            // Record failed member position
            const memberIndex = memberResults.indexOf(settledResult);
            const member = template.members[memberIndex]!;
            await this.storage.createPosition({
              councilRunId: run.id,
              memberRole: member.role,
              profileName: member.profileName,
              round,
              position: `Error: ${errorToString(settledResult.reason)}`,
              confidence: 0,
              keyPoints: [],
              agreements: [],
              disagreements: [],
            });
          }
        }

        completedRounds = round;
        await this.storage.updateRun(run.id, { completedRounds: round });

        // ── Convergence check (until_consensus only) ─────────────
        if (template.deliberationStrategy === 'until_consensus' && round < maxRounds) {
          const roundPositions = await this.storage.getPositionsForRound(run.id, round);
          const converged = await this.checkConvergence(
            roundPositions,
            params.topic,
            perCallBudget
          );
          tokensUsed += converged.tokensUsed;
          if (converged.result) {
            this.logger.debug(
              {
                runId: run.id,
                round,
                reasoning: converged.reasoning,
              },
              'Council reached convergence'
            );
            break;
          }
        }

        // single_pass: only 1 round
        if (template.deliberationStrategy === 'single_pass') break;
      }

      // ── Synthesis ───────────────────────────────────────────────
      const allPositions = await this.storage.getPositionsForRun(run.id);
      const synthesis = await this.synthesize(template, params.topic, allPositions, perCallBudget);
      tokensUsed += synthesis.tokensUsed;

      await this.storage.updateRun(run.id, {
        status: 'completed',
        completedRounds,
        decision: synthesis.decision,
        consensus: synthesis.consensus,
        dissents: synthesis.dissents,
        reasoning: synthesis.reasoning,
        confidence: synthesis.confidence,
        tokensUsed,
        completedAt: Date.now(),
      });
    } catch (err) {
      const msg = errorToString(err);
      this.logger.error({ runId: run.id, error: msg }, 'Council deliberation failed');
      await this.storage.updateRun(run.id, {
        status: 'failed',
        decision: `Error: ${msg}`,
        completedAt: Date.now(),
      });
    }

    return (await this.getRun(run.id))!;
  }

  // ── Member prompts ──────────────────────────────────────────────

  private buildMemberPrompt(
    member: CouncilTemplate['members'][number],
    template: CouncilTemplate,
    params: CouncilRunParams,
    round: number,
    priorPositions: CouncilPosition[]
  ): string {
    const parts: string[] = [];

    parts.push(`You are serving as ${member.role} on a council deliberating the following topic.`);
    if (member.perspective) {
      parts.push(`Your perspective: ${member.perspective}`);
    }
    parts.push(`Topic: ${params.topic}`);
    if (params.context) {
      parts.push(`Context: ${params.context}`);
    }

    if (round === 1) {
      parts.push('');
      parts.push('Provide your position as JSON:');
      parts.push('{ "position": "...", "confidence": 0.0-1.0, "keyPoints": ["..."] }');
    } else {
      parts.push('');
      parts.push(`This is deliberation round ${round}.`);
      parts.push('Positions from the previous round:');
      for (const pos of priorPositions) {
        parts.push(`  [${pos.memberRole}] (confidence: ${pos.confidence}): ${pos.position}`);
        if (pos.keyPoints.length > 0) {
          parts.push(`    Key points: ${pos.keyPoints.join('; ')}`);
        }
      }
      parts.push('');
      parts.push('Revise or maintain your stance. Respond as JSON:');
      parts.push(
        '{ "position": "...", "confidence": 0.0-1.0, "keyPoints": [...], "agreements": [...], "disagreements": [...] }'
      );
    }

    return parts.join('\n');
  }

  // ── Response parsing ────────────────────────────────────────────

  private parsePositionResponse(
    response: string,
    _round: number
  ): {
    position: string;
    confidence: number;
    keyPoints: string[];
    agreements: string[];
    disagreements: string[];
  } {
    try {
      const jsonMatch = /\{[\s\S]*\}/.exec(response);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          position: String(parsed.position ?? response),
          confidence:
            typeof parsed.confidence === 'number'
              ? Math.min(1, Math.max(0, parsed.confidence))
              : 0.5,
          keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.map(String) : [],
          agreements: Array.isArray(parsed.agreements) ? parsed.agreements.map(String) : [],
          disagreements: Array.isArray(parsed.disagreements)
            ? parsed.disagreements.map(String)
            : [],
        };
      }
    } catch {
      // JSON parse failed — fall through to free-text fallback
    }

    // Fallback: treat entire response as the position
    return {
      position: response,
      confidence: 0.5,
      keyPoints: [],
      agreements: [],
      disagreements: [],
    };
  }

  // ── Convergence check ───────────────────────────────────────────

  private async checkConvergence(
    positions: CouncilPosition[],
    topic: string,
    tokenBudget: number
  ): Promise<{ result: boolean; reasoning: string; tokensUsed: number }> {
    const positionSummary = positions
      .map((p) => `[${p.memberRole}] (confidence: ${p.confidence}): ${p.position}`)
      .join('\n');

    const prompt = `You are a facilitator reviewing council deliberation positions on the topic: "${topic}"

Current positions:
${positionSummary}

Have the members converged on a shared position? Respond ONLY with JSON:
{ "converged": true/false, "reasoning": "..." }`;

    try {
      const aiClient = new AIClient(this.aiClientConfig as any, this.aiClientDeps);
      const response = await aiClient.chat({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: Math.min(tokenBudget, 1000),
        stream: false,
      });
      const text = typeof response.content === 'string' ? response.content : '';
      const tokensUsed = response.usage?.totalTokens ?? 0;

      const jsonMatch = /\{[\s\S]*\}/.exec(text);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          result: Boolean(parsed.converged),
          reasoning: String(parsed.reasoning ?? ''),
          tokensUsed,
        };
      }
      return { result: false, reasoning: 'Failed to parse convergence check', tokensUsed };
    } catch {
      return { result: false, reasoning: 'Convergence check failed', tokensUsed: 0 };
    }
  }

  // ── Synthesis ───────────────────────────────────────────────────

  private async synthesize(
    template: CouncilTemplate,
    topic: string,
    positions: CouncilPosition[],
    tokenBudget: number
  ): Promise<{
    decision: string;
    consensus: 'full' | 'majority' | 'split';
    dissents: string[];
    reasoning: string;
    confidence: number;
    tokensUsed: number;
  }> {
    // Group positions by round for a clear deliberation history
    const roundMap = new Map<number, CouncilPosition[]>();
    for (const pos of positions) {
      const arr = roundMap.get(pos.round) ?? [];
      arr.push(pos);
      roundMap.set(pos.round, arr);
    }

    const historyParts: string[] = [];
    for (const [round, roundPositions] of [...roundMap.entries()].sort((a, b) => a[0] - b[0])) {
      historyParts.push(`--- Round ${round} ---`);
      for (const pos of roundPositions) {
        historyParts.push(`[${pos.memberRole}] (confidence: ${pos.confidence}): ${pos.position}`);
        if (pos.keyPoints.length > 0)
          historyParts.push(`  Key points: ${pos.keyPoints.join('; ')}`);
        if (pos.agreements.length > 0)
          historyParts.push(`  Agrees with: ${pos.agreements.join('; ')}`);
        if (pos.disagreements.length > 0)
          historyParts.push(`  Disagrees with: ${pos.disagreements.join('; ')}`);
      }
    }

    const prompt = `You are the facilitator of a council that has deliberated on the following topic.
Topic: "${topic}"
Voting strategy: ${template.votingStrategy}

Full deliberation history:
${historyParts.join('\n')}

Synthesize a final decision. Respond ONLY with JSON:
{
  "decision": "The final decision or recommendation...",
  "consensus": "full" | "majority" | "split",
  "dissents": ["Any minority positions..."],
  "reasoning": "How this decision was reached...",
  "confidence": 0.0-1.0
}`;

    try {
      const aiClient = new AIClient(this.aiClientConfig as any, this.aiClientDeps);
      const response = await aiClient.chat({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: Math.min(tokenBudget, 2000),
        stream: false,
      });
      const text = typeof response.content === 'string' ? response.content : '';
      const tokensUsed = response.usage?.totalTokens ?? 0;

      const jsonMatch = /\{[\s\S]*\}/.exec(text);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          decision: String(parsed.decision ?? 'No decision reached'),
          consensus: ['full', 'majority', 'split'].includes(parsed.consensus)
            ? parsed.consensus
            : 'split',
          dissents: Array.isArray(parsed.dissents) ? parsed.dissents.map(String) : [],
          reasoning: String(parsed.reasoning ?? ''),
          confidence:
            typeof parsed.confidence === 'number'
              ? Math.min(1, Math.max(0, parsed.confidence))
              : 0.5,
          tokensUsed,
        };
      }

      // Fallback: use the raw text as the decision
      return {
        decision: text || 'No decision reached',
        consensus: 'split',
        dissents: [],
        reasoning: 'Could not parse structured synthesis',
        confidence: 0.3,
        tokensUsed,
      };
    } catch (err) {
      return {
        decision: `Synthesis failed: ${errorToString(err)}`,
        consensus: 'split',
        dissents: [],
        reasoning: 'Synthesis call failed',
        confidence: 0,
        tokensUsed: 0,
      };
    }
  }
}
