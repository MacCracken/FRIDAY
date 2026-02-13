/**
 * Task History Component
 *
 * Displays historical task execution with filtering, date range, pagination, and export
 */

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
  Download,
  Calendar,
  Plus,
  X,
  Edit2,
  Trash2,
} from 'lucide-react';
import { fetchTasks, createTask, deleteTask, updateTask, fetchHeartbeatTasks } from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { Task, HeartbeatTask } from '../types';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="w-4 h-4 text-success" />,
  failed: <XCircle className="w-4 h-4 text-destructive" />,
  timeout: <AlertTriangle className="w-4 h-4 text-warning" />,
  running: <Loader2 className="w-4 h-4 text-info animate-spin" />,
  pending: <Clock className="w-4 h-4 text-muted-foreground" />,
  cancelled: <XCircle className="w-4 h-4 text-muted-foreground" />,
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'badge-success',
  failed: 'badge-error',
  timeout: 'badge-warning',
  running: 'badge-info',
  pending: 'badge',
  cancelled: 'badge',
};

const TYPE_OPTIONS = ['execute', 'query', 'file', 'network', 'system'] as const;

interface DatePreset {
  label: string;
  getRange: () => { from: string; to: string };
}

const DATE_PRESETS: DatePreset[] = [
  {
    label: 'Last hour',
    getRange: () => ({
      from: new Date(Date.now() - 3600000).toISOString(),
      to: new Date().toISOString(),
    }),
  },
  {
    label: 'Last 24h',
    getRange: () => ({
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date().toISOString(),
    }),
  },
  {
    label: 'Last 7 days',
    getRange: () => ({
      from: new Date(Date.now() - 604800000).toISOString(),
      to: new Date().toISOString(),
    }),
  },
  {
    label: 'All time',
    getRange: () => ({ from: '', to: '' }),
  },
];

export function TaskHistory() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const statusFilter = searchParams.get('status') ?? '';
  const typeFilter = searchParams.get('type') ?? '';
  const dateFrom = searchParams.get('from') ?? '';
  const dateTo = searchParams.get('to') ?? '';
  const [page, setPage] = useState(0);
  const [datePreset, setDatePreset] = useState<string>('');
  const pageSize = 10;

  // Create task dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTask, setNewTask] = useState({
    name: '',
    type: 'execute',
    description: '',
    input: '',
  });

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
        return next;
      });
    },
    [setSearchParams]
  );

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter, typeFilter, dateFrom, dateTo, page],
    queryFn: () =>
      fetchTasks({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    staleTime: 5000,
    refetchInterval: false,
  });

  const { data: heartbeatData } = useQuery({
    queryKey: ['heartbeat-tasks'],
    queryFn: fetchHeartbeatTasks,
    staleTime: 30000,
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: { name: string; type?: string; description?: string; input?: unknown }) =>
      createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowCreateDialog(false);
      setNewTask({ name: '', type: 'execute', description: '', input: '' });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name?: string; type?: string; description?: string };
    }) => updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setEditTask(null);
    },
  });

  const [editTask, setEditTask] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);

  // Handle query params for quick create from sidebar
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      const pName = searchParams.get('name') || '';
      const pType = searchParams.get('type') || 'execute';
      const pDescription = searchParams.get('description') || '';
      const pInput = searchParams.get('input') || '';
      if (pName) {
        setNewTask({ name: pName, type: pType, description: pDescription, input: pInput });
        let parsedInput: unknown;
        try {
          parsedInput = pInput ? JSON.parse(pInput) : undefined;
        } catch {
          parsedInput = undefined;
        }
        setTimeout(
          () =>
            createTaskMutation.mutate({
              name: pName,
              type: pType,
              description: pDescription || undefined,
              input: parsedInput,
            }),
          0
        );
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, createTaskMutation]);

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const resetFilters = () => {
    setSearchParams({});
    setPage(0);
    setDatePreset('Last 24h');
  };

  const hasFilters = statusFilter || typeFilter || dateFrom || dateTo;

  const handleDatePreset = (preset: DatePreset) => {
    const { from, to } = preset.getRange();
    setDatePreset(preset.label);
    updateParams({ from, to });
    setPage(0);
  };

  const handleCustomDate = (field: 'from' | 'to', value: string) => {
    const iso = value ? new Date(value).toISOString() : '';
    updateParams({ [field]: iso });
    setDatePreset('');
    setPage(0);
  };

  // ── Export ──────────────────────────────────────────────────
  const exportData = useCallback(
    async (format: 'csv' | 'json') => {
      const allData = await fetchTasks({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        from: dateFrom || undefined,
        to: dateTo || undefined,
        limit: 10000,
        offset: 0,
      });

      let content: string;
      let mimeType: string;
      let ext: string;

      if (format === 'json') {
        content = JSON.stringify(allData.tasks, null, 2);
        mimeType = 'application/json';
        ext = 'json';
      } else {
        const headers = ['ID', 'Name', 'Type', 'Status', 'Duration (ms)', 'Created At'];
        const rows = allData.tasks.map((t) => [
          t.id,
          `"${t.name.replace(/"/g, '""')}"`,
          t.type,
          t.status,
          t.durationMs?.toString() ?? '',
          new Date(t.createdAt).toISOString(),
        ]);
        content = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        mimeType = 'text/csv';
        ext = 'csv';
      }

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tasks-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [statusFilter, typeFilter, dateFrom, dateTo]
  );

  return (
    <div className="space-y-4">
      {/* Create Task Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 w-full max-w-md shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Create New Task</h3>
              <button onClick={() => setShowCreateDialog(false)} className="btn-ghost p-1 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={newTask.name}
                  onChange={(e) => setNewTask({ ...newTask, name: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                  placeholder="e.g., Run backup"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={newTask.type}
                  onChange={(e) => setNewTask({ ...newTask, type: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Input (JSON)</label>
                <textarea
                  value={newTask.input}
                  onChange={(e) => setNewTask({ ...newTask, input: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background font-mono text-sm"
                  rows={3}
                  placeholder='{"key": "value"}'
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowCreateDialog(false)} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    let parsedInput: unknown;
                    try {
                      parsedInput = newTask.input ? JSON.parse(newTask.input) : undefined;
                    } catch {
                      return; // Invalid JSON — do not submit
                    }
                    createTaskMutation.mutate({
                      name: newTask.name,
                      type: newTask.type,
                      description: newTask.description || undefined,
                      input: parsedInput,
                    });
                  }}
                  disabled={!newTask.name.trim() || createTaskMutation.isPending}
                  className="btn btn-primary"
                >
                  {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Task"
        message={deleteTarget ? `Are you sure you want to delete "${deleteTarget.name}"?` : ''}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) deleteTaskMutation.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Edit Task Dialog */}
      {editTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 w-full max-w-md shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Task</h3>
              <button onClick={() => setEditTask(null)} className="btn-ghost p-1 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name *</label>
                <input
                  type="text"
                  value={editTask.name}
                  onChange={(e) => setEditTask({ ...editTask, name: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={editTask.type}
                  onChange={(e) => setEditTask({ ...editTask, type: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input
                  type="text"
                  value={editTask.description || ''}
                  onChange={(e) => setEditTask({ ...editTask, description: e.target.value })}
                  className="w-full px-3 py-2 rounded border bg-background"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditTask(null)} className="btn btn-ghost">
                  Cancel
                </button>
                <button
                  onClick={() =>
                    updateTaskMutation.mutate({
                      id: editTask.id,
                      data: {
                        name: editTask.name,
                        type: editTask.type,
                        description: editTask.description || undefined,
                      },
                    })
                  }
                  disabled={!editTask.name.trim() || updateTaskMutation.isPending}
                  className="btn btn-primary"
                >
                  {updateTaskMutation.isPending ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Task History</h2>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="btn btn-primary text-sm px-3 py-1.5 flex items-center gap-1"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              updateParams({ status: e.target.value });
              setPage(0);
            }}
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
            aria-label="Filter by status"
          >
            <option value="">All Status</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
            <option value="pending">Pending</option>
            <option value="timeout">Timeout</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => {
              updateParams({ type: e.target.value });
              setPage(0);
            }}
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
            aria-label="Filter by type"
          >
            <option value="">All Types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={resetFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Date Range Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handleDatePreset(preset)}
              className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                datePreset === preset.label
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted border-border'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFrom ? dateFrom.slice(0, 10) : ''}
            onChange={(e) => handleCustomDate('from', e.target.value)}
            className="px-2 py-1 text-xs border rounded-md bg-background"
            aria-label="From date"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={dateTo ? dateTo.slice(0, 10) : ''}
            onChange={(e) => handleCustomDate('to', e.target.value)}
            className="px-2 py-1 text-xs border rounded-md bg-background"
            aria-label="To date"
          />
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => void exportData('csv')}
            className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
            aria-label="Export CSV"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
          <button
            onClick={() => void exportData('json')}
            className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
            aria-label="Export JSON"
          >
            <Download className="w-3 h-3" /> JSON
          </button>
        </div>
      </div>

      {/* Task Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-2 py-2 text-left font-medium text-xs hidden sm:table-cell">ID</th>
                <th className="px-2 py-2 text-left font-medium text-xs">Name</th>
                <th className="px-2 py-2 text-left font-medium text-xs hidden md:table-cell">
                  Type
                </th>
                <th className="px-2 py-2 text-left font-medium text-xs">Status</th>
                <th className="px-2 py-2 text-left font-medium text-xs hidden lg:table-cell">
                  Duration
                </th>
                <th className="px-2 py-2 text-left font-medium text-xs hidden sm:table-cell">
                  Created
                </th>
                <th className="px-2 py-2 text-left font-medium text-xs w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                    <p className="mt-2">Loading tasks...</p>
                  </td>
                </tr>
              ) : (
                <>
                  {tasks.length === 0 && !heartbeatData?.tasks?.length && (
                    <tr>
                      <td colSpan={7} className="px-2 py-8 text-center text-muted-foreground">
                        No tasks found
                      </td>
                    </tr>
                  )}
                  {tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onEdit={setEditTask}
                      onDelete={(t) => setDeleteTarget(t)}
                    />
                  ))}
                  {heartbeatData?.tasks && heartbeatData.tasks.length > 0 && (
                    <>
                      <tr className="bg-muted/30">
                        <td
                          colSpan={7}
                          className="px-2 py-2 text-xs font-medium text-muted-foreground"
                        >
                          Heartbeat Tasks
                          {heartbeatData.tasks[0]?.personalityName && (
                            <span className="ml-1 font-normal">
                              — {heartbeatData.tasks[0].personalityName}
                            </span>
                          )}
                        </td>
                      </tr>
                      {heartbeatData.tasks.map((task) => (
                        <HeartbeatTaskRow key={task.name} task={task} />
                      ))}
                    </>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
            <p className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-ghost p-2 disabled:opacity-50"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn-ghost p-2 disabled:opacity-50"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task,
  onEdit,
  onDelete,
}: {
  task: Task;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}) {
  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 60000) return 'Just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-2 py-3 font-mono text-xs hidden sm:table-cell">{task.id.slice(0, 8)}...</td>
      <td className="px-2 py-3">
        <div className="font-medium text-sm">{task.name}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-xs">
            {task.description}
          </div>
        )}
      </td>
      <td className="px-2 py-3 hidden md:table-cell">
        <span className="px-1.5 py-0.5 text-xs bg-muted rounded">{task.type}</span>
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center gap-1.5">
          {STATUS_ICONS[task.status]}
          <span className={`text-xs ${STATUS_COLORS[task.status]}`}>{task.status}</span>
        </div>
        {task.result?.error && (
          <div className="text-xs text-destructive mt-1 truncate max-w-[100px]">
            {task.result.error.message}
          </div>
        )}
      </td>
      <td className="px-2 py-3 font-mono text-xs hidden lg:table-cell">
        {formatDuration(task.durationMs)}
      </td>
      <td className="px-2 py-3 text-muted-foreground text-xs hidden sm:table-cell">
        {formatTime(task.createdAt)}
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              onClick={() => onEdit(task)}
              className="btn-ghost p-1.5 rounded"
              title="Edit task"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(task)}
              className="btn-ghost p-1.5 rounded text-destructive hover:text-destructive"
              title="Delete task"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function HeartbeatTaskRow({ task }: { task: HeartbeatTask }) {
  const formatTime = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 60000) return 'Just now';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  const formatInterval = (ms: number) => {
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    return `${Math.floor(ms / 3600000)}h`;
  };

  return (
    <tr className="hover:bg-muted/30 transition-colors bg-muted/20">
      <td className="px-2 py-3 font-mono text-xs hidden sm:table-cell text-muted-foreground">
        heartbeat
      </td>
      <td className="px-2 py-3">
        <div className="font-medium text-sm flex items-center gap-2">
          {task.name}
          <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
            Heartbeat
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Every {formatInterval(task.intervalMs || 60000)}
        </div>
      </td>
      <td className="px-2 py-3 hidden md:table-cell">
        <span className="px-1.5 py-0.5 text-xs bg-muted rounded">{task.type}</span>
      </td>
      <td className="px-2 py-3">
        <div className="flex items-center gap-1.5">
          {task.enabled ? (
            <CheckCircle className="w-4 h-4 text-success" />
          ) : (
            <XCircle className="w-4 h-4 text-muted-foreground" />
          )}
          <span className={`text-xs ${task.enabled ? 'text-success' : 'text-muted-foreground'}`}>
            {task.enabled ? 'Active' : 'Disabled'}
          </span>
        </div>
      </td>
      <td className="px-2 py-3 font-mono text-xs hidden lg:table-cell text-muted-foreground">
        {formatInterval(task.intervalMs || 60000)}
      </td>
      <td className="px-2 py-3 text-muted-foreground text-xs hidden sm:table-cell">
        {formatTime(task.lastRunAt)}
      </td>
      <td className="px-2 py-3">
        <span className="text-xs text-muted-foreground italic">
          {task.personalityName ? `Managed by ${task.personalityName}` : 'Managed by Personality'}
        </span>
      </td>
    </tr>
  );
}
