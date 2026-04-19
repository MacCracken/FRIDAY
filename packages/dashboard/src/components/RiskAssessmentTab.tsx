/**
 * RiskAssessmentTab — Phase 53: Risk Assessment & Reporting System
 *
 * Dashboard tab for the cross-domain risk assessment engine.
 * Sections: Overview, Assessments, Findings, External Feeds.
 */

import { useState, useCallback, lazy, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Download,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Info,
  Database,
  Upload,
  Loader2,
  TrendingUp,
  Target,
  ScanSearch,
} from 'lucide-react';
import {
  runRiskAssessment,
  fetchRiskAssessments,
  fetchRiskAssessment,
  downloadRiskReport,
  fetchRiskFeeds,
  createRiskFeed,
  deleteRiskFeed,
  ingestRiskFindings,
  fetchRiskFindings,
  acknowledgeRiskFinding,
  resolveRiskFinding,
} from '../api/client';
import type {
  RiskFinding,
  ExternalFinding,
  RiskLevel,
  RiskDomain,
  ExternalFeedCategory,
  ExternalFeedSourceType,
} from '../types';

// Phase 125: Lazy-loaded ATHI & Sandbox sub-tabs (moved from SecurityPage)
const ATHITab = lazy(() =>
  import('./security/SecurityATHITab').then((m) => ({ default: m.ATHITab }))
);
const SandboxTab = lazy(() =>
  import('./security/SecuritySandboxTab').then((m) => ({ default: m.SandboxTab }))
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

type SubTab = 'overview' | 'assessments' | 'findings' | 'feeds' | 'athi' | 'sandbox';

const LEVEL_COLORS: Record<string, string> = {
  critical: 'text-red-600 bg-red-50 border-red-200',
  high: 'text-orange-600 bg-orange-50 border-orange-200',
  medium: 'text-yellow-700 bg-yellow-50 border-yellow-200',
  low: 'text-green-700 bg-green-50 border-green-200',
};

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  critical: <ShieldAlert className="w-4 h-4 text-red-600" />,
  high: <AlertTriangle className="w-4 h-4 text-orange-600" />,
  medium: <AlertTriangle className="w-4 h-4 text-yellow-600" />,
  low: <Info className="w-4 h-4 text-blue-600" />,
  info: <Info className="w-4 h-4 text-gray-500" />,
};

function LevelBadge({ level }: { level?: string }) {
  const cls = LEVEL_COLORS[level ?? ''] ?? 'text-gray-600 bg-gray-50 border-gray-200';
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border uppercase ${cls}`}
    >
      {level ?? '—'}
    </span>
  );
}

function ScoreArc({ score, level }: { score: number; level?: RiskLevel }) {
  const color =
    level === 'critical'
      ? '#dc2626'
      : level === 'high'
        ? '#ea580c'
        : level === 'medium'
          ? '#d97706'
          : '#16a34a';
  const r = 54;
  const circ = 2 * Math.PI * r;
  const arcLen = (score / 100) * circ * 0.75;
  const gap = circ - arcLen;

  return (
    <div className="relative w-36 h-36 flex items-center justify-center">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-[135deg]">
        <circle
          cx="72"
          cy="72"
          r={r}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth="12"
          strokeDasharray={`${circ * 0.75} ${circ * 0.25}`}
        />
        <circle
          cx="72"
          cy="72"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={`${arcLen} ${gap + circ * 0.25}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-bold" style={{ color }}>
          {score}
        </div>
        <div className="text-xs text-muted-foreground">/ 100</div>
      </div>
    </div>
  );
}

function DomainCard({ domain, score }: { domain: string; score: number }) {
  const level = score >= 75 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  const color = LEVEL_COLORS[level];
  return (
    <div className="card card-compact bg-base-100 border border-border">
      <div className="card-body gap-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium capitalize">{domain}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${color}`}>
            {level.toUpperCase()}
          </span>
        </div>
        <div className="w-full bg-base-200 rounded-full h-2 mt-1">
          <div
            className="h-2 rounded-full transition-all"
            style={{
              width: `${score}%`,
              background:
                level === 'critical'
                  ? '#dc2626'
                  : level === 'high'
                    ? '#ea580c'
                    : level === 'medium'
                      ? '#d97706'
                      : '#16a34a',
            }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{score}/100</span>
      </div>
    </div>
  );
}

function formatTs(ts?: number) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function OverviewSection({ onRun, running }: { onRun: () => void; running: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['risk-assessments', 'latest'],
    queryFn: () => fetchRiskAssessments({ limit: 1, status: 'completed' }),
    refetchInterval: 30_000,
  });

  const latest = data?.items[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Risk Overview</h3>
        <button className="btn btn-ghost btn-sm gap-2" onClick={onRun} disabled={running}>
          {running ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Run Assessment
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      )}

      {!isLoading && !latest && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No assessments yet</p>
          <p className="text-sm mt-1">Click "Run Assessment" to generate your first risk report.</p>
        </div>
      )}

      {latest && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="card bg-base-100 border border-border shadow-sm">
            <div className="card-body items-center gap-4">
              <ScoreArc score={latest.compositeScore ?? 0} level={latest.riskLevel} />
              <div className="text-center">
                <LevelBadge level={latest.riskLevel} />
                <p className="text-sm text-muted-foreground mt-1">
                  {latest.name} &middot; {formatTs(latest.completedAt)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {latest.findingsCount} finding{latest.findingsCount !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </div>

          {latest.domainScores && (
            <div className="grid grid-cols-1 gap-2 content-start">
              {Object.entries(latest.domainScores).map(([d, s]) => (
                <DomainCard key={d} domain={d} score={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssessmentsSection() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['risk-assessments'],
    queryFn: () => fetchRiskAssessments({ limit: 50 }),
    refetchInterval: 10_000,
  });

  const { data: expandedData } = useQuery({
    queryKey: ['risk-assessment', expanded],
    queryFn: () => (expanded ? fetchRiskAssessment(expanded) : null),
    enabled: !!expanded,
  });

  const handleDownload = useCallback(async (id: string, fmt: string) => {
    setDownloading(`${id}-${fmt}`);
    try {
      const content = await downloadRiskReport(id, fmt);
      const mimes: Record<string, string> = {
        json: 'application/json',
        html: 'text/html',
        markdown: 'text/markdown',
        csv: 'text/csv',
      };
      const blob = new Blob([content], { type: mimes[fmt] ?? 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `risk-report-${id}.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Download failed', e);
    } finally {
      setDownloading(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Past Assessments</h3>
        <button className="btn btn-ghost btn-sm gap-2" onClick={() => void refetch()}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      )}

      {!isLoading && (!data?.items || data.items.length === 0) && (
        <p className="text-muted-foreground text-sm">No assessments yet.</p>
      )}

      <div className="space-y-2">
        {(data?.items ?? []).map((a) => (
          <div key={a.id} className="card bg-base-100 border border-border shadow-sm">
            <div
              className="card-body cursor-pointer select-none"
              onClick={() => {
                setExpanded(expanded === a.id ? null : a.id);
              }}
            >
              <div className="flex items-center gap-3">
                {a.status === 'completed' ? (
                  <ShieldCheck className="w-5 h-5 text-success shrink-0" />
                ) : a.status === 'failed' ? (
                  <XCircle className="w-5 h-5 text-destructive shrink-0" />
                ) : a.status === 'running' ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                ) : (
                  <Shield className="w-5 h-5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{formatTs(a.createdAt)}</p>
                </div>
                {a.riskLevel && <LevelBadge level={a.riskLevel} />}
                {a.compositeScore != null && (
                  <span className="text-sm font-bold text-muted-foreground">
                    {a.compositeScore}/100
                  </span>
                )}
                <span className="text-xs text-muted-foreground">{a.findingsCount} findings</span>
                {expanded === a.id ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {expanded === a.id && expandedData && (
              <div className="px-4 pb-4 border-t border-border space-y-4 pt-4">
                {/* Domain scores */}
                {expandedData.domainScores && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      Domain Scores
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {Object.entries(expandedData.domainScores).map(([d, s]) => (
                        <DomainCard key={d} domain={d} score={s} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Findings */}
                {expandedData.findings && expandedData.findings.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      Findings ({expandedData.findings.length})
                    </p>
                    <div className="space-y-1">
                      {expandedData.findings.map((f) => (
                        <FindingRow key={f.id} finding={f} compact />
                      ))}
                    </div>
                  </div>
                )}

                {/* Download buttons */}
                {expandedData.status === 'completed' && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                      Download Report
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {(['json', 'html', 'markdown', 'csv'] as const).map((fmt) => (
                        <button
                          key={fmt}
                          className="btn btn-ghost btn-xs gap-1"
                          disabled={downloading === `${a.id}-${fmt}`}
                          onClick={() => void handleDownload(a.id, fmt)}
                        >
                          {downloading === `${a.id}-${fmt}` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3" />
                          )}
                          {fmt.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {expandedData.error && (
                  <p className="text-sm text-destructive">Error: {expandedData.error}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingRow({
  finding,
  compact = false,
  onAcknowledge,
  onResolve,
}: {
  finding: RiskFinding | ExternalFinding;
  compact?: boolean;
  onAcknowledge?: () => void;
  onResolve?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const domain = 'domain' in finding ? finding.domain : undefined;
  const status = 'status' in finding ? finding.status : undefined;

  return (
    <div className={`rounded border border-border ${compact ? 'p-2' : 'p-3'} space-y-1`}>
      <div
        className="flex items-start gap-2 cursor-pointer"
        onClick={() => {
          if (!compact) setOpen(!open);
        }}
      >
        <span className="mt-0.5 shrink-0">{SEVERITY_ICONS[finding.severity]}</span>
        <div className="flex-1 min-w-0">
          <p className={`${compact ? 'text-xs' : 'text-sm'} font-medium truncate`}>
            {finding.title}
          </p>
          {!compact && (
            <p className="text-xs text-muted-foreground truncate">{finding.description}</p>
          )}
        </div>
        {domain && (
          <span className="text-xs text-muted-foreground capitalize shrink-0">{domain}</span>
        )}
        <LevelBadge level={finding.severity} />
        {status && (
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
              status === 'open'
                ? 'bg-red-50 text-red-600'
                : status === 'acknowledged'
                  ? 'bg-yellow-50 text-yellow-700'
                  : 'bg-green-50 text-green-700'
            }`}
          >
            {status}
          </span>
        )}
        {!compact &&
          (open ? (
            <ChevronUp className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ))}
      </div>

      {open && !compact && (
        <div className="pl-6 space-y-1 text-xs text-muted-foreground border-t border-border pt-2 mt-2">
          {finding.description && (
            <p>
              <strong>Description:</strong> {finding.description}
            </p>
          )}
          {finding.affectedResource && (
            <p>
              <strong>Affected Resource:</strong> {finding.affectedResource}
            </p>
          )}
          {finding.recommendation && (
            <p>
              <strong>Recommendation:</strong> {finding.recommendation}
            </p>
          )}
          {onAcknowledge && status === 'open' && (
            <button className="btn btn-xs btn-ghost mt-1" onClick={onAcknowledge}>
              Acknowledge
            </button>
          )}
          {onResolve && status !== 'resolved' && (
            <button className="btn btn-xs btn-ghost mt-1" onClick={onResolve}>
              Resolve
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FindingsSection() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['risk-findings', filterStatus, filterSeverity],
    queryFn: () =>
      fetchRiskFindings({
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => acknowledgeRiskFinding(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['risk-findings'] }),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveRiskFinding(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['risk-findings'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-lg font-semibold">External Findings</h3>
        <select
          className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm ml-auto"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
          }}
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm"
          value={filterSeverity}
          onChange={(e) => {
            setFilterSeverity(e.target.value);
          }}
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      )}

      {!isLoading && (!data?.items || data.items.length === 0) && (
        <p className="text-muted-foreground text-sm">No external findings found.</p>
      )}

      <div className="space-y-2">
        {(data?.items ?? []).map((f) => (
          <FindingRow
            key={f.id}
            finding={f}
            onAcknowledge={() => {
              ackMutation.mutate(f.id);
            }}
            onResolve={() => {
              resolveMutation.mutate(f.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function FeedsSection() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newFeed, setNewFeed] = useState({
    name: '',
    sourceType: 'manual' as ExternalFeedSourceType,
    category: 'cyber' as ExternalFeedCategory,
    description: '',
  });
  const [ingestFeedId, setIngestFeedId] = useState<string | null>(null);
  const [ingestText, setIngestText] = useState('');
  const [ingestResult, setIngestResult] = useState<{ created: number; skipped: number } | null>(
    null
  );

  const { data: feeds, isLoading } = useQuery({
    queryKey: ['risk-feeds'],
    queryFn: fetchRiskFeeds,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof newFeed) =>
      createRiskFeed({
        name: data.name,
        sourceType: data.sourceType,
        category: data.category,
        description: data.description || undefined,
        enabled: true,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['risk-feeds'] });
      setShowAdd(false);
      setNewFeed({ name: '', sourceType: 'manual', category: 'cyber', description: '' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRiskFeed(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['risk-feeds'] }),
  });

  const handleIngest = useCallback(
    async (feedId: string) => {
      try {
        const parsed = JSON.parse(ingestText) as unknown[];
        if (!Array.isArray(parsed)) {
          alert('Payload must be a JSON array');
          return;
        }
        const result = await ingestRiskFindings(feedId, parsed);
        setIngestResult(result);
        void qc.invalidateQueries({ queryKey: ['risk-feeds'] });
        void qc.invalidateQueries({ queryKey: ['risk-findings'] });
        setIngestText('');
      } catch (e) {
        alert(`Ingest failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [ingestText, qc]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">External Feeds</h3>
        <button
          className="btn btn-ghost btn-sm gap-2 ml-auto"
          onClick={() => {
            setShowAdd(!showAdd);
          }}
        >
          <Plus className="w-4 h-4" /> Add Feed
        </button>
      </div>

      {showAdd && (
        <div className="card bg-base-100 border border-border shadow-sm">
          <div className="card-body gap-3">
            <h4 className="font-semibold">New External Feed</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label label-text text-xs">Name *</label>
                <input
                  className="input input-bordered input-sm w-full"
                  value={newFeed.name}
                  onChange={(e) => {
                    setNewFeed((p) => ({ ...p, name: e.target.value }));
                  }}
                  placeholder="e.g. NVD CVE Feed"
                />
              </div>
              <div>
                <label className="label label-text text-xs">Source Type</label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={newFeed.sourceType}
                  onChange={(e) => {
                    setNewFeed((p) => ({
                      ...p,
                      sourceType: e.target.value as ExternalFeedSourceType,
                    }));
                  }}
                >
                  <option value="manual">Manual</option>
                  <option value="upload">Upload</option>
                  <option value="webhook">Webhook</option>
                </select>
              </div>
              <div>
                <label className="label label-text text-xs">Category</label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={newFeed.category}
                  onChange={(e) => {
                    setNewFeed((p) => ({ ...p, category: e.target.value as ExternalFeedCategory }));
                  }}
                >
                  <option value="cyber">Cyber</option>
                  <option value="compliance">Compliance</option>
                  <option value="finance">Finance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="label label-text text-xs">Description</label>
                <input
                  className="input input-bordered input-sm w-full"
                  value={newFeed.description}
                  onChange={(e) => {
                    setNewFeed((p) => ({ ...p, description: e.target.value }));
                  }}
                  placeholder="Optional description"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowAdd(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={!newFeed.name || createMutation.isPending}
                onClick={() => {
                  createMutation.mutate(newFeed);
                }}
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      )}

      {!isLoading && (!feeds || feeds.length === 0) && (
        <p className="text-muted-foreground text-sm">No external feeds configured.</p>
      )}

      <div className="space-y-3">
        {feeds?.map((feed) => (
          <div key={feed.id} className="card bg-base-100 border border-border shadow-sm">
            <div className="card-body gap-2">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{feed.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {feed.sourceType} · {feed.category} · {feed.recordCount} records
                    {feed.lastIngestedAt && ` · last ingested ${formatTs(feed.lastIngestedAt)}`}
                  </p>
                </div>
                <button
                  className="btn btn-ghost btn-xs gap-1"
                  onClick={() => {
                    setIngestFeedId(ingestFeedId === feed.id ? null : feed.id);
                  }}
                >
                  <Upload className="w-3 h-3" /> Ingest
                </button>
                <button
                  className="btn btn-ghost btn-xs text-destructive"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (confirm(`Delete feed "${feed.name}"?`)) {
                      deleteMutation.mutate(feed.id);
                    }
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {ingestFeedId === feed.id && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">
                    Ingest Findings (paste JSON array)
                  </p>
                  <textarea
                    className="textarea textarea-bordered w-full text-xs font-mono h-28"
                    value={ingestText}
                    onChange={(e) => {
                      setIngestText(e.target.value);
                    }}
                    placeholder='[{"title":"CVE-2024-XXXX","severity":"high","category":"cyber","description":"..."}]'
                  />
                  {ingestResult && (
                    <p className="text-xs text-success">
                      ✓ Created: {ingestResult.created}, Skipped: {ingestResult.skipped}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      className="btn btn-primary btn-xs gap-1"
                      disabled={!ingestText.trim()}
                      onClick={() => void handleIngest(feed.id)}
                    >
                      <Upload className="w-3 h-3" /> Import
                    </button>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setIngestFeedId(null);
                        setIngestResult(null);
                        setIngestText('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Tab ────────────────────────────────────────────────────────────────

const ALL_DOMAINS: RiskDomain[] = [
  'security',
  'autonomy',
  'governance',
  'infrastructure',
  'external',
];

export function RiskAssessmentTab() {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [runModal, setRunModal] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState([...ALL_DOMAINS]);
  const [windowDays, setWindowDays] = useState(7);
  const [assessmentName, setAssessmentName] = useState('');

  const runMutation = useMutation({
    mutationFn: () =>
      runRiskAssessment({
        name: assessmentName || `Assessment ${new Date().toISOString().slice(0, 19)}`,
        assessmentTypes: selectedDomains,
        windowDays,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['risk-assessments'] });
      setRunModal(false);
      setSubTab('assessments');
    },
  });

  const handleRunFromOverview = useCallback(() => {
    setRunModal(true);
  }, []);

  const SUBTABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <TrendingUp className="w-4 h-4" /> },
    { id: 'assessments', label: 'Assessments', icon: <Shield className="w-4 h-4" /> },
    { id: 'findings', label: 'Findings', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'feeds', label: 'External Feeds', icon: <Database className="w-4 h-4" /> },
    { id: 'athi', label: 'ATHI Threats', icon: <Target className="w-4 h-4" /> },
    { id: 'sandbox', label: 'Sandbox Scanning', icon: <ScanSearch className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-nav */}
      <div className="flex gap-1 border-b border-border pb-2 overflow-x-auto">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-t transition-colors whitespace-nowrap ${
              subTab === t.id
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setSubTab(t.id);
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subTab === 'overview' && (
        <OverviewSection onRun={handleRunFromOverview} running={runMutation.isPending} />
      )}
      {subTab === 'assessments' && <AssessmentsSection />}
      {subTab === 'findings' && <FindingsSection />}
      {subTab === 'feeds' && <FeedsSection />}
      {subTab === 'athi' && (
        <Suspense fallback={<Loader2 className="w-5 h-5 animate-spin" />}>
          <ATHITab />
        </Suspense>
      )}
      {subTab === 'sandbox' && (
        <Suspense fallback={<Loader2 className="w-5 h-5 animate-spin" />}>
          <SandboxTab />
        </Suspense>
      )}

      {/* Run Assessment Modal */}
      {runModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-base-100 rounded-lg shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold">Run New Assessment</h3>

            <div>
              <label className="label label-text text-xs">Assessment Name</label>
              <input
                className="input input-bordered input-sm w-full"
                value={assessmentName}
                onChange={(e) => {
                  setAssessmentName(e.target.value);
                }}
                placeholder={`Assessment ${new Date().toISOString().slice(0, 10)}`}
              />
            </div>

            <div>
              <label className="label label-text text-xs">Domains to Assess</label>
              <div className="flex flex-wrap gap-2">
                {ALL_DOMAINS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={selectedDomains.includes(d)}
                      onChange={(e) => {
                        setSelectedDomains((prev) =>
                          e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)
                        );
                      }}
                    />
                    <span className="text-sm capitalize">{d}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label label-text text-xs">Lookback Window (days)</label>
              <input
                type="number"
                className="input input-bordered input-sm w-24"
                value={windowDays}
                min={1}
                max={365}
                onChange={(e) => {
                  setWindowDays(Number(e.target.value));
                }}
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setRunModal(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm gap-2"
                disabled={selectedDomains.length === 0 || runMutation.isPending}
                onClick={() => {
                  runMutation.mutate();
                }}
              >
                {runMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Run Assessment
              </button>
            </div>

            {runMutation.isError && (
              <p className="text-sm text-destructive">
                Error:{' '}
                {runMutation.error instanceof Error ? runMutation.error.message : 'Unknown error'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
