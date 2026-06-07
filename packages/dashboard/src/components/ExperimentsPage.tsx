import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Play, Square, Trash2, Loader2, X, ShieldAlert } from 'lucide-react';
import { fetchSecurityPolicy } from '../api/client';

// ── Experiment types & API ────────────────────────────────────────

interface Variant {
  id: string;
  name: string;
  config: Record<string, unknown>;
  trafficPercent: number;
}

interface Experiment {
  id: string;
  name: string;
  description: string;
  status: string;
  variants: Variant[];
  createdAt: number;
  startedAt?: number;
  stoppedAt?: number;
}

const API_HEADERS = () => ({
  'Content-Type': 'application/json',
  // Token is stored under 'accessToken' (see api/client.ts setAuthTokens).
  Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
});

async function fetchExperiments(): Promise<{ experiments: Experiment[]; total: number }> {
  const res = await fetch('/api/v1/experiments', { headers: API_HEADERS() });
  if (!res.ok) throw new Error('Failed to fetch experiments');
  return res.json();
}

async function createExperimentApi(data: {
  name: string;
  description: string;
  variants: Partial<Variant>[];
}): Promise<{ experiment: Experiment }> {
  const res = await fetch('/api/v1/experiments', {
    method: 'POST',
    headers: API_HEADERS(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create experiment');
  return res.json();
}

async function startExperiment(id: string): Promise<void> {
  const res = await fetch(`/api/v1/experiments/${id}/start`, {
    method: 'POST',
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to start experiment');
}

async function stopExperiment(id: string): Promise<void> {
  const res = await fetch(`/api/v1/experiments/${id}/stop`, {
    method: 'POST',
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to stop experiment');
}

async function deleteExperiment(id: string): Promise<void> {
  const res = await fetch(`/api/v1/experiments/${id}`, {
    method: 'DELETE',
    headers: API_HEADERS(),
  });
  if (!res.ok) throw new Error('Failed to delete experiment');
}

const EXP_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  running: 'bg-green-500/10 text-green-500 border-green-500/20',
  stopped: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  completed: 'bg-green-500/10 text-green-500 border-green-500/20',
};

// ── Main Component ────────────────────────────────────────────────

export function ExperimentsPage() {
  const { data: securityPolicy } = useQuery({
    queryKey: ['security-policy'],
    queryFn: fetchSecurityPolicy,
    staleTime: 30000,
  });

  const experimentsEnabled = securityPolicy?.allowExperiments ?? false;

  if (!experimentsEnabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Experiments</h1>
        </div>
        <div className="card p-8 text-center">
          <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-lg font-semibold mb-2">Experiments are Disabled</h2>
          <p className="text-muted-foreground mb-4">
            Enable <code className="text-sm bg-muted px-1.5 py-0.5 rounded">allowExperiments</code>{' '}
            in Settings &gt; Security to activate A/B experiments.
          </p>
          <p className="text-xs text-muted-foreground">
            This setting must be explicitly enabled after initialization and saved to the database.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FlaskConical className="w-6 h-6 text-primary" />
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Experiments</h1>
      </div>
      <ExperimentsList />
    </div>
  );
}

// ── Experiments List ──────────────────────────────────────────────

function ExperimentsList() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['experiments'],
    queryFn: fetchExperiments,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['experiments'] });

  const createMut = useMutation({
    mutationFn: createExperimentApi,
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setName('');
      setDescription('');
    },
  });

  const startMut = useMutation({ mutationFn: startExperiment, onSuccess: invalidate });
  const stopMut = useMutation({ mutationFn: stopExperiment, onSuccess: invalidate });
  const deleteMut = useMutation({ mutationFn: deleteExperiment, onSuccess: invalidate });

  const experiments = data?.experiments ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{experiments.length} experiment(s)</p>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
          }}
          className="btn btn-ghost flex items-center gap-2 text-sm px-3 py-2"
        >
          <Plus className="w-4 h-4" />
          New Experiment
        </button>
      </div>

      {showCreate && (
        <div className="card p-4 space-y-3 border-primary/30">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">New Experiment</h3>
            <button
              onClick={() => {
                setShowCreate(false);
                setName('');
                setDescription('');
              }}
              className="p-1 rounded hover:bg-muted/50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background"
              placeholder="Experiment name"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <input
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              className="w-full mt-1 px-3 py-2 text-sm border rounded-md bg-background"
              placeholder="What this experiment tests"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowCreate(false);
                setName('');
                setDescription('');
              }}
              className="px-4 py-2 text-sm border rounded-md hover:bg-muted/50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                createMut.mutate({
                  name,
                  description,
                  variants: [
                    { name: 'Control', config: {}, trafficPercent: 50 },
                    { name: 'Variant A', config: {}, trafficPercent: 50 },
                  ],
                });
              }}
              disabled={!name || createMut.isPending}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {createMut.isPending ? 'Creating...' : 'Create Experiment'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : experiments.length === 0 ? (
        <div className="card p-8 text-center text-muted-foreground">
          <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No experiments yet. Create one to start A/B testing.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {experiments.map((exp) => (
            <div key={exp.id} className="card p-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{exp.name}</p>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium border ${EXP_STATUS_STYLES[exp.status] ?? 'bg-muted text-muted-foreground border-border'}`}
                  >
                    {exp.status}
                  </span>
                </div>
                {exp.description && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">{exp.description}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {exp.variants.length} variants &middot; Created{' '}
                  {new Date(exp.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {exp.status === 'draft' && (
                  <button
                    onClick={() => {
                      startMut.mutate(exp.id);
                    }}
                    className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground"
                    title="Start experiment"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                )}
                {exp.status === 'running' && (
                  <button
                    onClick={() => {
                      stopMut.mutate(exp.id);
                    }}
                    className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground"
                    title="Stop experiment"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => {
                    deleteMut.mutate(exp.id);
                  }}
                  className="p-1.5 rounded hover:bg-muted/50 text-destructive"
                  title="Delete experiment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
