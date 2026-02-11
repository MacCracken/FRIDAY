import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Plus, Edit2, Trash2, Check, X, Star, Eye } from 'lucide-react';
import {
  fetchPersonalities,
  createPersonality,
  updatePersonality,
  deletePersonality,
  activatePersonality,
  fetchAgentName,
  updateAgentName,
  fetchPromptPreview,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { Personality, PersonalityCreate, PromptPreview } from '../types';

const TRAIT_OPTIONS: Record<string, string[]> = {
  formality: ['casual', 'balanced', 'formal'],
  humor: ['none', 'subtle', 'witty'],
  verbosity: ['concise', 'balanced', 'detailed'],
};

const SEX_OPTIONS = ['unspecified', 'male', 'female', 'non-binary'] as const;

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function PersonalityEditor() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [editAgentName, setEditAgentName] = useState(false);
  const [agentNameInput, setAgentNameInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Personality | null>(null);
  const [form, setForm] = useState<PersonalityCreate>({
    name: '',
    description: '',
    systemPrompt: '',
    traits: { formality: 'balanced', humor: 'subtle', verbosity: 'concise' },
    sex: 'unspecified',
    voice: '',
    preferredLanguage: '',
  });

  const { data: personalitiesData, isLoading } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  const { data: agentNameData } = useQuery({
    queryKey: ['agentName'],
    queryFn: fetchAgentName,
  });

  const { data: preview } = useQuery({
    queryKey: ['promptPreview'],
    queryFn: fetchPromptPreview,
    enabled: showPreview,
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personalities'] });
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePersonality(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['personalities'] }),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => activatePersonality(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['personalities'] });
      void queryClient.invalidateQueries({ queryKey: ['promptPreview'] });
    },
  });

  const agentNameMut = useMutation({
    mutationFn: (name: string) => updateAgentName(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agentName'] });
      setEditAgentName(false);
    },
  });

  const startEdit = (p: Personality) => {
    setForm({
      name: p.name,
      description: p.description,
      systemPrompt: p.systemPrompt,
      traits: p.traits,
      sex: p.sex,
      voice: p.voice,
      preferredLanguage: p.preferredLanguage,
    });
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
    });
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

      {/* Agent Name */}
      <div className="card p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Agent Name</p>
            {editAgentName ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={agentNameInput}
                  onChange={e => setAgentNameInput(e.target.value)}
                  className="px-2 py-1 rounded border bg-background text-foreground text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary"
                  maxLength={50}
                />
                <button onClick={() => agentNameMut.mutate(agentNameInput)} className="btn-ghost p-1 text-success" aria-label="Save agent name">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditAgentName(false)} className="btn-ghost p-1 text-muted-foreground" aria-label="Cancel editing">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-lg font-bold">{agentNameData?.agentName ?? 'FRIDAY'}</p>
                <button
                  onClick={() => { setAgentNameInput(agentNameData?.agentName ?? ''); setEditAgentName(true); }}
                  className="btn-ghost p-1 text-muted-foreground hover:text-foreground"
                  aria-label="Edit agent name"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`btn ${showPreview ? 'btn-primary' : 'btn-secondary'} flex items-center gap-1`}
          >
            <Eye className="w-4 h-4" /> Prompt Preview
          </button>
        </div>
      </div>

      {/* Prompt Preview */}
      {showPreview && preview && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="font-medium">Composed System Prompt</h3>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{preview.charCount.toLocaleString()} chars</span>
              <span>~{preview.estimatedTokens.toLocaleString()} tokens</span>
              {preview.tools.length > 0 && <span>{preview.tools.length} tools</span>}
            </div>
          </div>
          <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap">
            {preview.prompt}
          </pre>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Personalities</h2>
        <button onClick={startCreate} className="btn btn-primary flex items-center gap-1">
          <Plus className="w-4 h-4" /> New Personality
        </button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}

      {/* Editor Form */}
      {editing && (
        <div className="card p-4 space-y-4 border-primary">
          <h3 className="font-medium">{editing === 'new' ? 'Create Personality' : 'Edit Personality'}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Sex</label>
              <select
                value={form.sex}
                onChange={e => setForm(f => ({ ...f, sex: e.target.value as PersonalityCreate['sex'] }))}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {SEX_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              maxLength={1000}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">System Prompt</label>
            <textarea
              value={form.systemPrompt}
              onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y"
              rows={4}
              maxLength={8000}
            />
            <p className="text-xs text-muted-foreground mt-1">{(form.systemPrompt?.length ?? 0).toLocaleString()} / 8,000 chars</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Traits</label>
            <div className="space-y-2">
              {Object.entries(TRAIT_OPTIONS).map(([trait, options]) => (
                <div key={trait} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-20 capitalize">{trait}</span>
                  <div className="flex gap-1">
                    {options.map(opt => (
                      <button
                        key={opt}
                        onClick={() => setForm(f => ({ ...f, traits: { ...f.traits, [trait]: opt } }))}
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
                onChange={e => setForm(f => ({ ...f, voice: e.target.value }))}
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
                onChange={e => setForm(f => ({ ...f, preferredLanguage: e.target.value }))}
                className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g., English"
                maxLength={100}
              />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(null)} className="btn btn-ghost">Cancel</button>
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
      <div className="space-y-3">
        {personalities.map(p => (
          <div key={p.id} className={`card p-4 ${p.isActive ? 'border-primary' : ''}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <h3 className="font-medium truncate">{p.name}</h3>
                  {p.isActive && <span className="badge badge-success">Active</span>}
                </div>
                {p.description && (
                  <p className="text-sm text-muted-foreground mt-1 truncate">{p.description}</p>
                )}
                <div className="flex gap-2 mt-2 flex-wrap">
                  {Object.entries(p.traits).map(([k, v]) => (
                    <span key={k} className="text-xs bg-muted px-2 py-0.5 rounded">{k}: {v}</span>
                  ))}
                  {p.sex !== 'unspecified' && (
                    <span className="text-xs bg-muted px-2 py-0.5 rounded">{p.sex}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Created {formatDate(p.createdAt)}
                </p>
              </div>

              <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                {!p.isActive && (
                  <button
                    onClick={() => activateMut.mutate(p.id)}
                    disabled={activateMut.isPending}
                    className="btn-ghost p-2 text-muted-foreground hover:text-success"
                    aria-label={`Activate personality ${p.name}`}
                  >
                    <Star className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => startEdit(p)}
                  className="btn-ghost p-2 text-muted-foreground hover:text-foreground"
                  aria-label={`Edit personality ${p.name}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteTarget(p)}
                  disabled={p.isActive || deleteMut.isPending}
                  className="btn-ghost p-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  aria-label={p.isActive ? 'Cannot delete active personality' : `Delete personality ${p.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!isLoading && personalities.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No personalities yet. Create one to get started.
          </p>
        )}
      </div>
    </div>
  );
}
