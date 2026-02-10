import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskStorage } from './task-storage.js';
import { TaskStatus, TaskType } from '@friday/shared';
import type { Task } from '@friday/shared';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: `task-${Math.random().toString(36).slice(2, 10)}`,
    type: TaskType.QUERY,
    name: 'Test Task',
    inputHash: 'a'.repeat(64),
    status: TaskStatus.PENDING,
    createdAt: now,
    timeoutMs: 300000,
    securityContext: {
      userId: 'user-1',
      role: 'admin',
      permissionsUsed: ['tasks:execute'],
    },
    ...overrides,
  };
}

describe('TaskStorage', () => {
  let storage: TaskStorage;

  beforeEach(() => {
    storage = new TaskStorage(); // in-memory
  });

  afterEach(() => {
    storage.close();
  });

  describe('storeTask / getTask', () => {
    it('stores and retrieves a task', () => {
      const task = makeTask();
      storage.storeTask(task);
      const retrieved = storage.getTask(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(task.id);
      expect(retrieved!.name).toBe('Test Task');
      expect(retrieved!.status).toBe(TaskStatus.PENDING);
      expect(retrieved!.securityContext.userId).toBe('user-1');
    });

    it('returns null for non-existent task', () => {
      expect(storage.getTask('nonexistent')).toBeNull();
    });

    it('stores task with all optional fields', () => {
      const task = makeTask({
        correlationId: 'corr-1',
        parentTaskId: 'parent-1',
        description: 'A test task',
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        durationMs: 1000,
        result: { success: true, outputHash: 'b'.repeat(64) },
        resources: {
          tokens: { input: 10, output: 20, total: 30, cached: 0 },
          memoryPeakMb: 50,
          cpuTimeMs: 500,
          networkBytes: { sent: 100, received: 200 },
          apiCalls: [{ provider: 'anthropic', endpoint: '/messages', count: 1 }],
        },
      });
      storage.storeTask(task);
      const retrieved = storage.getTask(task.id)!;
      expect(retrieved.correlationId).toBe('corr-1');
      expect(retrieved.parentTaskId).toBe('parent-1');
      expect(retrieved.description).toBe('A test task');
      expect(retrieved.result?.success).toBe(true);
      expect(retrieved.resources?.tokens.total).toBe(30);
    });
  });

  describe('updateTask', () => {
    it('updates task status', () => {
      const task = makeTask();
      storage.storeTask(task);
      const updated = storage.updateTask(task.id, {
        status: TaskStatus.RUNNING,
        startedAt: Date.now(),
      });
      expect(updated).toBe(true);
      const retrieved = storage.getTask(task.id)!;
      expect(retrieved.status).toBe(TaskStatus.RUNNING);
      expect(retrieved.startedAt).toBeDefined();
    });

    it('updates task with result and resources', () => {
      const task = makeTask({ status: TaskStatus.RUNNING });
      storage.storeTask(task);
      storage.updateTask(task.id, {
        status: TaskStatus.COMPLETED,
        completedAt: Date.now(),
        durationMs: 1234,
        result: { success: true },
        resources: {
          tokens: { input: 5, output: 15, total: 20, cached: 0 },
          memoryPeakMb: 30,
          cpuTimeMs: 1234,
          networkBytes: { sent: 0, received: 0 },
          apiCalls: [],
        },
      });
      const retrieved = storage.getTask(task.id)!;
      expect(retrieved.status).toBe(TaskStatus.COMPLETED);
      expect(retrieved.durationMs).toBe(1234);
      expect(retrieved.result?.success).toBe(true);
    });

    it('returns false for non-existent task', () => {
      expect(storage.updateTask('nope', { status: 'failed' })).toBe(false);
    });

    it('returns false when no updates given', () => {
      const task = makeTask();
      storage.storeTask(task);
      expect(storage.updateTask(task.id, {})).toBe(false);
    });
  });

  describe('listTasks', () => {
    it('lists all tasks ordered by created_at desc', () => {
      const t1 = makeTask({ id: 'a', createdAt: 1000 });
      const t2 = makeTask({ id: 'b', createdAt: 2000 });
      const t3 = makeTask({ id: 'c', createdAt: 3000 });
      storage.storeTask(t1);
      storage.storeTask(t2);
      storage.storeTask(t3);

      const { tasks, total } = storage.listTasks();
      expect(total).toBe(3);
      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe('c');
      expect(tasks[2].id).toBe('a');
    });

    it('filters by status', () => {
      storage.storeTask(makeTask({ id: 'a', status: TaskStatus.COMPLETED }));
      storage.storeTask(makeTask({ id: 'b', status: TaskStatus.FAILED }));
      storage.storeTask(makeTask({ id: 'c', status: TaskStatus.COMPLETED }));

      const { tasks, total } = storage.listTasks({ status: 'completed' });
      expect(total).toBe(2);
      expect(tasks).toHaveLength(2);
      expect(tasks.every(t => t.status === 'completed')).toBe(true);
    });

    it('filters by type', () => {
      storage.storeTask(makeTask({ id: 'a', type: TaskType.QUERY }));
      storage.storeTask(makeTask({ id: 'b', type: TaskType.EXECUTE }));

      const { tasks, total } = storage.listTasks({ type: 'query' });
      expect(total).toBe(1);
      expect(tasks[0].type).toBe('query');
    });

    it('filters by userId', () => {
      storage.storeTask(makeTask({
        id: 'a',
        securityContext: { userId: 'alice', role: 'admin', permissionsUsed: [] },
      }));
      storage.storeTask(makeTask({
        id: 'b',
        securityContext: { userId: 'bob', role: 'viewer', permissionsUsed: [] },
      }));

      const { tasks, total } = storage.listTasks({ userId: 'alice' });
      expect(total).toBe(1);
      expect(tasks[0].securityContext.userId).toBe('alice');
    });

    it('filters by time range', () => {
      storage.storeTask(makeTask({ id: 'a', createdAt: 1000 }));
      storage.storeTask(makeTask({ id: 'b', createdAt: 2000 }));
      storage.storeTask(makeTask({ id: 'c', createdAt: 3000 }));

      const { tasks, total } = storage.listTasks({ from: 1500, to: 2500 });
      expect(total).toBe(1);
      expect(tasks[0].id).toBe('b');
    });

    it('supports limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        storage.storeTask(makeTask({ id: `t-${i}`, createdAt: i * 1000 }));
      }

      const page1 = storage.listTasks({ limit: 3, offset: 0 });
      expect(page1.total).toBe(10);
      expect(page1.tasks).toHaveLength(3);

      const page2 = storage.listTasks({ limit: 3, offset: 3 });
      expect(page2.tasks).toHaveLength(3);
      expect(page2.tasks[0].id).not.toBe(page1.tasks[0].id);
    });
  });

  describe('getStats', () => {
    it('returns stats with empty database', () => {
      const stats = storage.getStats();
      expect(stats.total).toBe(0);
      expect(stats.byStatus).toEqual({});
      expect(stats.byType).toEqual({});
      expect(stats.successRate).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
    });

    it('computes stats correctly', () => {
      storage.storeTask(makeTask({ id: 'a', status: TaskStatus.COMPLETED, type: TaskType.QUERY }));
      storage.storeTask(makeTask({ id: 'b', status: TaskStatus.COMPLETED, type: TaskType.QUERY }));
      storage.storeTask(makeTask({ id: 'c', status: TaskStatus.FAILED, type: TaskType.EXECUTE }));
      storage.storeTask(makeTask({ id: 'd', status: TaskStatus.PENDING, type: TaskType.FILE }));

      // Add duration to completed tasks
      storage.updateTask('a', { durationMs: 100 });
      storage.updateTask('b', { durationMs: 200 });
      storage.updateTask('c', { durationMs: 500 });

      const stats = storage.getStats();
      expect(stats.total).toBe(4);
      expect(stats.byStatus.completed).toBe(2);
      expect(stats.byStatus.failed).toBe(1);
      expect(stats.byStatus.pending).toBe(1);
      expect(stats.byType.query).toBe(2);
      expect(stats.byType.execute).toBe(1);
      // 2 completed out of 3 finished (completed + failed)
      expect(stats.successRate).toBeCloseTo(2 / 3, 5);
      // avg of 100, 200, 500 = 266.67
      expect(stats.avgDurationMs).toBeCloseTo(266.67, 0);
    });
  });
});
