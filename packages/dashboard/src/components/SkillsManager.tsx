import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench,
  Plus,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ThumbsUp,
  ThumbsDown,
  Filter,
} from 'lucide-react';
import {
  fetchSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  enableSkill,
  disableSkill,
  approveSkill,
  rejectSkill,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { Skill, SkillCreate } from '../types';

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const SOURCE_LABELS: Record<string, string> = {
  user: 'User',
  ai_proposed: 'AI Proposed',
  ai_learned: 'AI Learned',
  marketplace: 'Marketplace',
};

const STATUS_BADGES: Record<string, string> = {
  active: 'badge-success',
  pending_approval: 'badge-warning',
  disabled: 'badge-error',
};

export function SkillsManager() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [form, setForm] = useState<SkillCreate>({
    name: '',
    description: '',
    instructions: '',
    triggerPatterns: [],
    enabled: true,
    source: 'user',
  });
  const [triggerInput, setTriggerInput] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['skills', filterStatus, filterSource],
    queryFn: () =>
      fetchSkills({
        status: filterStatus || undefined,
        source: filterSource || undefined,
      }),
  });

  const skills = data?.skills ?? [];
  const pendingCount = skills.filter((s) => s.status === 'pending_approval').length;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['skills'] });

  const createMut = useMutation({
    mutationFn: (d: SkillCreate) => createSkill(d),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Partial<SkillCreate> }) => updateSkill(id, d),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSkill(id),
    onSuccess: invalidate,
  });

  const enableMut = useMutation({
    mutationFn: (id: string) => enableSkill(id),
    onSuccess: invalidate,
  });
  const disableMut = useMutation({
    mutationFn: (id: string) => disableSkill(id),
    onSuccess: invalidate,
  });
  const approveMut = useMutation({
    mutationFn: (id: string) => approveSkill(id),
    onSuccess: invalidate,
  });
  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectSkill(id),
    onSuccess: invalidate,
  });

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      const pName = searchParams.get('name') || '';
      const pDescription = searchParams.get('description') || '';
      const pTrigger = searchParams.get('trigger') || '';
      const pAction = searchParams.get('action') || '';
      setForm({
        name: pName,
        description: pDescription,
        instructions: pAction,
        triggerPatterns: pTrigger ? pTrigger.split(',').map((t) => t.trim()) : [],
        enabled: true,
        source: 'user',
      });
      setTriggerInput(pTrigger);
      setEditing('new');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const startEdit = (s: Skill) => {
    setForm({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      triggerPatterns: s.triggerPatterns,
      enabled: s.enabled,
      source: s.source,
    });
    setTriggerInput(s.triggerPatterns.join(', '));
    setEditing(s.id);
  };

  const startCreate = () => {
    setForm({
      name: '',
      description: '',
      instructions: '',
      triggerPatterns: [],
      enabled: true,
      source: 'user',
    });
    setTriggerInput('');
    setEditing('new');
  };

  const handleSave = () => {
    const patterns = triggerInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const data = { ...form, triggerPatterns: patterns };
    if (editing === 'new') {
      createMut.mutate(data);
    } else if (editing) {
      updateMut.mutate({ id: editing, d: data });
    }
  };

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      deleteMut.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteMut]);

  return (
    <div className="space-y-6">
      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Skill"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Header + Filters */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">Skills</h2>
          {pendingCount > 0 && (
            <span className="badge badge-warning">{pendingCount} pending approval</span>
          )}
        </div>
        <button onClick={startCreate} className="btn btn-primary flex items-center gap-1">
          <Plus className="w-4 h-4" /> New Skill
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-2 py-1 rounded border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="px-2 py-1 rounded border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          <option value="user">User</option>
          <option value="ai_proposed">AI Proposed</option>
          <option value="ai_learned">AI Learned</option>
          <option value="marketplace">Marketplace</option>
        </select>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

      {/* Editor Form */}
      {editing && (
        <div className="card p-4 space-y-4 border-primary">
          <h3 className="font-medium">{editing === 'new' ? 'Create Skill' : 'Edit Skill'}</h3>

          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              maxLength={100}
              placeholder="e.g., Code Review"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              maxLength={1000}
              placeholder="What this skill does"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Instructions</label>
            <textarea
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
              rows={4}
              maxLength={8000}
              placeholder="Detailed instructions for the AI when this skill is active..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              {(form.instructions?.length ?? 0).toLocaleString()} / 8,000 chars
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Trigger Patterns</label>
            <input
              type="text"
              value={triggerInput}
              onChange={(e) => setTriggerInput(e.target.value)}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Comma-separated patterns, e.g., review code, check PR, analyze diff"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Patterns that activate this skill when matched in user input.
            </p>
          </div>

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

      {/* Skills List */}
      <div className="space-y-3">
        {skills.map((s) => (
          <div key={s.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Wrench className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <h3 className="font-medium">{s.name}</h3>
                  <span className={`badge ${STATUS_BADGES[s.status] ?? 'badge-info'}`}>
                    {s.status.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {SOURCE_LABELS[s.source] ?? s.source}
                  </span>
                </div>
                {s.description && (
                  <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
                )}
                {s.triggerPatterns.length > 0 && (
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {s.triggerPatterns.map((p, i) => (
                      <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                        {p}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span>Used {s.usageCount} times</span>
                  {s.lastUsedAt && <span>Last: {formatDate(s.lastUsedAt)}</span>}
                  <span>Created {formatDate(s.createdAt)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                {/* Approve/Reject for pending */}
                {s.status === 'pending_approval' && (
                  <>
                    <button
                      onClick={() => approveMut.mutate(s.id)}
                      className="btn-ghost p-2 text-success hover:bg-success/10"
                      aria-label={`Approve skill ${s.name}`}
                    >
                      <ThumbsUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => rejectMut.mutate(s.id)}
                      className="btn-ghost p-2 text-destructive hover:bg-destructive/10"
                      aria-label={`Reject skill ${s.name}`}
                    >
                      <ThumbsDown className="w-4 h-4" />
                    </button>
                  </>
                )}

                {/* Enable/Disable toggle */}
                {s.status !== 'pending_approval' && (
                  <button
                    onClick={() => (s.enabled ? disableMut.mutate(s.id) : enableMut.mutate(s.id))}
                    className={`btn-ghost p-2 ${s.enabled ? 'text-success' : 'text-muted-foreground'}`}
                    aria-label={s.enabled ? `Disable skill ${s.name}` : `Enable skill ${s.name}`}
                  >
                    {s.enabled ? (
                      <ToggleRight className="w-5 h-5" />
                    ) : (
                      <ToggleLeft className="w-5 h-5" />
                    )}
                  </button>
                )}

                <button
                  onClick={() => startEdit(s)}
                  className="btn-ghost p-2 text-muted-foreground hover:text-foreground"
                  aria-label={`Edit skill ${s.name}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(s)}
                  className="btn-ghost p-2 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete skill ${s.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!isLoading && skills.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No skills found. Create one or adjust filters.
          </p>
        )}
      </div>
    </div>
  );
}
