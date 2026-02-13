import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Plus, Edit2, Trash2, X, CheckCircle2, Eye } from 'lucide-react';
import {
  fetchPersonalities,
  createPersonality,
  updatePersonality,
  deletePersonality,
  activatePersonality,
  fetchPromptPreview,
  fetchModelInfo,
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

  const editingPersonality = editing && editing !== 'new'
    ? personalities.find(p => p.id === editing)
    : null;
  const showActivateToggle = editing !== 'new' && editingPersonality && !editingPersonality.isActive;

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Personalities</h2>
        <button onClick={startCreate} className="btn btn-primary flex items-center gap-1">
          <Plus className="w-4 h-4" /> New Personality
        </button>
      </div>

      {activateError && (
        <div className="card p-3 border-destructive bg-destructive/10 text-destructive text-sm flex items-center justify-between">
          <span>{activateError}</span>
          <button onClick={() => setActivateError(null)} className="btn-ghost p-1"><X className="w-3 h-3" /></button>
        </div>
      )}

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

          <div>
            <label className="block text-sm font-medium mb-1">Default Model</label>
            <select
              value={form.defaultModel ? `${form.defaultModel.provider}/${form.defaultModel.model}` : ''}
              onChange={(e) => {
                if (!e.target.value) {
                  setForm(f => ({ ...f, defaultModel: null }));
                } else {
                  const [provider, ...rest] = e.target.value.split('/');
                  setForm(f => ({ ...f, defaultModel: { provider, model: rest.join('/') } }));
                }
              }}
              className="w-full px-3 py-2 rounded border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Use system default</option>
              {modelData?.available && Object.entries(modelData.available).map(([provider, models]) =>
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

          {showActivateToggle && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={setActiveOnSave}
                onChange={e => setSetActiveOnSave(e.target.checked)}
                className="rounded border-muted-foreground"
              />
              <span className="text-sm">Set as active personality on save</span>
            </label>
          )}

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
          <div key={p.id}>
            <div className={`card p-4 ${p.isActive ? 'border-primary' : ''}`}>
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
                  {p.defaultModel && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Model: {p.defaultModel.provider}/{p.defaultModel.model}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {formatDate(p.createdAt)}
                  </p>
                </div>

                <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                  <button
                    onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
                    className={`btn-ghost p-2 ${previewId === p.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title={`Preview prompt for ${p.name}`}
                    aria-label={`Preview prompt for ${p.name}`}
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {p.isActive ? (
                    <span className="p-2 text-success" title="Active personality">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  ) : (
                    <button
                      onClick={() => activateMut.mutate(p.id)}
                      disabled={activatingId === p.id}
                      className="btn-ghost p-2 text-muted-foreground hover:text-success"
                      title={`Activate ${p.name}`}
                      aria-label={`Activate personality ${p.name}`}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(p)}
                    className="btn-ghost p-2 text-muted-foreground hover:text-foreground"
                    title={`Edit ${p.name}`}
                    aria-label={`Edit personality ${p.name}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(p)}
                    disabled={p.isActive || deleteMut.isPending}
                    className="btn-ghost p-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
                    title={p.isActive ? 'Switch to another personality before deleting' : `Delete ${p.name}`}
                    aria-label={p.isActive ? 'Cannot delete active personality — switch first' : `Delete personality ${p.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Per-personality Prompt Preview */}
            {previewId === p.id && preview && (
              <div className="card p-4 mt-1 border-muted">
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
