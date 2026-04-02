/**
 * Agnosai stub — the native NAPI orchestration engine is gone.
 * All functions return null. Consumer (agents/agnosai-bridge.ts) guards with
 * `if (!crewState) return null` before using results.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgnosaiTaskResult {
  task_id: string;
  status: string;
  output?: string;
}

export interface AgnosaiCrewState {
  crew_id: string;
  status: string;
  results: AgnosaiTaskResult[];
  profile?: {
    cost_usd?: number;
    wall_ms?: number;
  };
}

// ── Functions ─────────────────────────────────────────────────────────────────

export async function runCrew(_specJson: string): Promise<AgnosaiCrewState | null> {
  return null;
}

export async function cancelCrew(_crewId: string): Promise<void> {}

export function validateCrew(_specJson: string): string {
  return '{"valid":true}';
}

export function scheduleTasks(_tasksJson: string): string {
  return '[]';
}

export function topologicalSort(_tasksJson: string): string {
  return '[]';
}

export function routeModel(_taskType: string, _complexity: string): string | null {
  return null;
}

export function rankAgents(_agentsJson: string, _taskJson: string): string | null {
  return null;
}

export function createAgentDef(_profileJson: string): string | null {
  return null;
}

export function listBuiltinTools(): string {
  return '[]';
}

export function ucb1Select(_armsJson: string): string | null {
  return null;
}
