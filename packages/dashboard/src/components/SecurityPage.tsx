import { useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  RefreshCw,
  Eye,
  Check,
  Settings,
  Clock,
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
  FileText,
  Heart,
  Play,
  Pause,
  ChevronDown,
} from 'lucide-react';
import {
  fetchSecurityEvents,
  fetchAuditEntries,
  verifyAuditChain,
  fetchTasks,
  createTask,
  deleteTask,
  updateTask,
  fetchHeartbeatTasks,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { MetricsSnapshot, SecurityEvent, AuditEntry, Task, HeartbeatTask } from '../types';

type TabType = 'overview' | 'audit' | 'tasks' | 'reports';

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-info" />,
  warn: <AlertTriangle className="w-4 h-4 text-warning" />,
  error: <XCircle className="w-4 h-4 text-destructive" />,
  critical: <ShieldAlert className="w-4 h-4 text-destructive" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-l-info',
  warn: 'border-l-warning',
  error: 'border-l-destructive',
  critical: 'border-l-destructive bg-destructive/5',
};

const ACK_STORAGE_KEY = 'friday_acknowledged_events';

function loadAcknowledged(): Set<string> {
  try {
    const stored = localStorage.getItem(ACK_STORAGE_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function saveAcknowledged(ids: Set<string>): void {
  localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

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

interface ReportSummary {
  id: string;
  title: string;
  format: string;
  generatedAt: number;
  entryCount: number;
  sizeBytes: number;
}

async function fetchReports(): Promise<{ reports: ReportSummary[]; total: number }> {
  const res = await fetch('/api/v1/reports', {
    headers: { Authorization: `Bearer ${localStorage.getItem('friday_token')}` },
  });
  if (!res.ok) throw new Error('Failed to fetch reports');
  return res.json();
}

async function generateReport(opts: {
  title: string;
  format: string;
}): Promise<{ report: ReportSummary }> {
  const res = await fetch('/api/v1/reports/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('friday_token')}`,
    },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error('Failed to generate report');
  return res.json();
}

export function SecurityPage() {
  const location = useLocation();
  const getInitialTab = (): TabType => {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'audit') return 'audit';
    if (tabParam === 'tasks' || path.includes('/tasks')) return 'tasks';
    if (tabParam === 'reports' || path.includes('/reports')) return 'reports';
    return 'overview';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean;
    entriesChecked: number;
    error?: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(loadAcknowledged);
  const [auditReviewed, setAuditReviewed] = useState<Set<string>>(loadReviewedAudit);

  const markAuditReviewed = useCallback((ids: string[]) => {
    setAuditReviewed((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      saveReviewedAudit(next);
      return next;
    });
  }, []);

  const markAllAuditReviewed = useCallback(async () => {
    try {
      const result = await fetchAuditEntries({ limit: 10000, offset: 0 });
      const allIds = result.entries.map((e) => e.id);
      markAuditReviewed(allIds);
    } catch {
      // fallback: no-op
    }
  }, [markAuditReviewed]);

  const { data: eventsData } = useQuery({
    queryKey: ['security-events'],
    queryFn: () => fetchSecurityEvents({ limit: 20 }),
    refetchInterval: 10000,
  });

  const events = eventsData?.events ?? [];

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const result = await verifyAuditChain();
      setVerificationResult(result);
      // Verification is an audit of the entire chain — mark all entries reviewed
      await markAllAuditReviewed();
    } finally {
      setVerifying(false);
    }
  };

  const acknowledgeEvent = useCallback((eventId: string) => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      saveAcknowledged(next);
      return next;
    });
  }, []);

  const acknowledgeAll = useCallback(() => {
    setAcknowledged((prev) => {
      const next = new Set(prev);
      events.forEach((e: SecurityEvent) => next.add(e.id));
      saveAcknowledged(next);
      return next;
    });
  }, [events]);

  const visibleEvents = events.filter((e: SecurityEvent) => !acknowledged.has(e.id));
  const criticalCount = events.filter((e: SecurityEvent) => e.severity === 'critical').length;
  const warningCount = events.filter((e: SecurityEvent) => e.severity === 'warn').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Security
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Monitor security events, manage tasks, and generate reports
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Overview
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'audit'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="w-4 h-4" />
          Audit Log
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'tasks'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="w-4 h-4" />
          Tasks
        </button>
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'reports'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="w-4 h-4" />
          Reports
        </button>
      </div>

      {activeTab === 'overview' && (
        <SecurityOverviewTab
          events={visibleEvents}
          criticalCount={criticalCount}
          warningCount={warningCount}
          verifying={verifying}
          verificationResult={verificationResult}
          onVerify={handleVerifyChain}
          onAcknowledge={acknowledgeEvent}
          onAcknowledgeAll={acknowledgeAll}
          onViewAuditLog={() => setActiveTab('audit')}
        />
      )}

      {activeTab === 'audit' && (
        <AuditLogTab
          reviewed={auditReviewed}
          onMarkReviewed={markAuditReviewed}
          onMarkAllReviewed={markAllAuditReviewed}
        />
      )}

      {activeTab === 'tasks' && <TasksTab />}

      {activeTab === 'reports' && <ReportsTab />}
    </div>
  );
}

function SecurityOverviewTab({
  events,
  criticalCount,
  warningCount,
  verifying,
  verificationResult,
  onVerify,
  onAcknowledge,
  onAcknowledgeAll,
  onViewAuditLog,
}: {
  events: SecurityEvent[];
  criticalCount: number;
  warningCount: number;
  verifying: boolean;
  verificationResult: { valid: boolean; entriesChecked: number; error?: string } | null;
  onVerify: () => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
  onViewAuditLog: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <ShieldAlert className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Critical</p>
              <p className="text-2xl font-bold">{criticalCount}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/10">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Warnings</p>
              <p className="text-2xl font-bold">{warningCount}</p>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <ShieldCheck className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Audit Status</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={onVerify}
                  disabled={verifying}
                  className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  {verifying ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {verificationResult ? (verificationResult.valid ? 'Verified' : 'Failed') : 'Verify'}
                </button>
                <button
                  onClick={onViewAuditLog}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  View Log
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Events</p>
              <p className="text-2xl font-bold">{events.length}</p>
            </div>
          </div>
        </div>
      </div>

      {verificationResult && (
        <div
          className={`card p-4 border-l-4 ${
            verificationResult.valid
              ? 'border-l-success bg-success/5'
              : 'border-l-destructive bg-destructive/5'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {verificationResult.valid ? (
                <CheckCircle className="w-5 h-5 text-success" />
              ) : (
                <XCircle className="w-5 h-5 text-destructive" />
              )}
              <span className="font-medium">
                {verificationResult.valid
                  ? `Audit chain verified (${verificationResult.entriesChecked} entries)`
                  : verificationResult.error || 'Verification failed'}
              </span>
            </div>
            <button
              onClick={onViewAuditLog}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <FileText className="w-4 h-4" />
              View Audit Log
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Recent Security Events</h3>
        <button
          onClick={onAcknowledgeAll}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Acknowledge all
        </button>
      </div>

      {events.length === 0 ? (
        <div className="card p-8 text-center">
          <ShieldCheck className="w-12 h-12 mx-auto text-success mb-3" />
          <p className="text-muted-foreground">No security events</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className={`card p-4 border-l-4 ${SEVERITY_COLORS[event.severity] || 'border-l-info'}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {SEVERITY_ICONS[event.severity] || <Info className="w-4 h-4" />}
                  <div>
                    <p className="font-medium text-sm">{event.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">{event.type}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onAcknowledge(event.id)}
                  className="text-muted-foreground hover:text-foreground"
                  title="Acknowledge"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function TasksTab() {
  const [searchParams, setSearchParams] = useState({ offset: '0', status: '', type: '' });
  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', searchParams],
    queryFn: () =>
      fetchTasks({
        offset: Number(searchParams.offset),
        limit: 10,
        status: searchParams.status || undefined,
        type: searchParams.type || undefined,
      }),
    refetchInterval: 10000,
  });

  const { data: heartbeatData, isLoading: heartbeatLoading } = useQuery({
    queryKey: ['heartbeat-tasks'],
    queryFn: fetchHeartbeatTasks,
    refetchInterval: 10000,
  });

  const heartbeatTasks = heartbeatData?.tasks ?? [];
  const [heartbeatOpen, setHeartbeatOpen] = useState(false);
  const activeCount = heartbeatTasks.filter((t) => t.enabled).length;

  return (
    <div className="space-y-6">
      {/* Heartbeat Tasks Section — collapsible */}
      <div className="card">
        <button
          onClick={() => setHeartbeatOpen((prev) => !prev)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Heartbeat Tasks</h3>
            {heartbeatTasks.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {activeCount}/{heartbeatTasks.length} active
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${heartbeatOpen ? '' : '-rotate-90'}`}
          />
        </button>

        {heartbeatOpen && (
          <div className="border-t border-border">
            {heartbeatLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : heartbeatTasks.length === 0 ? (
              <div className="p-6 text-center">
                <Heart className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No heartbeat tasks configured</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {heartbeatTasks.map((task) => (
                  <div
                    key={task.name}
                    className={`p-4 border-l-4 ${task.enabled ? 'border-l-success' : 'border-l-muted-foreground/30'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {task.enabled ? (
                          <Play className="w-4 h-4 text-success" />
                        ) : (
                          <Pause className="w-4 h-4 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium text-sm">{task.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="badge text-xs">{task.type}</span>
                            {task.intervalMs && (
                              <span className="text-xs text-muted-foreground">
                                every {formatInterval(task.intervalMs)}
                              </span>
                            )}
                            {task.lastRunAt ? (
                              <span className="text-xs text-muted-foreground">
                                last run {new Date(task.lastRunAt).toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">never run</span>
                            )}
                            {task.personalityName && (
                              <span className="text-xs text-muted-foreground">
                                {task.personalityName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`badge ${task.enabled ? 'badge-success' : 'badge'}`}
                      >
                        {task.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Regular Tasks Section */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="font-semibold">Task History</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={searchParams.status}
              onChange={(e) =>
                setSearchParams({ ...searchParams, status: e.target.value, offset: '0' })
              }
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Status</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="pending">Pending</option>
            </select>
            <select
              value={searchParams.type}
              onChange={(e) =>
                setSearchParams({ ...searchParams, type: e.target.value, offset: '0' })
              }
              className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="execute">Execute</option>
              <option value="query">Query</option>
              <option value="file">File</option>
              <option value="network">Network</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>

        {tasksLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : !tasksData?.tasks.length ? (
          <div className="card p-12 text-center">
            <Clock className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No tasks found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tasksData.tasks.map((task) => (
              <div key={task.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {STATUS_ICONS[task.status] || <Clock className="w-4 h-4" />}
                    <div>
                      <p className="font-medium text-sm">{task.name || task.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {task.type} • {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span className={`badge ${STATUS_COLORS[task.status] || 'badge'}`}>
                    {task.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tasksData && tasksData.total > 10 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() =>
                setSearchParams({
                  ...searchParams,
                  offset: String(Math.max(0, Number(searchParams.offset) - 10)),
                })
              }
              disabled={Number(searchParams.offset) <= 0}
              className="btn btn-ghost"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-muted-foreground">
              {Number(searchParams.offset) + 1}-
              {Math.min(Number(searchParams.offset) + 10, tasksData.total)} of {tasksData.total}
            </span>
            <button
              onClick={() =>
                setSearchParams({ ...searchParams, offset: String(Number(searchParams.offset) + 10) })
              }
              disabled={Number(searchParams.offset) + 10 >= tasksData.total}
              className="btn btn-ghost"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const AUDIT_REVIEWED_KEY = 'friday_reviewed_audit';

function loadReviewedAudit(): Set<string> {
  try {
    const stored = localStorage.getItem(AUDIT_REVIEWED_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

function saveReviewedAudit(ids: Set<string>): void {
  localStorage.setItem(AUDIT_REVIEWED_KEY, JSON.stringify(Array.from(ids)));
}

const LEVEL_ICONS = {
  info: { unreviewed: <Info className="w-4 h-4 text-info" />, border: 'border-l-info' },
  warn: { unreviewed: <AlertTriangle className="w-4 h-4 text-warning" />, border: 'border-l-warning' },
  error: { unreviewed: <XCircle className="w-4 h-4 text-destructive" />, border: 'border-l-destructive' },
  security: {
    unreviewed: <ShieldAlert className="w-4 h-4 text-destructive" />,
    border: 'border-l-destructive bg-destructive/5',
  },
} as const;

function AuditLogTab({
  reviewed,
  onMarkReviewed,
  onMarkAllReviewed,
}: {
  reviewed: Set<string>;
  onMarkReviewed: (ids: string[]) => void;
  onMarkAllReviewed: () => void;
}) {
  const [filters, setFilters] = useState({ level: '', event: '', offset: 0 });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-entries', filters],
    queryFn: () =>
      fetchAuditEntries({
        level: filters.level || undefined,
        event: filters.event || undefined,
        limit,
        offset: filters.offset,
      }),
    refetchInterval: 15000,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const unreviewedCount = entries.filter((e: AuditEntry) => !reviewed.has(e.id)).length;

  const markPageReviewed = useCallback(() => {
    onMarkReviewed(entries.map((e: AuditEntry) => e.id));
  }, [entries, onMarkReviewed]);

  const handleToggleExpand = useCallback(
    (id: string) => {
      setExpandedId((prev) => (prev === id ? null : id));
      if (!reviewed.has(id)) {
        onMarkReviewed([id]);
      }
    },
    [reviewed, onMarkReviewed]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Audit Log</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {total > 0
              ? `${total} total entries${unreviewedCount > 0 ? ` \u00b7 ${unreviewedCount} unreviewed` : ''}`
              : 'View and verify audit chain entries'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreviewedCount > 0 && (
            <button
              onClick={markPageReviewed}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <Check className="w-3 h-3" />
              Mark page reviewed
            </button>
          )}
          <button
            onClick={onMarkAllReviewed}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <CheckCircle className="w-3 h-3" />
            Mark all reviewed
          </button>
          <select
            value={filters.level}
            onChange={(e) => setFilters({ ...filters, level: e.target.value, offset: 0 })}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Levels</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
            <option value="security">Security</option>
          </select>
          <select
            value={filters.event}
            onChange={(e) => setFilters({ ...filters, event: e.target.value, offset: 0 })}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Events</option>
            <option value="auth_success">Auth Success</option>
            <option value="auth_failure">Auth Failure</option>
            <option value="rate_limit">Rate Limit</option>
            <option value="injection_attempt">Injection Attempt</option>
            <option value="permission_denied">Permission Denied</option>
            <option value="anomaly">Anomaly</option>
            <option value="sandbox_violation">Sandbox Violation</option>
            <option value="config_change">Config Change</option>
            <option value="secret_access">Secret Access</option>
            <option value="task_start">Task Start</option>
            <option value="task_complete">Task Complete</option>
            <option value="task_fail">Task Fail</option>
            <option value="mcp_tool_call">MCP Tool Call</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No audit entries found</p>
          {(filters.level || filters.event) && (
            <button
              onClick={() => setFilters({ level: '', event: '', offset: 0 })}
              className="text-sm text-primary hover:underline mt-2"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry: AuditEntry) => {
            const level = LEVEL_ICONS[entry.level as keyof typeof LEVEL_ICONS] ?? LEVEL_ICONS.info;
            const isExpanded = expandedId === entry.id;
            const isReviewed = reviewed.has(entry.id);
            const icon = isReviewed
              ? <CheckCircle className="w-4 h-4 text-muted-foreground/50" />
              : level.unreviewed;

            return (
              <div
                key={entry.id}
                className={`card border-l-4 ${level.border} cursor-pointer transition-colors hover:bg-muted/30${!isReviewed ? ' bg-muted/10' : ''}`}
                onClick={() => handleToggleExpand(entry.id)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {icon}
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${isReviewed ? 'text-muted-foreground' : 'font-medium'}`}>{entry.message || entry.event}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="badge text-xs">{entry.event}</span>
                          <span className="badge text-xs">{entry.level}</span>
                          {entry.userId && (
                            <span className="text-xs text-muted-foreground">
                              user: {entry.userId}
                            </span>
                          )}
                          {entry.taskId && (
                            <span className="text-xs text-muted-foreground">
                              task: {entry.taskId.slice(0, 8)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          #{entry.sequence} &middot; {new Date(entry.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                      {isExpanded ? (
                        <ChevronLeft className="w-4 h-4 rotate-[-90deg]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 rotate-90" />
                      )}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-border space-y-2 text-xs">
                      <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
                        <span className="text-muted-foreground">ID</span>
                        <span className="font-mono truncate">{entry.id}</span>
                        <span className="text-muted-foreground">Sequence</span>
                        <span>{entry.sequence}</span>
                        {entry.userId && (
                          <>
                            <span className="text-muted-foreground">User ID</span>
                            <span className="font-mono">{entry.userId}</span>
                          </>
                        )}
                        {entry.taskId && (
                          <>
                            <span className="text-muted-foreground">Task ID</span>
                            <span className="font-mono">{entry.taskId}</span>
                          </>
                        )}
                        {entry.signature && (
                          <>
                            <span className="text-muted-foreground">Signature</span>
                            <span className="font-mono truncate">{entry.signature}</span>
                          </>
                        )}
                        {entry.previousHash && (
                          <>
                            <span className="text-muted-foreground">Prev Hash</span>
                            <span className="font-mono truncate">{entry.previousHash}</span>
                          </>
                        )}
                      </div>
                      {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                        <div>
                          <p className="text-muted-foreground mb-1">Metadata</p>
                          <pre className="bg-muted/50 rounded p-2 overflow-x-auto text-xs">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {total > limit && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() =>
              setFilters({ ...filters, offset: Math.max(0, filters.offset - limit) })
            }
            disabled={filters.offset <= 0}
            className="btn btn-ghost"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-muted-foreground">
            {filters.offset + 1}-{Math.min(filters.offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setFilters({ ...filters, offset: filters.offset + limit })}
            disabled={filters.offset + limit >= total}
            className="btn btn-ghost"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function ReportsTab() {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState('json');
  const { data, isLoading } = useQuery({ queryKey: ['reports'], queryFn: fetchReports });
  const mutation = useMutation({
    mutationFn: generateReport,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Audit Reports</h3>
          <p className="text-xs text-muted-foreground mt-1">Generate and download audit reports</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
            }}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
          >
            <option value="json">JSON</option>
            <option value="html">HTML</option>
            <option value="csv">CSV</option>
          </select>
          <button
            className="btn btn-primary flex items-center gap-2"
            onClick={() => {
              mutation.mutate({
                title: `Audit Report - ${new Date().toLocaleDateString()}`,
                format,
              });
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Generate
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.reports.length ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No reports generated yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.reports.map((report) => (
            <div key={report.id} className="card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-primary" />
                <div>
                  <p className="font-medium text-sm">{report.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {report.format.toUpperCase()} • {new Date(report.generatedAt).toLocaleString()}{' '}
                    • {report.entryCount} entries
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost text-xs">
                <Download className="w-4 h-4 mr-1" />
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
