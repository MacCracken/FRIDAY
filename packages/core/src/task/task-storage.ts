/**
 * Task Storage — SQLite-backed persistence for task history.
 *
 * Follows the same patterns as AuthStorage, SoulStorage, and RotationStorage:
 *   WAL mode, prepared statements, explicit close().
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Task, ResourceUsage, SecurityContext, TaskError } from '@friday/shared';

// ─── Row Types ───────────────────────────────────────────────

interface TaskRow {
  id: string;
  correlation_id: string | null;
  parent_task_id: string | null;
  type: string;
  name: string;
  description: string | null;
  input_hash: string;
  status: string;
  result_json: string | null;
  resources_json: string | null;
  security_context_json: string;
  timeout_ms: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  duration_ms: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────

function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(row: TaskRow): Task {
  const result = safeJsonParse<Task['result']>(row.result_json, undefined);
  const resources = safeJsonParse<ResourceUsage | undefined>(row.resources_json, undefined);
  const securityContext = safeJsonParse<SecurityContext>(row.security_context_json, {
    userId: 'unknown',
    role: 'viewer',
    permissionsUsed: [],
  });

  return {
    id: row.id,
    correlationId: row.correlation_id ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    type: row.type as Task['type'],
    name: row.name,
    description: row.description ?? undefined,
    inputHash: row.input_hash,
    status: row.status as Task['status'],
    result,
    resources,
    securityContext,
    timeoutMs: row.timeout_ms,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationMs: row.duration_ms ?? undefined,
  };
}

// ─── Filter / Pagination ─────────────────────────────────────

export interface TaskFilter {
  status?: string;
  type?: string;
  userId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface TaskStats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
}

// ─── TaskStorage ─────────────────────────────────────────────

export class TaskStorage {
  private db: Database.Database;

  constructor(opts: { dbPath?: string } = {}) {
    const dbPath = opts.dbPath ?? ':memory:';

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        correlation_id TEXT,
        parent_task_id TEXT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        input_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        result_json TEXT,
        resources_json TEXT,
        security_context_json TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
      CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
      CREATE INDEX IF NOT EXISTS idx_tasks_correlation_id ON tasks(correlation_id);
    `);
  }

  // ─── Write Operations ──────────────────────────────────────

  storeTask(task: Task): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, correlation_id, parent_task_id, type, name, description,
           input_hash, status, result_json, resources_json, security_context_json,
           timeout_ms, created_at, started_at, completed_at, duration_ms)
         VALUES (@id, @correlation_id, @parent_task_id, @type, @name, @description,
           @input_hash, @status, @result_json, @resources_json, @security_context_json,
           @timeout_ms, @created_at, @started_at, @completed_at, @duration_ms)`,
      )
      .run({
        id: task.id,
        correlation_id: task.correlationId ?? null,
        parent_task_id: task.parentTaskId ?? null,
        type: task.type,
        name: task.name,
        description: task.description ?? null,
        input_hash: task.inputHash,
        status: task.status,
        result_json: task.result ? JSON.stringify(task.result) : null,
        resources_json: task.resources ? JSON.stringify(task.resources) : null,
        security_context_json: JSON.stringify(task.securityContext),
        timeout_ms: task.timeoutMs,
        created_at: task.createdAt,
        started_at: task.startedAt ?? null,
        completed_at: task.completedAt ?? null,
        duration_ms: task.durationMs ?? null,
      });
  }

  updateTask(
    id: string,
    updates: {
      status?: string;
      startedAt?: number;
      completedAt?: number;
      durationMs?: number;
      result?: Task['result'];
      resources?: ResourceUsage;
    },
  ): boolean {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.status !== undefined) {
      setClauses.push('status = @status');
      params.status = updates.status;
    }
    if (updates.startedAt !== undefined) {
      setClauses.push('started_at = @started_at');
      params.started_at = updates.startedAt;
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = @completed_at');
      params.completed_at = updates.completedAt;
    }
    if (updates.durationMs !== undefined) {
      setClauses.push('duration_ms = @duration_ms');
      params.duration_ms = updates.durationMs;
    }
    if (updates.result !== undefined) {
      setClauses.push('result_json = @result_json');
      params.result_json = JSON.stringify(updates.result);
    }
    if (updates.resources !== undefined) {
      setClauses.push('resources_json = @resources_json');
      params.resources_json = JSON.stringify(updates.resources);
    }

    if (setClauses.length === 0) return false;

    const info = this.db
      .prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`)
      .run(params);
    return info.changes > 0;
  }

  // ─── Read Operations ───────────────────────────────────────

  getTask(id: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  }

  listTasks(filter?: TaskFilter): { tasks: Task[]; total: number } {
    let countQuery = 'SELECT COUNT(*) as count FROM tasks WHERE 1=1';
    let dataQuery = 'SELECT * FROM tasks WHERE 1=1';
    const params: Record<string, unknown> = {};

    if (filter?.status) {
      const clause = ' AND status = @status';
      countQuery += clause;
      dataQuery += clause;
      params.status = filter.status;
    }
    if (filter?.type) {
      const clause = ' AND type = @type';
      countQuery += clause;
      dataQuery += clause;
      params.type = filter.type;
    }
    if (filter?.userId) {
      const clause = " AND json_extract(security_context_json, '$.userId') = @userId";
      countQuery += clause;
      dataQuery += clause;
      params.userId = filter.userId;
    }
    if (filter?.from) {
      const clause = ' AND created_at >= @from';
      countQuery += clause;
      dataQuery += clause;
      params.from = filter.from;
    }
    if (filter?.to) {
      const clause = ' AND created_at <= @to';
      countQuery += clause;
      dataQuery += clause;
      params.to = filter.to;
    }

    const totalRow = this.db.prepare(countQuery).get(params) as { count: number };

    dataQuery += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      dataQuery += ' LIMIT @limit';
      params.limit = filter.limit;
    }
    if (filter?.offset) {
      dataQuery += ' OFFSET @offset';
      params.offset = filter.offset;
    }

    const rows = this.db.prepare(dataQuery).all(params) as TaskRow[];
    return {
      tasks: rows.map(rowToTask),
      total: totalRow.count,
    };
  }

  // ─── Stats ─────────────────────────────────────────────────

  getStats(): TaskStats {
    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM tasks')
      .get() as { count: number };

    const statusRows = this.db
      .prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status')
      .all() as Array<{ status: string; count: number }>;

    const typeRows = this.db
      .prepare('SELECT type, COUNT(*) as count FROM tasks GROUP BY type')
      .all() as Array<{ type: string; count: number }>;

    const completedCount = statusRows.find(r => r.status === 'completed')?.count ?? 0;
    const finishedCount = statusRows
      .filter(r => ['completed', 'failed', 'timeout', 'cancelled'].includes(r.status))
      .reduce((sum, r) => sum + r.count, 0);

    const avgRow = this.db
      .prepare('SELECT AVG(duration_ms) as avg FROM tasks WHERE duration_ms IS NOT NULL')
      .get() as { avg: number | null };

    return {
      total: totalRow.count,
      byStatus: Object.fromEntries(statusRows.map(r => [r.status, r.count])),
      byType: Object.fromEntries(typeRows.map(r => [r.type, r.count])),
      successRate: finishedCount > 0 ? completedCount / finishedCount : 0,
      avgDurationMs: avgRow.avg ?? 0,
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}
