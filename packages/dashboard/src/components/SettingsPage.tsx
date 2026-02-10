import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Key, Plus, Trash2, Copy, Check, Shield, Bot } from 'lucide-react';
import {
  fetchAgentName,
  updateAgentName,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchSoulConfig,
} from '../api/client';
import type { ApiKey, ApiKeyCreateRequest, ApiKeyCreateResponse, SoulConfig } from '../types';

function formatDate(ts: string): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const ROLE_OPTIONS = ['admin', 'operator', 'auditor', 'viewer'] as const;

export function SettingsPage() {
  const queryClient = useQueryClient();

  // ── Agent Name ──────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const { data: agentNameData } = useQuery({
    queryKey: ['agentName'],
    queryFn: fetchAgentName,
  });

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => updateAgentName(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agentName'] });
      setEditingName(false);
    },
  });

  // ── API Keys ────────────────────────────────────────────────
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyForm, setNewKeyForm] = useState<ApiKeyCreateRequest>({
    name: '',
    role: 'viewer',
    expiresInDays: 90,
  });
  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const { data: keysData, isLoading: keysLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: fetchApiKeys,
  });

  const createKeyMutation = useMutation({
    mutationFn: (data: ApiKeyCreateRequest) => createApiKey(data),
    onSuccess: (result) => {
      setCreatedKey(result);
      setShowCreateKey(false);
      setNewKeyForm({ name: '', role: 'viewer', expiresInDays: 90 });
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
  });

  // ── Soul Config ─────────────────────────────────────────────
  const { data: soulConfig } = useQuery({
    queryKey: ['soulConfig'],
    queryFn: fetchSoulConfig,
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-primary flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Settings
        </h2>
        <p className="text-sm text-muted mt-1">
          System configuration and API key management
        </p>
      </div>

      {/* Agent Identity */}
      <div className="card p-4 space-y-3">
        <h3 className="font-medium text-sm flex items-center gap-2">
          <Bot className="w-4 h-4" />
          Agent Identity
        </h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">Agent Name:</span>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                className="input text-sm px-2 py-1"
                autoFocus
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={() => updateNameMutation.mutate(nameInput)}
                disabled={!nameInput.trim() || updateNameMutation.isPending}
              >
                Save
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setEditingName(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium">{agentNameData?.agentName ?? '...'}</span>
              <button
                className="text-xs text-muted hover:text-primary"
                onClick={() => {
                  setNameInput(agentNameData?.agentName ?? '');
                  setEditingName(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {/* API Keys */}
      <div className="card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Key className="w-4 h-4" />
            API Keys
          </h3>
          <button
            className="btn btn-sm btn-primary flex items-center gap-1"
            onClick={() => {
              setShowCreateKey(true);
              setCreatedKey(null);
            }}
          >
            <Plus className="w-3 h-3" />
            Create Key
          </button>
        </div>

        {/* Created key banner */}
        {createdKey && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 space-y-2">
            <p className="text-xs font-medium text-green-400">
              API key created. Copy it now — it won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-surface px-2 py-1 rounded flex-1 overflow-hidden text-ellipsis">
                {createdKey.rawKey}
              </code>
              <button
                className="btn btn-sm flex items-center gap-1"
                onClick={() => copyToClipboard(createdKey.rawKey)}
              >
                {copiedKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedKey ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        {showCreateKey && (
          <div className="p-3 rounded-lg bg-surface space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Name</label>
                <input
                  type="text"
                  value={newKeyForm.name}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, name: e.target.value })}
                  placeholder="e.g. CI Pipeline"
                  className="input text-sm w-full"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Role</label>
                <select
                  value={newKeyForm.role}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, role: e.target.value })}
                  className="input text-sm w-full"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Expires (days)</label>
                <input
                  type="number"
                  value={newKeyForm.expiresInDays ?? ''}
                  onChange={(e) => setNewKeyForm({ ...newKeyForm, expiresInDays: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="90"
                  className="input text-sm w-full"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-sm btn-primary"
                onClick={() => createKeyMutation.mutate(newKeyForm)}
                disabled={!newKeyForm.name.trim() || createKeyMutation.isPending}
              >
                {createKeyMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setShowCreateKey(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Keys list */}
        {keysLoading ? (
          <p className="text-sm text-muted">Loading...</p>
        ) : !keysData?.keys?.length ? (
          <p className="text-sm text-muted">No API keys created yet.</p>
        ) : (
          <div className="space-y-2">
            {keysData.keys.map((key: ApiKey) => (
              <div key={key.id} className="flex items-center justify-between p-2 rounded bg-surface text-sm">
                <div className="flex items-center gap-3">
                  <Key className="w-3 h-3 text-muted" />
                  <span className="font-medium">{key.name}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-background text-muted">{key.role}</span>
                  <span className="text-xs text-muted">
                    {key.prefix}...
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">
                    Created {formatDate(key.createdAt)}
                  </span>
                  <button
                    className="text-red-400 hover:text-red-300"
                    onClick={() => {
                      if (confirm(`Revoke API key "${key.name}"?`)) {
                        revokeKeyMutation.mutate(key.id);
                      }
                    }}
                    title="Revoke key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Soul System Config */}
      {soulConfig && (
        <div className="card p-4 space-y-3">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Soul System
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted block">Status</span>
              <span className={soulConfig.enabled ? 'text-green-400' : 'text-red-400'}>
                {soulConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted block">Learning Mode</span>
              <span>{soulConfig.learningMode.join(', ')}</span>
            </div>
            <div>
              <span className="text-xs text-muted block">Max Skills</span>
              <span>{soulConfig.maxSkills}</span>
            </div>
            <div>
              <span className="text-xs text-muted block">Max Prompt Tokens</span>
              <span>{soulConfig.maxPromptTokens.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
