/**
 * Szal stub — the native NAPI module is gone.
 * Critical-path functions (topologicalSort, evaluateCondition, resolveTemplate)
 * have self-contained JS fallback implementations. Other functions return
 * trivial stubs.
 */

// ── Step shape used by topologicalSort ───────────────────────────────────────

interface SzalStep {
  id: string;
  dependsOn?: string[];
  triggerMode?: 'all' | 'any';
}

// ── Kahn's algorithm — topological sort returning execution layers ────────────

/**
 * Topological sort via Kahn's algorithm.
 * Returns an array of layers (each layer is a list of step IDs that can run
 * in parallel). Throws if the graph contains a cycle.
 */
export function topologicalSort(steps: SzalStep[]): string[][] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // id → steps that depend on id

  for (const step of steps) {
    if (!inDegree.has(step.id)) inDegree.set(step.id, 0);
    if (!dependents.has(step.id)) dependents.set(step.id, []);
    for (const dep of step.dependsOn ?? []) {
      inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(step.id);
    }
  }

  const layers: string[][] = [];
  let frontier = steps.filter((s) => (inDegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  let visited = 0;

  while (frontier.length > 0) {
    layers.push(frontier);
    visited += frontier.length;
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependent of dependents.get(id) ?? []) {
        const deg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0) next.push(dependent);
      }
    }
    frontier = next;
  }

  if (visited !== steps.length) {
    throw new Error('szal: cycle detected in workflow DAG');
  }

  return layers;
}

// ── Simple condition evaluator ────────────────────────────────────────────────

/**
 * Evaluates a simple boolean condition expression against a context object.
 * Supports: ==, !=, &&, ||, path resolution (e.g. steps.step1.output).
 * Does NOT support comparison operators (>, <, >=, <=) — the workflow engine
 * falls back to safeEvalCondition for those.
 */
export function evaluateCondition(expr: string, context: Record<string, unknown>): boolean {
  // Strip outer whitespace
  const e = expr.trim();

  // OR — lowest precedence, split on first ||
  const orIdx = findOperatorOutsideParens(e, '||');
  if (orIdx !== -1) {
    return (
      evaluateCondition(e.slice(0, orIdx), context) ||
      evaluateCondition(e.slice(orIdx + 2), context)
    );
  }

  // AND — split on first &&
  const andIdx = findOperatorOutsideParens(e, '&&');
  if (andIdx !== -1) {
    return (
      evaluateCondition(e.slice(0, andIdx), context) &&
      evaluateCondition(e.slice(andIdx + 2), context)
    );
  }

  // Equality / inequality
  const neqIdx = e.indexOf('!=');
  if (neqIdx !== -1) {
    const left = resolvePath(e.slice(0, neqIdx).trim(), context);
    const right = parseValue(e.slice(neqIdx + 2).trim(), context);
    return left !== right;
  }
  const eqIdx = e.indexOf('==');
  if (eqIdx !== -1) {
    const left = resolvePath(e.slice(0, eqIdx).trim(), context);
    const right = parseValue(e.slice(eqIdx + 2).trim(), context);
    return left === right;
  }

  // Bare truthy path
  const val = resolvePath(e, context);
  return Boolean(val);
}

/** Find index of a two-char operator that is not inside parentheses. */
function findOperatorOutsideParens(expr: string, op: string): number {
  let depth = 0;
  for (let i = 0; i < expr.length - 1; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')') depth--;
    else if (depth === 0 && expr.slice(i, i + op.length) === op) return i;
  }
  return -1;
}

/** Resolve a dot-path like "steps.step1.output" against context. */
function resolvePath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let cur: unknown = context;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Parse a literal value or resolve a path. */
function parseValue(token: string, context: Record<string, unknown>): unknown {
  if (token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
  if (token.startsWith("'") && token.endsWith("'")) return token.slice(1, -1);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  const num = Number(token);
  if (!isNaN(num)) return num;
  return resolvePath(token, context);
}

// ── Template resolver ─────────────────────────────────────────────────────────

/**
 * Resolve {{path}} placeholders in a template string.
 * Paths are resolved against context using dot notation.
 */
export function resolveTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const val = resolvePath(path.trim(), context);
    return val != null ? String(val) : '';
  });
}

// ── Trivial stubs ─────────────────────────────────────────────────────────────

export function validateFlow(_flowJson: string): { valid: boolean } {
  return { valid: true };
}

export function createStep(config: Record<string, unknown>): string {
  return JSON.stringify(config);
}

export function buildDagFlow(name: string, stepsJson: string): string {
  return JSON.stringify({ name, steps: JSON.parse(stepsJson) });
}
