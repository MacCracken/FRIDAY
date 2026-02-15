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
} from 'lucide-react';
import {
  fetchSecurityEvents,
  verifyAuditChain,
  fetchTasks,
  createTask,
  deleteTask,
  updateTask,
  fetchHeartbeatTasks,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { MetricsSnapshot, SecurityEvent, Task, HeartbeatTask } from '../types';

type TabType = 'overview' | 'tasks' | 'reports';

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
    if (path.includes('/tasks')) return 'tasks';
    if (path.includes('/reports')) return 'reports';
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
}: {
  events: SecurityEvent[];
  criticalCount: number;
  warningCount: number;
  verifying: boolean;
  verificationResult: { valid: boolean; entriesChecked: number; error?: string } | null;
  onVerify: () => void;
  onAcknowledge: (id: string) => void;
  onAcknowledgeAll: () => void;
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

function TasksTab() {
  const [searchParams, setSearchParams] = useState({ offset: '0', status: '', type: '' });
  const { data: tasksData, isLoading } = useQuery({
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="font-semibold">Task History</h3>
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

      {isLoading ? (
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
