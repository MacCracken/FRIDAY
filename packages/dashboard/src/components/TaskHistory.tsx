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
} from 'lucide-react';
import { fetchTasks, createTask } from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { Task } from '../types';

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
    refetchInterval: 5000,
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

  // Handle query params for quick create from sidebar
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      const pName = searchParams.get('name') || '';
      const pType = searchParams.get('type') || 'execute';
      const pDescription = searchParams.get('description') || '';
      const pInput = searchParams.get('input') || '';
      if (pName) {
        setNewTask({ name: pName, type: pType, description: pDescription, input: pInput });
        setTimeout(
          () =>
            createTaskMutation.mutate({
              name: pName,
              type: pType,
              description: pDescription || undefined,
              input: pInput ? JSON.parse(pInput) : undefined,
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
                  onClick={() =>
                    createTaskMutation.mutate({
                      name: newTask.name,
                      type: newTask.type,
                      description: newTask.description || undefined,
                      input: newTask.input ? JSON.parse(newTask.input) : undefined,
                    })
                  }
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
                <th className="px-4 py-3 text-left font-medium">ID</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Type</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Duration</th>
                <th className="px-4 py-3 text-left font-medium hidden sm:table-cell">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    <Loader2 className="w-6 h-6 mx-auto animate-spin" />
                    <p className="mt-2">Loading tasks...</p>
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No tasks found
                  </td>
                </tr>
              ) : (
                tasks.map((task) => <TaskRow key={task.id} task={task} />)
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

function TaskRow({ task }: { task: Task }) {
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
      <td className="px-4 py-3 font-mono text-xs">{task.id.slice(0, 8)}...</td>
      <td className="px-4 py-3">
        <div className="font-medium">{task.name}</div>
        {task.description && (
          <div className="text-xs text-muted-foreground truncate max-w-xs">{task.description}</div>
        )}
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <span className="px-2 py-1 text-xs bg-muted rounded">{task.type}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {STATUS_ICONS[task.status]}
          <span className={STATUS_COLORS[task.status]}>{task.status}</span>
        </div>
        {task.result?.error && (
          <div className="text-xs text-destructive mt-1">{task.result.error.message}</div>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-xs hidden md:table-cell">
        {formatDuration(task.durationMs)}
      </td>
      <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
        {formatTime(task.createdAt)}
      </td>
    </tr>
  );
}
