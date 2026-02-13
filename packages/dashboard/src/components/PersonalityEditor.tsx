import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  User,
  Plus,
  Edit2,
  Trash2,
  X,
  CheckCircle2,
  Eye,
  ChevronDown,
  ChevronRight,
  Save,
  RefreshCw,
  Clock,
} from 'lucide-react';
import {
  fetchPersonalities,
  createPersonality,
  updatePersonality,
  deletePersonality,
  activatePersonality,
  fetchPromptPreview,
  fetchModelInfo,
  fetchPassions,
  createPassion,
  deletePassion,
  fetchInspirations,
  createInspiration,
  deleteInspiration,
  fetchPains,
  createPainEntry,
  deletePain,
  fetchKnowledge,
  learnKnowledge,
  updateKnowledge,
  deleteKnowledge,
  fetchHeartbeatTasks,
  updateHeartbeatTask,
  fetchExternalSyncStatus,
  fetchExternalBrainConfig,
  updateExternalBrainConfig,
  triggerExternalSync,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type {
  Personality,
  PersonalityCreate,
  Passion,
  Inspiration,
  Pain,
  KnowledgeEntry,
  HeartbeatTask,
} from '../types';

const TRAIT_OPTIONS: Record<string, string[]> = {
  formality: ['casual', 'balanced', 'formal'],
  humor: ['none', 'subtle', 'witty'],
  verbosity: ['concise', 'balanced', 'detailed'],
};

const SEX_OPTIONS = ['unspecified', 'male', 'female', 'non-binary'] as const;

const PRIMARY_TOPICS = ['self-identity', 'hierarchy', 'purpose', 'interaction'];

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatIntervalHuman(ms: number): string {
  if (ms >= 3_600_000) {
    const h = Math.round(ms / 3_600_000);
    return `${h}h`;
  }
  if (ms >= 60_000) {
    const m = Math.round(ms / 60_000);
    return `${m}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ── Collapsible Section ─────────────────────────────────────────

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border rounded p-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left font-medium text-sm"
      >
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        {title}
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Spirit Section ──────────────────────────────────────────────

function SpiritSection() {
  const queryClient = useQueryClient();
  const [newPassion, setNewPassion] = useState({ name: '', description: '', intensity: 0.5 });
  const [newInspiration, setNewInspiration] = useState({
    source: '',
    description: '',
    impact: 0.5,
  });
  const [newPain, setNewPain] = useState({ trigger: '', description: '', severity: 0.5 });

  const { data: passionsData } = useQuery({ queryKey: ['passions'], queryFn: fetchPassions });
  const { data: inspirationsData } = useQuery({
    queryKey: ['inspirations'],
    queryFn: fetchInspirations,
  });
  const { data: painsData } = useQuery({ queryKey: ['pains'], queryFn: fetchPains });

  const passions = passionsData?.passions ?? [];
  const inspirations = inspirationsData?.inspirations ?? [];
  const pains = painsData?.pains ?? [];

  const createPassionMut = useMutation({
    mutationFn: () => createPassion(newPassion),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['passions'] });
      setNewPassion({ name: '', description: '', intensity: 0.5 });
    },
  });

  const deletePassionMut = useMutation({
    mutationFn: (id: string) => deletePassion(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['passions'] }),
  });

  const createInspirationMut = useMutation({
    mutationFn: () => createInspiration(newInspiration),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inspirations'] });
      setNewInspiration({ source: '', description: '', impact: 0.5 });
    },
  });

  const deleteInspirationMut = useMutation({
    mutationFn: (id: string) => deleteInspiration(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['inspirations'] }),
  });

  const createPainMut = useMutation({
    mutationFn: () => createPainEntry(newPain),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pains'] });
      setNewPain({ trigger: '', description: '', severity: 0.5 });
    },
  });

  const deletePainMut = useMutation({
    mutationFn: (id: string) => deletePain(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pains'] }),
  });

  return (
    <CollapsibleSection title="Spirit — Passions, Inspirations & Pains">
      {/* Passions */}
      <div>
        <h4 className="text-sm font-medium mb-2">Passions</h4>
        <div className="space-y-1 mb-2">
          {passions.map((p: Passion) => (
            <div
              key={p.id}
              className="flex items-center justify-between text-sm bg-muted px-2 py-1 rounded"
            >
              <span>
                <strong>{p.name}</strong> (intensity: {p.intensity}){' '}
                {p.description && `— ${p.description}`}
              </span>
              <button
                onClick={() => deletePassionMut.mutate(p.id)}
                className="text-destructive hover:text-destructive/80 p-1"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <input
            type="text"
            placeholder="Name"
            value={newPassion.name}
            onChange={(e) => setNewPassion((p) => ({ ...p, name: e.target.value }))}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border bg-background"
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={newPassion.intensity}
            onChange={(e) =>
              setNewPassion((p) => ({ ...p, intensity: parseFloat(e.target.value) }))
            }
            className="w-20"
            title={`Intensity: ${newPassion.intensity}`}
          />
          <button
            onClick={() => createPassionMut.mutate()}
            disabled={!newPassion.name.trim()}
            className="btn btn-primary text-xs px-2 py-1"
          >
            Add
          </button>
        </div>
      </div>

      {/* Inspirations */}
      <div>
        <h4 className="text-sm font-medium mb-2">Inspirations</h4>
        <div className="space-y-1 mb-2">
          {inspirations.map((i: Inspiration) => (
            <div
              key={i.id}
              className="flex items-center justify-between text-sm bg-muted px-2 py-1 rounded"
            >
              <span>
                <strong>{i.source}</strong> (impact: {i.impact}){' '}
                {i.description && `— ${i.description}`}
              </span>
              <button
                onClick={() => deleteInspirationMut.mutate(i.id)}
                className="text-destructive hover:text-destructive/80 p-1"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <input
            type="text"
            placeholder="Source"
            value={newInspiration.source}
            onChange={(e) => setNewInspiration((i) => ({ ...i, source: e.target.value }))}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border bg-background"
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={newInspiration.impact}
            onChange={(e) =>
              setNewInspiration((i) => ({ ...i, impact: parseFloat(e.target.value) }))
            }
            className="w-20"
            title={`Impact: ${newInspiration.impact}`}
          />
          <button
            onClick={() => createInspirationMut.mutate()}
            disabled={!newInspiration.source.trim()}
            className="btn btn-primary text-xs px-2 py-1"
          >
            Add
          </button>
        </div>
      </div>

      {/* Pains */}
      <div>
        <h4 className="text-sm font-medium mb-2">Pain Points</h4>
        <div className="space-y-1 mb-2">
          {pains.map((p: Pain) => (
            <div
              key={p.id}
              className="flex items-center justify-between text-sm bg-muted px-2 py-1 rounded"
            >
              <span>
                <strong>{p.trigger}</strong> (severity: {p.severity}){' '}
                {p.description && `— ${p.description}`}
              </span>
              <button
                onClick={() => deletePainMut.mutate(p.id)}
                className="text-destructive hover:text-destructive/80 p-1"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <input
            type="text"
            placeholder="Trigger"
            value={newPain.trigger}
            onChange={(e) => setNewPain((p) => ({ ...p, trigger: e.target.value }))}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border bg-background"
          />
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={newPain.severity}
            onChange={(e) => setNewPain((p) => ({ ...p, severity: parseFloat(e.target.value) }))}
            className="w-20"
            title={`Severity: ${newPain.severity}`}
          />
          <button
            onClick={() => createPainMut.mutate()}
            disabled={!newPain.trigger.trim()}
            className="btn btn-primary text-xs px-2 py-1"
          >
            Add
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

// ── Brain Section ───────────────────────────────────────────────

function BrainSection() {
  const queryClient = useQueryClient();
  const [teachTopic, setTeachTopic] = useState('');
  const [teachContent, setTeachContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editConfidence, setEditConfidence] = useState(0.5);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);

  const { data: knowledgeData } = useQuery({ queryKey: ['knowledge'], queryFn: fetchKnowledge });
  const knowledge = knowledgeData?.knowledge ?? [];

  const { data: syncStatus } = useQuery({
    queryKey: ['externalSync'],
    queryFn: fetchExternalSyncStatus,
  });

  const { data: brainConfig, refetch: refetchBrainConfig } = useQuery({
    queryKey: ['externalBrainConfig'],
    queryFn: fetchExternalBrainConfig,
  });

  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configForm, setConfigForm] = useState({
    enabled: true,
    provider: 'filesystem',
    path: '',
    subdir: '',
    syncIntervalMs: 0,
  });

  const configMut = useMutation({
    mutationFn: (data: typeof configForm) => updateExternalBrainConfig(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['externalBrainConfig'] });
      void queryClient.invalidateQueries({ queryKey: ['externalSync'] });
      setShowConfigForm(false);
    },
  });

  const learnMut = useMutation({
    mutationFn: () => learnKnowledge(teachTopic, teachContent),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      setTeachTopic('');
      setTeachContent('');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { content?: string; confidence?: number } }) =>
      updateKnowledge(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      setEditingId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteKnowledge(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['knowledge'] }),
  });

  const syncMut = useMutation({
    mutationFn: () => triggerExternalSync(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['externalSync'] }),
  });

  const startEdit = (k: KnowledgeEntry) => {
    setEditingId(k.id);
    setEditContent(k.content);
    setEditConfidence(k.confidence);
  };

  const handleSaveEdit = () => {
    if (editingId) {
      updateMut.mutate({
        id: editingId,
        data: { content: editContent, confidence: editConfidence },
      });
    }
  };

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      deleteMut.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteMut]);

  const isPrimary = (topic: string) => PRIMARY_TOPICS.includes(topic);

  return (
    <CollapsibleSection title="Brain — Knowledge">
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Knowledge Entry"
        message={
          deleteTarget && isPrimary(deleteTarget.topic)
            ? `WARNING: "${deleteTarget.topic}" is a PRIMARY knowledge entry critical to the agent's identity. Deleting it may cause unpredictable behavior. Are you sure?`
            : `Delete knowledge entry "${deleteTarget?.topic}"? This cannot be undone.`
        }
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <div className="space-y-2 mb-3">
        {knowledge.length === 0 && (
          <p className="text-xs text-muted-foreground">No knowledge entries yet.</p>
        )}
        {knowledge.map((k: KnowledgeEntry) => (
          <div key={k.id} className="text-sm bg-muted px-3 py-2 rounded space-y-1">
            {editingId === k.id ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong>[{k.topic}]</strong>
                  {isPrimary(k.topic) && (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                      PRIMARY
                    </span>
                  )}
                </div>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full px-2 py-1 text-sm rounded border bg-background resize-y"
                  rows={3}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-muted-foreground">Confidence:</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={editConfidence}
                    onChange={(e) => setEditConfidence(parseFloat(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-xs">{editConfidence.toFixed(2)}</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => setEditingId(null)}
                    className="btn btn-ghost text-xs px-2 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={updateMut.isPending}
                    className="btn btn-primary text-xs px-2 py-1 flex items-center gap-1"
                  >
                    <Save className="w-3 h-3" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <strong>[{k.topic}]</strong>
                    {isPrimary(k.topic) && (
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                        PRIMARY
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      (confidence: {k.confidence})
                    </span>
                    <span className="text-xs text-muted-foreground">src: {k.source}</span>
                  </div>
                  <p className="mt-0.5">{k.content}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => startEdit(k)}
                    className="btn-ghost p-1 text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(k)}
                    className="btn-ghost p-1 text-muted-foreground hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Teach form */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Teach</h4>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Topic"
            value={teachTopic}
            onChange={(e) => setTeachTopic(e.target.value)}
            className="w-32 px-2 py-1 text-sm rounded border bg-background"
          />
          <input
            type="text"
            placeholder="Content"
            value={teachContent}
            onChange={(e) => setTeachContent(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1 text-sm rounded border bg-background"
          />
          <button
            onClick={() => learnMut.mutate()}
            disabled={!teachTopic.trim() || !teachContent.trim() || learnMut.isPending}
            className="btn btn-primary text-xs px-2 py-1"
          >
            {learnMut.isPending ? 'Teaching...' : 'Teach'}
          </button>
        </div>
      </div>

      {/* External Knowledge Base */}
      <div className="border-t pt-3 mt-3">
        <h4 className="text-sm font-medium mb-2">External Knowledge Base</h4>
        {syncStatus?.configured || brainConfig?.configured ? (
          <div className="space-y-2">
            <div className="text-xs space-y-1">
              <p>
                Provider:{' '}
                <strong>{syncStatus?.provider || brainConfig?.provider || 'Unknown'}</strong>
              </p>
              {(syncStatus as { path?: string })?.path && (
                <p>
                  Path:{' '}
                  <code className="bg-muted px-1 rounded">
                    {(syncStatus as { path?: string })?.path || brainConfig?.path}
                  </code>
                </p>
              )}
              {(syncStatus as { lastSync?: { timestamp: number; entriesExported: number } | null })
                ?.lastSync && (
                <p>
                  Last sync:{' '}
                  {relativeTime(
                    (syncStatus as { lastSync?: { timestamp: number } }).lastSync?.timestamp ?? 0
                  )}{' '}
                  (
                  {(syncStatus as { lastSync?: { entriesExported: number } }).lastSync
                    ?.entriesExported ?? 0}{' '}
                  entries exported)
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => syncMut.mutate()}
                disabled={syncMut.isPending}
                className="btn btn-primary text-xs px-2 py-1 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${syncMut.isPending ? 'animate-spin' : ''}`} />
                {syncMut.isPending ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                onClick={() => setShowConfigForm(!showConfigForm)}
                className="btn btn-ghost text-xs px-2 py-1"
              >
                Configure
              </button>
            </div>
          </div>
        ) : showConfigForm ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Configure external brain sync to export memories and knowledge.
            </p>
            <div className="grid gap-2">
              <label className="text-xs">
                Provider
                <select
                  value={configForm.provider}
                  onChange={(e) => setConfigForm({ ...configForm, provider: e.target.value })}
                  className="w-full mt-1 px-2 py-1 text-sm rounded border bg-background"
                >
                  <option value="filesystem">Filesystem</option>
                  <option value="obsidian">Obsidian</option>
                  <option value="git_repo">Git Repo</option>
                </select>
              </label>
              <label className="text-xs">
                Path
                <input
                  type="text"
                  value={configForm.path}
                  onChange={(e) => setConfigForm({ ...configForm, path: e.target.value })}
                  placeholder="/path/to/vault or /path/to/notes"
                  className="w-full mt-1 px-2 py-1 text-sm rounded border bg-background"
                />
              </label>
              <label className="text-xs">
                Subdirectory (optional)
                <input
                  type="text"
                  value={configForm.subdir}
                  onChange={(e) => setConfigForm({ ...configForm, subdir: e.target.value })}
                  placeholder="e.g., 30 - Resources/FRIDAY"
                  className="w-full mt-1 px-2 py-1 text-sm rounded border bg-background"
                />
              </label>
              <label className="text-xs">
                Sync Interval (minutes, 0 = manual only)
                <input
                  type="number"
                  value={configForm.syncIntervalMs / 60000}
                  onChange={(e) =>
                    setConfigForm({
                      ...configForm,
                      syncIntervalMs: parseInt(e.target.value || '0', 10) * 60000,
                    })
                  }
                  min={0}
                  max={1440}
                  className="w-full mt-1 px-2 py-1 text-sm rounded border bg-background"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => configMut.mutate(configForm)}
                disabled={!configForm.path || configMut.isPending}
                className="btn btn-primary text-xs px-3 py-1"
              >
                {configMut.isPending ? 'Saving...' : 'Save Configuration'}
              </button>
              <button
                onClick={() => setShowConfigForm(false)}
                className="btn btn-ghost text-xs px-3 py-1"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              External brain sync is not configured. Configure it to export memories and knowledge.
            </p>
            <button
              onClick={() => setShowConfigForm(true)}
              className="btn btn-primary text-xs px-3 py-1"
            >
              Configure External Sync
            </button>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

// ── Body Section ────────────────────────────────────────────────

function HeartbeatTasksSection() {
  const queryClient = useQueryClient();
  const { data: tasksData } = useQuery({
    queryKey: ['heartbeatTasks'],
    queryFn: fetchHeartbeatTasks,
  });
  const tasks = tasksData?.tasks ?? [];

  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [editFreqMinutes, setEditFreqMinutes] = useState(5);

  const updateMut = useMutation({
    mutationFn: ({
      name,
      data,
    }: {
      name: string;
      data: { intervalMs?: number; enabled?: boolean };
    }) => updateHeartbeatTask(name, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['heartbeatTasks'] });
      setEditingTask(null);
    },
  });

  const startEdit = (task: HeartbeatTask) => {
    setEditingTask(task.name);
    setEditFreqMinutes(Math.round((task.intervalMs ?? 60_000) / 60_000));
  };

  return (
    <div className="space-y-2">
      {tasks.length === 0 && (
        <p className="text-xs text-muted-foreground">No heartbeat tasks configured.</p>
      )}
      {tasks.map((task: HeartbeatTask) => (
        <div key={task.name} className="text-sm bg-muted px-3 py-2 rounded">
          {editingTask === task.name ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <strong>{task.name}</strong>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
                  {task.type}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs">Frequency (minutes):</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={editFreqMinutes}
                  onChange={(e) => setEditFreqMinutes(parseInt(e.target.value) || 1)}
                  className="w-20 px-2 py-1 text-sm rounded border bg-background"
                />
                <div className="flex-1" />
                <button
                  onClick={() => setEditingTask(null)}
                  className="btn btn-ghost text-xs px-2 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    updateMut.mutate({
                      name: task.name,
                      data: { intervalMs: editFreqMinutes * 60_000 },
                    })
                  }
                  disabled={updateMut.isPending}
                  className="btn btn-primary text-xs px-2 py-1 flex items-center gap-1"
                >
                  <Save className="w-3 h-3" /> Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                <strong>{task.name}</strong>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-accent text-accent-foreground">
                  {task.type}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  every {formatIntervalHuman(task.intervalMs ?? 60_000)}
                </span>
                <span className="text-xs text-muted-foreground">
                  last: {task.lastRunAt ? relativeTime(task.lastRunAt) : 'never'}
                </span>
                {task.type === 'reflective_task' && task.config?.prompt != null && (
                  <span className="text-xs italic text-muted-foreground truncate max-w-48">{`\u201C${String(task.config.prompt)}\u201D`}</span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <label
                  className="relative inline-flex items-center cursor-pointer"
                  title={task.enabled ? 'Enabled' : 'Disabled'}
                >
                  <input
                    type="checkbox"
                    checked={task.enabled}
                    onChange={() =>
                      updateMut.mutate({ name: task.name, data: { enabled: !task.enabled } })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-muted-foreground/30 peer-checked:bg-primary rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-4"></div>
                </label>
                <button
                  onClick={() => startEdit(task)}
                  className="btn-ghost p-1 text-muted-foreground hover:text-foreground"
                  title="Edit frequency"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BodySection() {
  const capabilities = ['vision', 'limb_movement', 'auditory', 'haptic'] as const;

  const [enabledCaps, setEnabledCaps] = useState<Record<string, boolean>>({
    vision: false,
    limb_movement: false,
    auditory: false,
  });

  const capabilityInfo: Record<string, { icon: string; description: string; available: boolean }> =
    {
      vision: {
        icon: '👁️',
        description: 'Screen capture and visual input',
        available: true,
      },
      limb_movement: {
        icon: '⌨️',
        description: 'Keyboard/mouse control and system commands',
        available: true,
      },
      auditory: {
        icon: '👂',
        description: 'Microphone input and audio output',
        available: true,
      },
      haptic: {
        icon: '🖐️',
        description: 'Tactile feedback and notifications',
        available: false,
      },
    };

  const toggleCapability = (cap: string) => {
    setEnabledCaps((prev) => ({ ...prev, [cap]: !prev[cap] }));
  };

  return (
    <CollapsibleSection title="Body — Capabilities & Heart">
      <div>
        <h4 className="text-sm font-medium mb-2">Capabilities</h4>
        <div className="space-y-2">
          {capabilities.map((cap) => {
            const info = capabilityInfo[cap];
            const isEnabled = enabledCaps[cap] ?? false;
            const isConfigurable =
              info.available && (cap === 'vision' || cap === 'auditory' || cap === 'limb_movement');

            return (
              <div
                key={cap}
                className={`text-sm px-3 py-2 rounded flex items-center justify-between border ${
                  isEnabled
                    ? 'bg-success/5 border-success/30'
                    : info.available
                      ? 'bg-muted/50 border-border'
                      : 'bg-muted/30 border-border opacity-60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{info.icon}</span>
                  <div>
                    <span className="capitalize font-medium">{cap.replace('_', ' ')}</span>
                    <p className="text-xs text-muted-foreground">{info.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!info.available ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      Not available
                    </span>
                  ) : isConfigurable ? (
                    <label
                      className="relative inline-flex items-center cursor-pointer"
                      title={isEnabled ? 'Enabled' : 'Disabled'}
                    >
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() => toggleCapability(cap)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-muted-foreground/30 peer-checked:bg-success rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4"></div>
                      <span className="text-xs ml-2 text-muted-foreground peer-checked:text-success">
                        {isEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      Available
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <h4 className="text-sm font-medium mb-2">Heartbeat Tasks</h4>
        <HeartbeatTasksSection />
      </div>
    </CollapsibleSection>
  );
}

// ── Main PersonalityEditor ──────────────────────────────────────

export function PersonalityEditor() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Personality | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [setActiveOnSave, setSetActiveOnSave] = useState(false);
  const [form, setForm] = useState<PersonalityCreate>({
    name: '',
    description: '',
    systemPrompt: '',
    traits: { formality: 'balanced', humor: 'subtle', verbosity: 'concise' },
    sex: 'unspecified',
    voice: '',
    preferredLanguage: '',
    defaultModel: null,
    includeArchetypes: true,
  });

  const { data: personalitiesData, isLoading } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  const { data: preview } = useQuery({
    queryKey: ['promptPreview', previewId],
    queryFn: () => fetchPromptPreview(previewId!),
    enabled: !!previewId,
  });

  const { data: modelData } = useQuery({
    queryKey: ['modelInfo'],
    queryFn: fetchModelInfo,
  });

  const personalities = personalitiesData?.personalities ?? [];

  const createMut = useMutation({
    mutationFn: (data: PersonalityCreate) => createPersonality(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personalities'] });
      setEditing(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PersonalityCreate> }) =>
      updatePersonality(id, data),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['personalities'] });
      if (setActiveOnSave && variables.id) {
        activateMut.mutate(variables.id);
      }
      setEditing(null);
      setSetActiveOnSave(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePersonality(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['personalities'] }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => {
      setActivatingId(id);
      setActivateError(null);
      return activatePersonality(id);
    },
    onSuccess: () => {
      setActivatingId(null);
      void queryClient.invalidateQueries({ queryKey: ['personalities'] });
      void queryClient.invalidateQueries({ queryKey: ['promptPreview'] });
    },
    onError: (err: Error) => {
      setActivatingId(null);
      setActivateError(err.message || 'Failed to activate personality');
    },
  });

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      const pName = searchParams.get('name') || '';
      const pDescription = searchParams.get('description') || '';
      const pModel = searchParams.get('model') || '';
      setForm((prev) => ({
        ...prev,
        name: pName,
        description: pDescription,
        defaultModel: pModel || null,
      }));
      setEditing('new');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const startEdit = (p: Personality) => {
    setForm({
      name: p.name,
      description: p.description,
      systemPrompt: p.systemPrompt,
      traits: p.traits,
      sex: p.sex,
      voice: p.voice,
      preferredLanguage: p.preferredLanguage,
      defaultModel: p.defaultModel,
      includeArchetypes: p.includeArchetypes,
    });
    setSetActiveOnSave(false);
    setEditing(p.id);
  };

  const startCreate = () => {
    setForm({
      name: '',
      description: '',
      systemPrompt: '',
      traits: { formality: 'balanced', humor: 'subtle', verbosity: 'concise' },
      sex: 'unspecified',
      voice: '',
      preferredLanguage: '',
      defaultModel: null,
      includeArchetypes: true,
    });
    setSetActiveOnSave(false);
    setEditing('new');
  };

  const handleSave = () => {
    if (editing === 'new') {
      createMut.mutate(form);
    } else if (editing) {
      updateMut.mutate({ id: editing, data: form });
    }
  };

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      deleteMut.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteMut]);

  const editingPersonality =
    editing && editing !== 'new' ? personalities.find((p) => p.id === editing) : null;
  const showActivateToggle =
    editing !== 'new' && editingPersonality && !editingPersonality.isActive;

  return (
    <div className="space-y-6">
      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Personality"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Personalities</h2>
        <button
          onClick={startCreate}
          className="btn btn-primary flex items-center justify-center gap-1 text-sm sm:text-base"
        >
          <Plus className="w-4 h-4" /> <span className="sm:hidden">New</span>
          <span className="hidden sm:inline">New Personality</span>
        </button>
      </div>

      {activateError && (
        <div className="card p-3 border-destructive bg-destructive/10 text-destructive text-sm flex items-center justify-between">
          <span>{activateError}</span>
          <button onClick={() => setActivateError(null)} className="btn-ghost p-1">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

      {/* Editor Form */}
      {editing && (
        <div className="card p-4 space-y-4 border-primary">
          <h3 className="font-medium">
            {editing === 'new' ? 'Create Personality' : 'Edit Personality'}
          </h3>

          {/* Soul Section */}
          <CollapsibleSection title="Soul — Identity" defaultOpen>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  maxLength={100}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Sex</label>
                <select
                  value={form.sex}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sex: e.target.value as PersonalityCreate['sex'] }))
                  }
                  className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {SEX_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                maxLength={1000}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">System Prompt</label>
              <textarea
                value={form.systemPrompt}
                onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
                rows={4}
                maxLength={8000}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {(form.systemPrompt?.length ?? 0).toLocaleString()} / 8,000 chars
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Traits</label>
              <div className="space-y-2">
                {Object.entries(TRAIT_OPTIONS).map(([trait, options]) => (
                  <div
                    key={trait}
                    className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                  >
                    <span className="text-xs text-muted-foreground sm:w-20 capitalize">
                      {trait}
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() =>
                            setForm((f) => ({ ...f, traits: { ...f.traits, [trait]: opt } }))
                          }
                          className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                            form.traits?.[trait] === opt
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-muted'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Voice</label>
                <input
                  type="text"
                  value={form.voice}
                  onChange={(e) => setForm((f) => ({ ...f, voice: e.target.value }))}
                  className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., warm, professional"
                  maxLength={200}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Preferred Language</label>
                <input
                  type="text"
                  value={form.preferredLanguage}
                  onChange={(e) => setForm((f) => ({ ...f, preferredLanguage: e.target.value }))}
                  className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="e.g., English"
                  maxLength={100}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Default Model</label>
              <select
                value={
                  form.defaultModel
                    ? `${form.defaultModel.provider}/${form.defaultModel.model}`
                    : ''
                }
                onChange={(e) => {
                  if (!e.target.value) {
                    setForm((f) => ({ ...f, defaultModel: null }));
                  } else {
                    const [provider, ...rest] = e.target.value.split('/');
                    setForm((f) => ({ ...f, defaultModel: { provider, model: rest.join('/') } }));
                  }
                }}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Use system default</option>
                {modelData?.available &&
                  Object.entries(modelData.available).map(([provider, models]) =>
                    models.map((m) => (
                      <option key={`${provider}/${m.model}`} value={`${provider}/${m.model}`}>
                        {provider}/{m.model}
                      </option>
                    ))
                  )}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Model to use when chatting with this personality. Can be overridden per-session.
              </p>
            </div>

            <label
              className="flex items-center gap-2 cursor-pointer"
              data-testid="archetype-toggle"
            >
              <input
                type="checkbox"
                checked={form.includeArchetypes ?? true}
                onChange={(e) => setForm((f) => ({ ...f, includeArchetypes: e.target.checked }))}
                className="rounded border-muted-foreground"
              />
              <span className="text-sm">Include Sacred Archetypes preamble in prompt</span>
            </label>
          </CollapsibleSection>

          {/* Spirit Section */}
          <SpiritSection />

          {/* Brain Section */}
          <BrainSection />

          {/* Body Section */}
          <BodySection />

          {showActivateToggle && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={setActiveOnSave}
                onChange={(e) => setSetActiveOnSave(e.target.checked)}
                className="rounded border-muted-foreground"
              />
              <span className="text-sm">Set as active personality on save</span>
            </label>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(null)} className="btn btn-ghost">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!form.name?.trim() || createMut.isPending || updateMut.isPending}
              className="btn btn-primary"
            >
              {createMut.isPending || updateMut.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Personality List */}
      <div
        className={editing ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3'}
      >
        {personalities.map((p) => (
          <div key={p.id}>
            <div
              className={`card p-3 sm:p-4 ${p.isActive ? 'border-primary ring-1 ring-primary/20' : ''} hover:shadow-md transition-shadow`}
            >
              <div className="flex flex-col gap-2">
                {/* Header with name and actions */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 ${p.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                    >
                      <User className="w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h3 className="font-medium text-sm sm:text-base truncate">{p.name}</h3>
                        {p.isActive && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground hidden sm:block">
                        {formatDate(p.createdAt)}
                      </p>
                    </div>
                  </div>

                  {/* Actions - always visible */}
                  <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
                    {p.isActive ? (
                      <span className="p-1.5 sm:p-2 text-success" title="Active personality">
                        <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      </span>
                    ) : (
                      <button
                        onClick={() => activateMut.mutate(p.id)}
                        disabled={activatingId === p.id}
                        className="btn-ghost p-1.5 sm:p-2 text-muted-foreground hover:text-success rounded-lg"
                        title={`Activate ${p.name}`}
                        aria-label={`Activate personality ${p.name}`}
                      >
                        <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(p)}
                      className="btn-ghost p-1.5 sm:p-2 text-muted-foreground hover:text-foreground rounded-lg"
                      title={`Edit ${p.name}`}
                      aria-label={`Edit personality ${p.name}`}
                    >
                      <Edit2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    <button
                      onClick={() => setDeleteTarget(p)}
                      disabled={p.isActive || deleteMut.isPending}
                      className="btn-ghost p-1.5 sm:p-2 text-muted-foreground hover:text-destructive disabled:opacity-30 rounded-lg"
                      title={
                        p.isActive
                          ? 'Switch to another personality before deleting'
                          : `Delete ${p.name}`
                      }
                      aria-label={
                        p.isActive
                          ? 'Cannot delete active personality — switch first'
                          : `Delete personality ${p.name}`
                      }
                    >
                      <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                {p.description && (
                  <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                    {p.description}
                  </p>
                )}

                {/* Tags row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(p.traits)
                    .slice(0, 2)
                    .map(([k, v]) => (
                      <span
                        key={k}
                        className="text-[10px] sm:text-xs bg-muted px-2 py-0.5 rounded-full"
                      >
                        {k}: {v}
                      </span>
                    ))}
                  {Object.keys(p.traits).length > 2 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{Object.keys(p.traits).length - 2}
                    </span>
                  )}
                  {p.sex !== 'unspecified' && (
                    <span className="text-[10px] sm:text-xs bg-muted px-2 py-0.5 rounded-full capitalize">
                      {p.sex}
                    </span>
                  )}
                  {p.defaultModel && (
                    <span className="text-[10px] sm:text-xs bg-muted/50 px-2 py-0.5 rounded-full text-muted-foreground ml-auto">
                      {p.defaultModel.provider}
                    </span>
                  )}
                </div>

                {/* Mobile-only created date */}
                <p className="text-[10px] text-muted-foreground sm:hidden">
                  Created {formatDate(p.createdAt)}
                </p>

                {/* Preview button */}
                <button
                  onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
                  className={`text-xs flex items-center justify-center gap-1 py-1.5 px-2 rounded border transition-colors ${
                    previewId === p.id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-muted hover:border-muted-foreground/30 text-muted-foreground'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  {previewId === p.id ? 'Hide Preview' : 'Preview Prompt'}
                </button>
              </div>
            </div>

            {/* Per-personality Prompt Preview */}
            {previewId === p.id && preview && (
              <div className="card p-3 sm:p-4 mt-2 border-muted bg-muted/30">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-2 gap-2">
                  <h3 className="font-medium text-sm">System Prompt Preview</h3>
                  <div className="flex gap-2 sm:gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{preview.charCount.toLocaleString()} chars</span>
                    <span>~{preview.estimatedTokens.toLocaleString()} tokens</span>
                    {preview.tools.length > 0 && <span>{preview.tools.length} tools</span>}
                  </div>
                </div>
                <pre className="text-[10px] sm:text-xs bg-background p-2 sm:p-3 rounded border overflow-auto max-h-40 sm:max-h-64 whitespace-pre-wrap font-mono">
                  {preview.prompt}
                </pre>
              </div>
            )}
          </div>
        ))}

        {!isLoading && personalities.length === 0 && (
          <div className="col-span-full">
            <div className="text-center py-12 px-4 bg-muted/30 rounded-lg border border-dashed">
              <User className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-2">No personalities yet</p>
              <p className="text-sm text-muted-foreground/70">
                Create your first personality to get started
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
