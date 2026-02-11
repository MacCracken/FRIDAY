/**
 * Task History Component
 *
 * Displays historical task execution with filtering and pagination
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { fetchTasks } from '../api/client';
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

export function TaskHistory() {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const pageSize = 10;

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter, typeFilter, page],
    queryFn: () =>
      fetchTasks({
        status: statusFilter || undefined,
        type: typeFilter || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    refetchInterval: 5000,
  });

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const resetFilters = () => {
    setStatusFilter('');
    setTypeFilter('');
    setPage(0);
  };

  const hasFilters = statusFilter || typeFilter;

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Task History</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-4 h-4 text-muted-foreground" />

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
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
              setTypeFilter(e.target.value);
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
