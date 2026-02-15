import { useState, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench,
  Store,
  Plus,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Search,
  X,
  Download,
  User,
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
  fetchMarketplaceSkills,
  installMarketplaceSkill,
  uninstallMarketplaceSkill,
  fetchPersonalities,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { Skill, SkillCreate, Personality } from '../types';

type TabType = 'my-skills' | 'marketplace';

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

export function SkillsPage() {
  const location = useLocation();
  const getInitialTab = (): TabType => {
    const path = location.pathname;
    if (path.includes('/marketplace')) return 'marketplace';
    return 'my-skills';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Skills
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Manage your skills and browse the marketplace
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('my-skills')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'my-skills'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Wrench className="w-4 h-4" />
          Personal Skills
        </button>
        <button
          onClick={() => setActiveTab('marketplace')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'marketplace'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Store className="w-4 h-4" />
          Marketplace
        </button>
      </div>

      {activeTab === 'my-skills' && <MySkillsTab />}

      {activeTab === 'marketplace' && <MarketplaceTab />}
    </div>
  );
}

function MySkillsTab() {
  const queryClient = useQueryClient();
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
    personalityId: null,
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

  const { data: personalitiesData } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  const personalities = personalitiesData?.personalities ?? [];
  const activePersonality = personalities.find((p) => p.isActive);

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

  const handleAddTrigger = () => {
    if (triggerInput.trim()) {
      setForm({ ...form, triggerPatterns: [...(form.triggerPatterns || []), triggerInput.trim()] });
      setTriggerInput('');
    }
  };

  const handleRemoveTrigger = (idx: number) => {
    setForm({ ...form, triggerPatterns: (form.triggerPatterns || []).filter((_, i) => i !== idx) });
  };

  const handleSubmit = () => {
    if (editing) {
      updateMut.mutate({ id: editing, d: form });
    } else {
      createMut.mutate(form);
    }
    setEditing(null);
    setForm({
      name: '',
      description: '',
      instructions: '',
      triggerPatterns: [],
      enabled: true,
      source: 'user',
      personalityId: activePersonality?.id ?? null,
    });
  };

  const startEdit = (s: Skill) => {
    setForm({
      name: s.name,
      description: s.description,
      instructions: s.instructions,
      triggerPatterns: s.triggerPatterns || [],
      enabled: s.enabled,
      source: s.source,
      personalityId: s.personalityId ?? null,
    });
    setTriggerInput((s.triggerPatterns || []).join(', '));
    setEditing(s.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setEditing('new');
            setForm({
              name: '',
              description: '',
              instructions: '',
              triggerPatterns: [],
              enabled: true,
              source: 'user',
              personalityId: activePersonality?.id ?? null,
            });
          }}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4 mr-1" /> Add Skill
        </button>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="pending_approval">Pending</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Sources</option>
          <option value="user">User</option>
          <option value="ai_proposed">AI Proposed</option>
          <option value="ai_learned">AI Learned</option>
        </select>
        {pendingCount > 0 && (
          <span className="badge badge-warning">{pendingCount} pending approval</span>
        )}
      </div>

      {editing === 'new' && (
        <div className="card p-4 space-y-4">
          <h3 className="font-semibold">Create New Skill</h3>
          <div className="grid gap-3">
            <input
              className="bg-background border rounded-lg px-3 py-2 text-sm"
              placeholder="Skill name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="bg-background border rounded-lg px-3 py-2 text-sm"
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select
                value={form.personalityId ?? ''}
                onChange={(e) => setForm({ ...form, personalityId: e.target.value || null })}
                className="w-full bg-background border rounded-lg pl-10 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer"
              >
                <option value="">Global (All Personalities)</option>
                {personalities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.isActive ? '(Active)' : ''}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <svg
                  className="w-4 h-4 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
            <textarea
              className="bg-background border rounded-lg px-3 py-2 text-sm min-h-[80px]"
              placeholder="Instructions (what the skill does)"
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
            <div className="flex gap-2">
              <input
                className="bg-background border rounded-lg px-3 py-2 text-sm flex-1"
                placeholder="Trigger patterns (e.g., /mycommand)"
                value={triggerInput}
                onChange={(e) => setTriggerInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTrigger())}
              />
              <button onClick={handleAddTrigger} className="btn btn-ghost">
                Add
              </button>
            </div>
            {(form.triggerPatterns || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(form.triggerPatterns || []).map((p, i) => (
                  <span key={i} className="badge flex items-center gap-1">
                    {p}
                    <button onClick={() => handleRemoveTrigger(i)}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={createMut.isPending}
                className="btn btn-primary"
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
              </button>
              <button onClick={() => setEditing(null)} className="btn btn-ghost">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !skills.length ? (
        <div className="card p-12 text-center">
          <Wrench className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No skills found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-medium">{skill.name}</h3>
                    <span className={`badge ${STATUS_BADGES[skill.status] || 'badge'}`}>
                      {skill.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {SOURCE_LABELS[skill.source] || skill.source}
                    </span>
                    {skill.personalityId && skill.personalityName && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                        {skill.personalityName}
                      </span>
                    )}
                    {!skill.personalityId && (
                      <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                        Global
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
                  {(skill.triggerPatterns || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(skill.triggerPatterns || []).map((p, i) => (
                        <span key={i} className="text-xs bg-muted px-2 py-0.5 rounded">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {skill.status === 'pending_approval' && (
                    <>
                      <button
                        onClick={() => approveMut.mutate(skill.id)}
                        className="btn btn-ghost p-2"
                        title="Approve"
                      >
                        <ThumbsUp className="w-4 h-4 text-success" />
                      </button>
                      <button
                        onClick={() => rejectMut.mutate(skill.id)}
                        className="btn btn-ghost p-2"
                        title="Reject"
                      >
                        <ThumbsDown className="w-4 h-4 text-destructive" />
                      </button>
                    </>
                  )}
                  {skill.status !== 'pending_approval' && (
                    <button
                      onClick={() =>
                        skill.enabled ? disableMut.mutate(skill.id) : enableMut.mutate(skill.id)
                      }
                      className="btn btn-ghost p-2"
                      title={skill.enabled ? 'Disable' : 'Enable'}
                    >
                      {skill.enabled ? (
                        <ToggleRight className="w-5 h-5 text-success" />
                      ) : (
                        <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <button onClick={() => startEdit(skill)} className="btn btn-ghost p-2">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => setDeleteTarget(skill)} className="btn btn-ghost p-2">
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Skill"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          deleteMut.mutate(deleteTarget!.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function MarketplaceTab() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selectedPersonalityId, setSelectedPersonalityId] = useState<string>('');
  const [hasInitialized, setHasInitialized] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', query],
    queryFn: () => fetchMarketplaceSkills(query || undefined),
  });

  const { data: personalitiesData } = useQuery({
    queryKey: ['personalities'],
    queryFn: fetchPersonalities,
  });

  const personalities = personalitiesData?.personalities ?? [];
  const activePersonality = personalities.find((p) => p.isActive);
  const selectedPersonality = personalities.find((p) => p.id === selectedPersonalityId);

  // Set default personality to active one only once when data loads
  useEffect(() => {
    if (activePersonality && !hasInitialized) {
      setSelectedPersonalityId(activePersonality.id);
      setHasInitialized(true);
    }
  }, [activePersonality, hasInitialized]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    void queryClient.invalidateQueries({ queryKey: ['skills'] });
  };

  const installMut = useMutation({
    mutationFn: ({ id, personalityId }: { id: string; personalityId?: string }) =>
      installMarketplaceSkill(id, personalityId),
    onSuccess: invalidate,
  });

  const uninstallMut = useMutation({
    mutationFn: uninstallMarketplaceSkill,
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-6">
      {/* Search and Personality Selector */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            placeholder="Search skills by name, description, or author..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Install to:</span>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <select
              value={selectedPersonalityId}
              onChange={(e) => setSelectedPersonalityId(e.target.value)}
              className="bg-card border border-border rounded-lg pl-10 pr-8 py-2.5 text-sm min-w-[200px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer"
            >
              <option value="">Global (All Personalities)</option>
              {personalities.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <svg
                className="w-4 h-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.skills.length ? (
        <div className="card p-12 text-center">
          <Store className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {query ? 'No skills found' : 'Marketplace is empty'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.skills.map((skill) => (
            <div
              key={skill.id}
              className="card p-4 flex flex-col h-full hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-medium text-sm line-clamp-1 flex-1">{skill.name}</h3>
                <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
                  v{skill.version}
                </span>
              </div>

              {/* Category Tag */}
              <span className="text-[10px] text-muted-foreground mb-2 inline-block">
                {skill.category}
              </span>

              {/* Description */}
              <p className="text-xs text-muted-foreground mb-4 line-clamp-3 flex-1">
                {skill.description}
              </p>

              {/* Footer */}
              <div className="pt-3 border-t border-border mt-auto">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{skill.author}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {skill.downloadCount.toLocaleString()} installs
                  </span>
                </div>

                {skill.installed ? (
                  <button
                    onClick={() => uninstallMut.mutate(skill.id)}
                    disabled={uninstallMut.isPending}
                    className="btn btn-ghost text-destructive flex items-center gap-2 w-full justify-center text-xs py-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Uninstall
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      installMut.mutate({
                        id: skill.id,
                        personalityId: selectedPersonalityId || undefined,
                      })
                    }
                    disabled={installMut.isPending}
                    className="btn btn-primary flex items-center gap-2 w-full justify-center text-xs py-2"
                  >
                    {installMut.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    Install
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
