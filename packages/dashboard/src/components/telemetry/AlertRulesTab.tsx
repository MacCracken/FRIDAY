import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Plus,
  Trash2,
  TestTube,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import {
  listAlertRules,
  createAlertRule,
  patchAlertRule,
  deleteAlertRule,
  testAlertRule,
} from '../../api/client';
import type { AlertRule, AlertChannel } from '../../types';
import { FeatureLock } from '../FeatureLock';

// ── Toast helper ────────────────────────────────────────────────────────────

function Toast({ message, type }: { message: string; type: 'success' | 'error' | 'info' }) {
  const bg = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-md text-white text-sm shadow-lg ${bg}`}
    >
      {message}
    </div>
  );
}

// ── Channel badges ──────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  slack: 'bg-emerald-100 text-emerald-700',
  pagerduty: 'bg-green-100 text-green-700',
  opsgenie: 'bg-orange-100 text-orange-700',
  webhook: 'bg-blue-100 text-blue-700',
  ntfy: 'bg-purple-100 text-purple-700',
};

function ChannelBadge({ type }: { type: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${CHANNEL_COLORS[type] ?? 'bg-muted text-muted-foreground'}`}
    >
      {type}
    </span>
  );
}

// ── Operator labels ─────────────────────────────────────────────────────────

const OPERATOR_LABELS: Record<string, string> = {
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  eq: '=',
};

// ── Rule Templates ─────────────────────────────────────────────────────────

interface RuleTemplate {
  label: string;
  category: string;
  name: string;
  description: string;
  metricPath: string;
  operator: AlertRule['operator'];
  threshold: number | string;
  cooldownSeconds: number;
}

const RULE_TEMPLATES: RuleTemplate[] = [
  {
    label: 'Workflow takes >5 min',
    category: 'Workflows',
    name: 'Slow workflow',
    description: 'Fires when a workflow run exceeds 5 minutes',
    metricPath: 'jobs.workflow.completed.durationMs',
    operator: 'gt',
    threshold: 300000,
    cooldownSeconds: 600,
  },
  {
    label: 'Workflow failure',
    category: 'Workflows',
    name: 'Workflow failure',
    description: 'Fires on any workflow run failure',
    metricPath: 'jobs.workflow.failed.error',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 60,
  },
  {
    label: 'Distillation failure',
    category: 'Training',
    name: 'Distillation failure',
    description: 'Fires when a distillation job fails',
    metricPath: 'jobs.distillation.failed.error',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 60,
  },
  {
    label: 'Distillation low throughput',
    category: 'Training',
    name: 'Distillation low throughput',
    description: 'Fires when a distillation job produces fewer than 50 samples',
    metricPath: 'jobs.distillation.completed.samplesGenerated',
    operator: 'lt',
    threshold: 50,
    cooldownSeconds: 300,
  },
  {
    label: 'Evaluation low accuracy',
    category: 'Training',
    name: 'Evaluation low accuracy',
    description: 'Fires when evaluation exact-match drops below 50%',
    metricPath: 'jobs.evaluation.completed.exactMatch',
    operator: 'lt',
    threshold: 0.5,
    cooldownSeconds: 300,
  },
  {
    label: 'Fine-tune failure',
    category: 'Training',
    name: 'Fine-tune failure',
    description: 'Fires when a fine-tune job fails',
    metricPath: 'jobs.finetune.failed.error',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 60,
  },
  {
    label: 'High rate-limit hits',
    category: 'Security',
    name: 'High rate-limit hits',
    description: 'Fires when total rate-limit hits exceed 100',
    metricPath: 'security.rateLimitHitsTotal',
    operator: 'gt',
    threshold: 100,
    cooldownSeconds: 300,
  },
  {
    label: 'ATHI High Risk Detected',
    category: 'Security',
    name: 'ATHI High Risk Detected',
    description: 'Fires when an ATHI threat scenario has a risk score of 20 or higher',
    metricPath: 'security.athi_threat.risk_score',
    operator: 'gte',
    threshold: 20,
    cooldownSeconds: 600,
  },
  {
    label: 'ATHI Nation-State Threat',
    category: 'Security',
    name: 'ATHI Nation-State Threat',
    description: 'Fires when a nation-state actor is identified in an ATHI scenario',
    metricPath: 'security.athi_threat.actor',
    operator: 'eq',
    threshold: 'nation_state',
    cooldownSeconds: 600,
  },
  {
    label: 'ATHI Unmitigated Critical',
    category: 'Security',
    name: 'ATHI Unmitigated Critical',
    description:
      'Fires when a critical ATHI scenario remains in identified status without mitigations',
    metricPath: 'security.athi_threat.status',
    operator: 'eq',
    threshold: 'identified',
    cooldownSeconds: 3600,
  },
  {
    label: 'Artifact quarantined',
    category: 'Sandbox',
    name: 'Artifact quarantined',
    description: 'Fires when a sandbox artifact is quarantined due to scan findings',
    metricPath: 'sandbox.scanning.quarantineCount',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 60,
  },
  {
    label: 'Critical threat detected',
    category: 'Sandbox',
    name: 'Critical threat detected',
    description: 'Fires when a critical-severity finding is detected in a sandbox artifact',
    metricPath: 'sandbox.scanning.criticalFindings',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 60,
  },
  {
    label: 'High intent score',
    category: 'Sandbox',
    name: 'High intent score',
    description: 'Fires when a threat classifier intent score reaches 0.7 or higher',
    metricPath: 'sandbox.scanning.maxIntentScore',
    operator: 'gte',
    threshold: 0.7,
    cooldownSeconds: 300,
  },
  {
    label: 'Sandbox scan failures',
    category: 'Sandbox',
    name: 'Sandbox scan failures',
    description: 'Fires when the sandbox scan failure rate exceeds 10%',
    metricPath: 'sandbox.scanning.failureRate',
    operator: 'gt',
    threshold: 0.1,
    cooldownSeconds: 600,
  },
  {
    label: 'Repeat offender escalation',
    category: 'Sandbox',
    name: 'Repeat offender escalation',
    description: 'Fires when a repeat offender triggers an escalation',
    metricPath: 'sandbox.scanning.escalations',
    operator: 'gt',
    threshold: 0,
    cooldownSeconds: 300,
  },
];

// ── Create/Edit Form ────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  description: string;
  metricPath: string;
  operator: AlertRule['operator'];
  threshold: string;
  cooldownSeconds: string;
  enabled: boolean;
  channels: AlertChannel[];
}

const BLANK_FORM: RuleFormState = {
  name: '',
  description: '',
  metricPath: '',
  operator: 'gt',
  threshold: '0',
  cooldownSeconds: '300',
  enabled: true,
  channels: [],
};

function RuleForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RuleFormState;
  onSave: (data: RuleFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial ?? BLANK_FORM);

  const set = (k: keyof RuleFormState, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const addChannel = () => {
    setForm((f) => ({ ...f, channels: [...f.channels, { type: 'webhook' as const }] }));
  };

  const removeChannel = (i: number) => {
    setForm((f) => ({ ...f, channels: f.channels.filter((_, idx) => idx !== i) }));
  };

  const updateChannel = (i: number, patch: Partial<AlertChannel>) => {
    setForm((f) => ({
      ...f,
      channels: f.channels.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    }));
  };

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Name *</label>
          <input
            className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm"
            value={form.name}
            onChange={(e) => {
              set('name', e.target.value);
            }}
            placeholder="High rate-limit hits"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">
            Metric path *
            <span className="ml-1 text-xs opacity-60">(e.g. security.rateLimitHitsTotal)</span>
          </label>
          <input
            className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm font-mono"
            value={form.metricPath}
            onChange={(e) => {
              set('metricPath', e.target.value);
            }}
            placeholder="security.rateLimitHitsTotal"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Description</label>
          <input
            className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm"
            value={form.description}
            onChange={(e) => {
              set('description', e.target.value);
            }}
            placeholder="Optional description"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-none">
            <label className="text-xs font-medium text-muted-foreground">Operator</label>
            <select
              className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm"
              value={form.operator}
              onChange={(e) => {
                set('operator', e.target.value);
              }}
            >
              {Object.entries(OPERATOR_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l} ({v})
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">Threshold *</label>
            <input
              type="number"
              className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm"
              value={form.threshold}
              onChange={(e) => {
                set('threshold', e.target.value);
              }}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">Cooldown (s)</label>
            <input
              type="number"
              className="mt-1 w-full px-3 py-1.5 rounded border bg-background text-sm"
              value={form.cooldownSeconds}
              onChange={(e) => {
                set('cooldownSeconds', e.target.value);
              }}
            />
          </div>
        </div>
      </div>

      {/* Channels */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-muted-foreground">Channels</label>
          <button
            type="button"
            onClick={addChannel}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="w-3 h-3" /> Add channel
          </button>
        </div>
        {form.channels.map((ch, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <select
              className="px-2 py-1.5 rounded border bg-background text-sm"
              value={ch.type}
              onChange={(e) => {
                updateChannel(i, { type: e.target.value as AlertChannel['type'] });
              }}
            >
              <option value="slack">Slack</option>
              <option value="pagerduty">PagerDuty</option>
              <option value="opsgenie">OpsGenie</option>
              <option value="webhook">Webhook</option>
              <option value="ntfy">ntfy</option>
            </select>
            {(ch.type === 'slack' || ch.type === 'webhook') && (
              <input
                className="flex-1 px-2 py-1.5 rounded border bg-background text-sm"
                placeholder="https://..."
                value={ch.url ?? ''}
                onChange={(e) => {
                  updateChannel(i, { url: e.target.value });
                }}
              />
            )}
            {(ch.type === 'pagerduty' || ch.type === 'opsgenie') && (
              <input
                className="flex-1 px-2 py-1.5 rounded border bg-background text-sm"
                placeholder="Routing / Genie key"
                value={ch.routingKey ?? ''}
                onChange={(e) => {
                  updateChannel(i, { routingKey: e.target.value });
                }}
              />
            )}
            {ch.type === 'ntfy' && (
              <>
                <input
                  className="flex-1 px-2 py-1.5 rounded border bg-background text-sm"
                  placeholder="https://ntfy.sh/my-topic"
                  value={ch.url ?? ''}
                  onChange={(e) => {
                    updateChannel(i, { url: e.target.value });
                  }}
                />
                <input
                  className="w-36 px-2 py-1.5 rounded border bg-background text-sm"
                  placeholder="Auth token (optional)"
                  value={ch.routingKey ?? ''}
                  onChange={(e) => {
                    updateChannel(i, { routingKey: e.target.value });
                  }}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => {
                removeChannel(i);
              }}
              className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => {
            onSave(form);
          }}
          disabled={saving || !form.name || !form.metricPath}
          className="px-4 py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save rule'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-1.5 rounded border text-sm">
          Cancel
        </button>
        <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
          <span className="text-muted-foreground">Enabled</span>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => {
              set('enabled', e.target.checked);
            }}
            className="w-4 h-4"
          />
        </label>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function AlertRulesTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formInitial, setFormInitial] = useState<RuleFormState | undefined>(undefined);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const templateRef = useRef<HTMLDivElement>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3500);
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: listAlertRules,
  });

  const createMutation = useMutation({
    mutationFn: (form: RuleFormState) =>
      createAlertRule({
        name: form.name,
        description: form.description || undefined,
        metricPath: form.metricPath,
        operator: form.operator,
        threshold: Number(form.threshold),
        cooldownSeconds: Number(form.cooldownSeconds),
        enabled: form.enabled,
        channels: form.channels,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      setShowForm(false);
      showToast('Rule created', 'success');
    },
    onError: (e: Error) => {
      showToast(e.message, 'error');
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<AlertRule> }) =>
      patchAlertRule(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      setEditingId(null);
      showToast('Rule updated', 'success');
    },
    onError: (e: Error) => {
      showToast(e.message, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAlertRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      showToast('Rule deleted', 'success');
    },
    onError: (e: Error) => {
      showToast(e.message, 'error');
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testAlertRule(id),
    onSuccess: (result) => {
      if (result.fired) {
        showToast(`Fired — check your channel (value: ${result.value})`, 'success');
      } else {
        showToast(`Did not fire (value: ${result.value ?? 'n/a'})`, 'info');
      }
    },
    onError: (e: Error) => {
      showToast(e.message, 'error');
    },
  });

  const rules = data?.rules ?? [];

  const handleSaveNew = (form: RuleFormState) => {
    createMutation.mutate(form);
  };

  const handleSaveEdit = (id: string, form: RuleFormState) => {
    patchMutation.mutate({
      id,
      patch: {
        name: form.name,
        description: form.description || undefined,
        metricPath: form.metricPath,
        operator: form.operator,
        threshold: Number(form.threshold),
        cooldownSeconds: Number(form.cooldownSeconds),
        enabled: form.enabled,
        channels: form.channels,
      },
    });
  };

  return (
    <div className="space-y-4">
      {toast && <Toast message={toast.message} type={toast.type} />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5" />
          <h2 className="text-base font-semibold">Alert Rules</h2>
          {rules.length > 0 && (
            <span className="text-xs text-muted-foreground">({rules.length})</span>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-6 text-center">Loading rules…</div>
      )}
      {isError && (
        <div className="text-sm text-destructive py-6 text-center">Failed to load alert rules.</div>
      )}

      {!isLoading && !isError && rules.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Bell className="w-8 h-8 opacity-40" />
          <p className="text-sm">
            No alert rules yet. Create one to get notified when metrics cross thresholds.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="border rounded-lg bg-card">
            {/* Row header */}
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setExpandedId(expandedId === rule.id ? null : rule.id);
                }}
              >
                {expandedId === rule.id ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{rule.name}</span>
                  {rule.channels.map((ch, i) => (
                    <ChannelBadge key={i} type={ch.type} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  <span>{rule.metricPath}</span> <span>{OPERATOR_LABELS[rule.operator]}</span>{' '}
                  <span>{rule.threshold}</span>
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Enabled toggle */}
                <button
                  onClick={() => {
                    patchMutation.mutate({ id: rule.id, patch: { enabled: !rule.enabled } });
                  }}
                  className="p-1.5 rounded hover:bg-muted"
                  title={rule.enabled ? 'Disable' : 'Enable'}
                >
                  {rule.enabled ? (
                    <ToggleRight className="w-5 h-5 text-primary" />
                  ) : (
                    <ToggleLeft className="w-5 h-5 text-muted-foreground" />
                  )}
                </button>

                {/* Test-fire */}
                <button
                  onClick={() => {
                    testMutation.mutate(rule.id);
                  }}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  title="Test-fire"
                >
                  <TestTube className="w-4 h-4" />
                </button>

                {/* Delete */}
                <button
                  onClick={() => {
                    if (window.confirm(`Delete rule "${rule.name}"?`)) {
                      deleteMutation.mutate(rule.id);
                    }
                  }}
                  className="p-1.5 rounded hover:bg-destructive/10 text-destructive"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Expanded: edit form */}
            {expandedId === rule.id && (
              <div className="px-4 pb-4 border-t pt-3">
                {editingId === rule.id ? (
                  <RuleForm
                    initial={{
                      name: rule.name,
                      description: rule.description ?? '',
                      metricPath: rule.metricPath,
                      operator: rule.operator,
                      threshold: String(rule.threshold),
                      cooldownSeconds: String(rule.cooldownSeconds),
                      enabled: rule.enabled,
                      channels: rule.channels,
                    }}
                    onSave={(form) => {
                      handleSaveEdit(rule.id, form);
                    }}
                    onCancel={() => {
                      setEditingId(null);
                    }}
                    saving={patchMutation.isPending}
                  />
                ) : (
                  <div className="space-y-2 text-sm">
                    {rule.description && (
                      <p className="text-muted-foreground">{rule.description}</p>
                    )}
                    <p>
                      <span className="text-muted-foreground">Cooldown:</span>{' '}
                      {rule.cooldownSeconds}s
                    </p>
                    {rule.lastFiredAt && (
                      <p>
                        <span className="text-muted-foreground">Last fired:</span>{' '}
                        {new Date(rule.lastFiredAt).toLocaleString()}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        setEditingId(rule.id);
                      }}
                      className="px-3 py-1.5 rounded border text-sm hover:bg-muted"
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <FeatureLock feature="advanced_observability">
        {showForm && (
          <RuleForm
            initial={formInitial}
            onSave={handleSaveNew}
            onCancel={() => {
              setShowForm(false);
              setFormInitial(undefined);
            }}
            saving={createMutation.isPending}
          />
        )}

        {!showForm && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setFormInitial(undefined);
                setShowForm(true);
              }}
              className="btn btn-sm btn-ghost flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New rule
            </button>

            <div className="relative" ref={templateRef}>
              <button
                onClick={() => {
                  setShowTemplates((v) => !v);
                }}
                className="btn btn-sm btn-ghost flex items-center gap-1.5"
              >
                <FileText className="w-4 h-4" /> From template
              </button>
              {showTemplates && (
                <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-popover border rounded-lg shadow-lg py-1">
                  {Array.from(new Set(RULE_TEMPLATES.map((t) => t.category))).map((cat) => (
                    <div key={cat}>
                      <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {cat}
                      </div>
                      {RULE_TEMPLATES.filter((t) => t.category === cat).map((t) => (
                        <button
                          key={t.label}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                          onClick={() => {
                            setFormInitial({
                              name: t.name,
                              description: t.description,
                              metricPath: t.metricPath,
                              operator: t.operator,
                              threshold: String(t.threshold),
                              cooldownSeconds: String(t.cooldownSeconds),
                              enabled: true,
                              channels: [],
                            });
                            setShowForm(true);
                            setShowTemplates(false);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </FeatureLock>
    </div>
  );
}
