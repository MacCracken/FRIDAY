/**
 * AgnosticPanel — Agnostic Agent Platform integration panel for Connections page.
 *
 * Browse presets, view agent details, create crews, view crew history.
 * Uses existing agnostic MCP tools via the REST API proxy.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Play,
  Square,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Users,
  Cpu,
  Filter,
} from 'lucide-react';
import * as api from '../../api/client';

type Domain = '' | 'qa' | 'data-engineering' | 'devops' | 'software-engineering' | 'design';
type Size = '' | 'lean' | 'standard' | 'large';

const DOMAIN_LABELS: Record<string, string> = {
  '': 'All Domains',
  qa: 'Quality Assurance',
  'data-engineering': 'Data Engineering',
  devops: 'DevOps',
  'software-engineering': 'Software Engineering',
  design: 'Design',
};

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  failed: XCircle,
  running: Play,
  pending: Clock,
  cancelled: Square,
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-green-500',
  failed: 'text-red-500',
  running: 'text-blue-500',
  pending: 'text-yellow-500',
  cancelled: 'text-muted-foreground',
};

function PresetCard({
  preset,
  onSubmit,
}: {
  preset: api.AgnosticPreset;
  onSubmit: (preset: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50"
        onClick={() => {
          setExpanded(!expanded);
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{preset.name}</div>
            <div className="text-[10px] text-muted-foreground">
              {preset.domain} &middot; {preset.size} &middot; {preset.agent_count} agents
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSubmit(preset.name);
            }}
            className="px-2 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            Run Crew
          </button>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">{preset.description}</p>
          <div className="space-y-1">
            {preset.agents.map((agent) => (
              <div key={agent.key} className="flex items-start gap-2 p-1.5 rounded bg-muted/30">
                <Bot className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium">{agent.role}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{agent.goal}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AgnosticPanel() {
  const queryClient = useQueryClient();
  const [domainFilter, setDomainFilter] = useState<Domain>('');
  const [sizeFilter] = useState<Size>('');
  const [crewStatusFilter, setCrewStatusFilter] = useState('');
  const [submitPreset, setSubmitPreset] = useState<string | null>(null);
  const [submitTitle, setSubmitTitle] = useState('');
  const [submitDesc, setSubmitDesc] = useState('');

  const { data: widget, isLoading: widgetLoading } = useQuery({
    queryKey: ['agnostic-widget'],
    queryFn: () => api.fetchAgnosticWidget(),
    refetchInterval: 30_000,
  });

  const { data: presets } = useQuery({
    queryKey: ['agnostic-presets', domainFilter, sizeFilter],
    queryFn: () =>
      api.fetchAgnosticPresets({
        domain: domainFilter || undefined,
        size: sizeFilter || undefined,
      }),
  });

  const { data: crews } = useQuery({
    queryKey: ['agnostic-crews', crewStatusFilter],
    queryFn: () =>
      api.fetchAgnosticCrews({
        status: crewStatusFilter || undefined,
        limit: 10,
      }),
    refetchInterval: 15_000,
  });

  const submitMutation = useMutation({
    mutationFn: (data: { title: string; description: string; preset: string }) =>
      api.submitAgnosticCrew(data),
    onSuccess: () => {
      setSubmitPreset(null);
      setSubmitTitle('');
      setSubmitDesc('');
      void queryClient.invalidateQueries({ queryKey: ['agnostic-crews'] });
      void queryClient.invalidateQueries({ queryKey: ['agnostic-widget'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (crewId: string) => api.cancelAgnosticCrew(crewId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agnostic-crews'] });
    },
  });

  const handleSubmit = (presetName: string) => {
    setSubmitPreset(presetName);
    setSubmitTitle(`${presetName} crew`);
    setSubmitDesc('');
  };

  const doSubmit = () => {
    if (!submitPreset || !submitTitle) return;
    submitMutation.mutate({ title: submitTitle, description: submitDesc, preset: submitPreset });
  };

  const statusBadge =
    widget?.status === 'healthy'
      ? 'text-green-500'
      : widget?.status === 'degraded'
        ? 'text-yellow-500'
        : 'text-red-500';

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">Agnostic Agent Platform</h3>
            <span className={`text-[10px] ${statusBadge}`}>{widget?.status ?? 'unknown'}</span>
          </div>
        </div>
        <button
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ['agnostic-widget'] });
          }}
          className="p-1.5 rounded hover:bg-muted"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${widgetLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Quick stats */}
      {widget && (
        <div className="grid grid-cols-4 gap-2">
          {(['running', 'pending', 'completed', 'failed'] as const).map((key) => (
            <div key={key} className="p-2 rounded-lg border border-border bg-card text-center">
              <div className="text-lg font-bold">{widget.tasks[key]}</div>
              <div className="text-[10px] text-muted-foreground capitalize">{key}</div>
            </div>
          ))}
        </div>
      )}

      {/* Submit crew dialog */}
      {submitPreset && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-2">
          <div className="text-xs font-medium">Submit Crew: {submitPreset}</div>
          <input
            value={submitTitle}
            onChange={(e) => {
              setSubmitTitle(e.target.value);
            }}
            placeholder="Crew title..."
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-background"
          />
          <textarea
            value={submitDesc}
            onChange={(e) => {
              setSubmitDesc(e.target.value);
            }}
            placeholder="Description (optional)..."
            rows={2}
            className="w-full px-2 py-1.5 text-xs rounded border border-border bg-background resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={doSubmit}
              disabled={submitMutation.isPending || !submitTitle}
              className="px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {submitMutation.isPending ? 'Submitting...' : 'Submit'}
            </button>
            <button
              onClick={() => {
                setSubmitPreset(null);
              }}
              className="px-3 py-1 text-xs rounded border border-border hover:bg-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Presets */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Crew Presets ({presets?.presets.length ?? 0})
          </h4>
          <div className="flex items-center gap-1">
            <Filter className="w-3 h-3 text-muted-foreground" />
            <select
              value={domainFilter}
              onChange={(e) => {
                setDomainFilter(e.target.value as Domain);
              }}
              className="text-[10px] bg-transparent border-none text-muted-foreground cursor-pointer"
            >
              {Object.entries(DOMAIN_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          {(presets?.presets ?? []).map((preset) => (
            <PresetCard key={preset.name} preset={preset} onSubmit={handleSubmit} />
          ))}
          {presets?.presets.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">
              No presets found{domainFilter ? ` for ${DOMAIN_LABELS[domainFilter]}` : ''}.
            </div>
          )}
        </div>
      </div>

      {/* Crew History */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Recent Crews ({crews?.total ?? 0})
          </h4>
          <select
            value={crewStatusFilter}
            onChange={(e) => {
              setCrewStatusFilter(e.target.value);
            }}
            className="text-[10px] bg-transparent border-none text-muted-foreground cursor-pointer"
          >
            <option value="">All</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="space-y-1">
          {(crews?.crews ?? []).map((crew) => {
            const Icon = STATUS_ICONS[crew.status] ?? Clock;
            const color = STATUS_COLORS[crew.status] ?? 'text-muted-foreground';
            return (
              <div
                key={crew.id}
                className="flex items-center justify-between p-2 rounded border border-border bg-card"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className={`w-3.5 h-3.5 ${color} flex-shrink-0`} />
                  <div className="min-w-0">
                    <div className="text-xs truncate">{crew.title}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {crew.preset ?? crew.domain ?? 'custom'} &middot;{' '}
                      {new Date(crew.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
                {(crew.status === 'running' || crew.status === 'pending') && (
                  <button
                    onClick={() => {
                      cancelMutation.mutate(crew.id);
                    }}
                    className="p-1 rounded hover:bg-muted"
                    title="Cancel crew"
                  >
                    <Square className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}
              </div>
            );
          })}
          {crews?.crews.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">No crews yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
