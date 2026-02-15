import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cable,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
  Terminal,
  Globe,
  Wrench,
  GitBranch,
  FolderOpen,
  Info,
  Eye,
  EyeOff,
  MessageCircle,
  MessageSquare,
  Mail,
  Radio,
  CheckCircle,
  XCircle,
  AlertCircle,
  GitBranch as GitBranchIcon,
  HelpCircle,
  ArrowRightLeft,
  Loader2,
} from 'lucide-react';
import {
  fetchMcpServers,
  addMcpServer,
  deleteMcpServer,
  patchMcpServer,
  fetchMcpTools,
  fetchMcpConfig,
  updateMcpConfig,
  fetchIntegrations,
  fetchAvailablePlatforms,
  createIntegration,
  startIntegration,
  stopIntegration,
  deleteIntegration,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { McpServerConfig, McpToolDef, McpFeatureConfig, IntegrationInfo } from '../types';

const LOCAL_MCP_NAME = 'YEOMAN MCP';

type TransportType = 'stdio' | 'sse' | 'streamable-http';

interface AddServerForm {
  name: string;
  description: string;
  transport: TransportType;
  command: string;
  args: string;
  url: string;
  env: { key: string; value: string }[];
}

const EMPTY_FORM: AddServerForm = {
  name: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: [],
};

interface PlatformMeta {
  name: string;
  description: string;
  icon: React.ReactNode;
  fields: FormFieldDef[];
  setupSteps?: string[];
  oauthUrl?: string;
}

interface FormFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder: string;
  helpText?: string;
}

const BASE_FIELDS: FormFieldDef[] = [
  { key: 'displayName', label: 'Display Name', type: 'text', placeholder: 'Display Name' },
];

const TOKEN_FIELD: FormFieldDef = {
  key: 'botToken',
  label: 'Bot Token',
  type: 'password',
  placeholder: 'Bot Token',
};

const PLATFORM_META: Record<string, PlatformMeta> = {
  telegram: {
    name: 'Telegram',
    description: 'Connect to Telegram Bot API for messaging',
    icon: <MessageCircle className="w-6 h-6" />,
    fields: [...BASE_FIELDS, { ...TOKEN_FIELD, helpText: 'Get from @BotFather on Telegram' }],
    setupSteps: [
      'Open Telegram and search for @BotFather',
      'Send /newbot to create a new bot',
      'Copy the bot token provided',
      'Paste the token above and connect',
    ],
  },
  discord: {
    name: 'Discord',
    description: 'Integrate with Discord servers and channels',
    icon: <Radio className="w-6 h-6" />,
    fields: [
      ...BASE_FIELDS,
      { ...TOKEN_FIELD, helpText: 'Bot token from Discord Developer Portal' },
    ],
    setupSteps: [
      'Go to Discord Developer Portal',
      'Create a new application and add a bot',
      'Enable Message Content Intent',
      'Copy the bot token and use it above',
    ],
  },
  slack: {
    name: 'Slack',
    description: 'Connect to Slack workspaces via Bot API',
    icon: <Mail className="w-6 h-6" />,
    fields: [
      ...BASE_FIELDS,
      { ...TOKEN_FIELD, helpText: 'Bot token (xoxb-...) from Slack App' },
      {
        key: 'appToken',
        label: 'App Token',
        type: 'password',
        placeholder: 'xapp-...',
        helpText: 'App-level token for Socket Mode',
      },
    ],
    setupSteps: [
      'Create app at api.slack.com',
      'Enable Socket Mode',
      'Add bot token scopes: chat:write, app_mentions:read',
      'Install to workspace and copy tokens',
    ],
  },
  github: {
    name: 'GitHub',
    description: 'Receive webhooks from GitHub repositories',
    icon: <GitBranchIcon className="w-6 h-6" />,
    fields: [
      ...BASE_FIELDS,
      {
        key: 'personalAccessToken',
        label: 'Personal Access Token',
        type: 'password' as const,
        placeholder: 'ghp_...',
        helpText: 'Token with repo scope',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        type: 'password' as const,
        placeholder: 'Webhook Secret',
        helpText: 'Secret to verify webhook authenticity',
      },
    ],
    setupSteps: [
      'Generate a Personal Access Token at github.com/settings/tokens',
      'Create a webhook in repo Settings > Webhooks',
      'Set URL to your /api/v1/webhooks/github endpoint',
      'Select events: push, pull_request, issues',
    ],
  },
  cli: {
    name: 'CLI',
    description: 'Local command-line interface (built-in)',
    icon: <Terminal className="w-6 h-6" />,
    fields: BASE_FIELDS,
    setupSteps: [
      'CLI is built-in and always available',
      'Use secureyeoman CLI or REST API to interact',
    ],
  },
  webhook: {
    name: 'Webhook',
    description: 'Generic HTTP webhook for custom integrations',
    icon: <Globe className="w-6 h-6" />,
    fields: [
      ...BASE_FIELDS,
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        type: 'text',
        placeholder: 'https://...',
        helpText: 'URL that will receive POST requests',
      },
      {
        key: 'secret',
        label: 'Secret',
        type: 'password',
        placeholder: 'Webhook Secret',
        helpText: 'Used to sign/verify requests',
      },
    ],
    setupSteps: [
      'Configure your external service to send webhooks',
      'Set the URL to your /api/v1/webhooks/custom endpoint',
      'Optionally set a secret for request verification',
      'Test the connection by triggering an event',
    ],
  },
  googlechat: {
    name: 'Google Chat',
    description: 'Connect to Google Chat spaces via Bot API',
    icon: <MessageSquare className="w-6 h-6" />,
    fields: [
      ...BASE_FIELDS,
      { ...TOKEN_FIELD, helpText: 'Service account JSON key or Bot token' },
      {
        key: 'spaceId',
        label: 'Space ID',
        type: 'text',
        placeholder: 'Spaces/...',
        helpText: 'The Google Chat space to connect to',
      },
    ],
    setupSteps: [
      'Go to Google Cloud Console',
      'Create a project and enable Google Chat API',
      'Create a Service Account and download JSON key',
      'Configure Chat API: add bot, set permissions',
      'Copy the Space ID from the Chat space URL',
    ],
  },
};

type TabType = 'messaging' | 'mcp' | 'oauth';

const STATUS_CONFIG: Record<
  IntegrationInfo['status'],
  { color: string; icon: React.ReactNode; label: string }
> = {
  connected: {
    color: 'text-green-400',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    label: 'Connected',
  },
  disconnected: {
    color: 'text-muted',
    icon: <XCircle className="w-3.5 h-3.5" />,
    label: 'Disconnected',
  },
  error: { color: 'text-red-400', icon: <AlertCircle className="w-3.5 h-3.5" />, label: 'Error' },
  configuring: {
    color: 'text-yellow-400',
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    label: 'Configuring',
  },
};

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ConnectionsPage() {
  const queryClient = useQueryClient();
  const location = useLocation();

  const getInitialTab = (): TabType => {
    const path = location.pathname;
    if (path.includes('/mcp')) return 'mcp';
    if (path.includes('/oauth')) return 'oauth';
    return 'messaging';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);
  const [showAddMcpForm, setShowAddMcpForm] = useState(false);
  const [mcpForm, setMcpForm] = useState<AddServerForm>(EMPTY_FORM);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'mcp' | 'integration';
    item: McpServerConfig | IntegrationInfo;
  } | null>(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [hiddenTools, setHiddenTools] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mcp-hidden-tools');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    localStorage.setItem('mcp-hidden-tools', JSON.stringify([...hiddenTools]));
  }, [hiddenTools]);

  const toggleToolVisibility = useCallback((toolKey: string) => {
    setHiddenTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolKey)) {
        next.delete(toolKey);
      } else {
        next.add(toolKey);
      }
      return next;
    });
  }, []);

  const { data: featureConfig } = useQuery({
    queryKey: ['mcpConfig'],
    queryFn: fetchMcpConfig,
    refetchInterval: 30000,
  });

  const { data: serversData } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: fetchMcpServers,
    refetchInterval: 10000,
  });

  const { data: toolsData } = useQuery({
    queryKey: ['mcpTools'],
    queryFn: fetchMcpTools,
    refetchInterval: 15000,
  });

  const { data: integrationsData } = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    refetchInterval: 10000,
  });

  const { data: platformsData } = useQuery({
    queryKey: ['availablePlatforms'],
    queryFn: fetchAvailablePlatforms,
  });

  const servers = serversData?.servers ?? [];
  const allTools = toolsData?.tools ?? [];
  const integrations = [...(integrationsData?.integrations ?? [])].sort((a, b) =>
    a.displayName.localeCompare(b.displayName)
  );
  const availablePlatforms = new Set(platformsData?.platforms ?? []);
  const hasRegisteredPlatforms = availablePlatforms.size > 0;

  const localServer = servers.find((s) => s.name === LOCAL_MCP_NAME);
  const tools = allTools;

  const externalServers = servers.filter((s) => s.name !== LOCAL_MCP_NAME);
  const activePlatformIds = new Set(integrations.map((i) => i.platform));
  const unregisteredPlatforms = Object.keys(PLATFORM_META)
    .filter((p) => !activePlatformIds.has(p))
    .sort((a, b) => PLATFORM_META[a].name.localeCompare(PLATFORM_META[b].name));

  const toolsByServer = tools.reduce<Record<string, McpToolDef[]>>((acc, tool) => {
    const key = tool.serverName || tool.serverId;
    (acc[key] ??= []).push(tool);
    return acc;
  }, {});

  const featureToggleMut = useMutation({
    mutationFn: async (data: Partial<McpFeatureConfig>) => {
      setIsRestarting(true);
      setToggleError(null);
      return updateMcpConfig(data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['mcpConfig'] }),
        queryClient.invalidateQueries({ queryKey: ['mcpTools'] }),
        queryClient.invalidateQueries({ queryKey: ['mcpServers'] }),
      ]);
      setIsRestarting(false);
    },
    onError: (err: Error) => {
      setIsRestarting(false);
      setToggleError(err.message || 'Failed to update MCP config');
    },
  });

  const addMcpMut = useMutation({
    mutationFn: () => {
      const envRecord: Record<string, string> = {};
      for (const entry of mcpForm.env) {
        if (entry.key.trim()) envRecord[entry.key.trim()] = entry.value;
      }
      return addMcpServer({
        name: mcpForm.name,
        description: mcpForm.description || undefined,
        transport: mcpForm.transport,
        command: mcpForm.transport === 'stdio' ? mcpForm.command || undefined : undefined,
        args:
          mcpForm.transport === 'stdio' && mcpForm.args.trim()
            ? mcpForm.args.split(/\s+/)
            : undefined,
        url: mcpForm.transport !== 'stdio' ? mcpForm.url || undefined : undefined,
        env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        enabled: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
      setMcpForm(EMPTY_FORM);
      setShowAddMcpForm(false);
    },
  });

  const deleteMcpMut = useMutation({
    mutationFn: (id: string) => deleteMcpServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
    },
  });

  const toggleMcpMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      patchMcpServer(id, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
    },
  });

  const createIntegrationMut = useMutation({
    mutationFn: async () => {
      const meta = PLATFORM_META[connectingPlatform!];
      const configFields = meta.fields.filter((f) => f.key !== 'displayName');
      const config: Record<string, unknown> = {};
      for (const field of configFields) {
        if (formData[field.key]) config[field.key] = formData[field.key];
      }
      const integration = await createIntegration({
        platform: connectingPlatform!,
        displayName: formData.displayName || connectingPlatform!,
        enabled: true,
        config,
      });
      await startIntegration(integration.id);
      return integration;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
      setConnectingPlatform(null);
      setFormData({});
    },
  });

  const startIntegrationMut = useMutation({
    mutationFn: (id: string) => startIntegration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const stopIntegrationMut = useMutation({
    mutationFn: (id: string) => stopIntegration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const deleteIntegrationMut = useMutation({
    mutationFn: (id: string) => deleteIntegration(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const handleAddEnvVar = () => {
    setMcpForm((f) => ({ ...f, env: [...f.env, { key: '', value: '' }] }));
  };

  const handleRemoveEnvVar = (index: number) => {
    setMcpForm((f) => ({ ...f, env: f.env.filter((_, i) => i !== index) }));
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', val: string) => {
    setMcpForm((f) => ({
      ...f,
      env: f.env.map((entry, i) => (i === index ? { ...entry, [field]: val } : entry)),
    }));
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === 'mcp') {
      deleteMcpMut.mutate((deleteTarget.item as McpServerConfig).id);
    } else {
      deleteIntegrationMut.mutate((deleteTarget.item as IntegrationInfo).id);
    }
    setDeleteTarget(null);
  };

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.type === 'mcp' ? 'Remove MCP Server' : 'Delete Integration'}
        message={
          deleteTarget
            ? `Are you sure you want to remove "${
                deleteTarget.type === 'mcp'
                  ? (deleteTarget.item as McpServerConfig).name
                  : (deleteTarget.item as IntegrationInfo).displayName
              }"? This cannot be undone.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(null);
        }}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-primary flex items-center gap-2">
            <Cable className="w-5 h-5" />
            Connections
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Manage integrations, MCP servers, and authentication
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ['messaging', 'Messaging', <MessageCircle key="msg" className="w-4 h-4" />],
            ['mcp', 'MCP Servers', <Wrench key="mcp" className="w-4 h-4" />],
            ['oauth', 'OAuth', <ArrowRightLeft key="oauth" className="w-4 h-4" />],
          ] as [TabType, string, React.ReactNode][]
        ).map(([tab, label, icon]) => (
          <button
            key={tab}
            onClick={() => {
              setActiveTab(tab);
            }}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {toggleError && (
        <div className="p-3 rounded border border-destructive bg-destructive/10 text-destructive text-sm">
          MCP toggle error: {toggleError}
        </div>
      )}

      {activeTab === 'messaging' && (
        <MessagingTab
          integrations={integrations}
          platformsData={availablePlatforms}
          hasRegisteredPlatforms={hasRegisteredPlatforms}
          unregisteredPlatforms={unregisteredPlatforms}
          connectingPlatform={connectingPlatform}
          formData={formData}
          onConnectPlatform={setConnectingPlatform}
          onFormDataChange={setFormData}
          onCreateIntegration={createIntegrationMut.mutate}
          isCreating={createIntegrationMut.isPending}
          createError={createIntegrationMut.error}
          onStart={startIntegrationMut.mutate}
          onStop={stopIntegrationMut.mutate}
          onDelete={(id) => {
            setDeleteTarget({ type: 'integration', item: integrations.find((i) => i.id === id)! });
          }}
          isStarting={startIntegrationMut.isPending}
          isStopping={stopIntegrationMut.isPending}
          isDeleting={deleteIntegrationMut.isPending}
        />
      )}

      {activeTab === 'mcp' && (
        <McpTab
          servers={servers}
          externalServers={externalServers}
          localServer={localServer}
          tools={tools}
          toolsByServer={toolsByServer}
          featureConfig={featureConfig}
          showAddForm={showAddMcpForm}
          form={mcpForm}
          toolsExpanded={toolsExpanded}
          hiddenTools={hiddenTools}
          isRestarting={isRestarting}
          onShowAddForm={(show) => {
            setShowAddMcpForm(show);
            setMcpForm(EMPTY_FORM);
          }}
          onFormChange={setMcpForm}
          onAddMcp={addMcpMut.mutate}
          isAdding={addMcpMut.isPending}
          addError={addMcpMut.error}
          onAddEnvVar={handleAddEnvVar}
          onRemoveEnvVar={handleRemoveEnvVar}
          onEnvChange={handleEnvChange}
          onToggle={(id, enabled) => {
            toggleMcpMut.mutate({ id, enabled });
          }}
          isToggling={toggleMcpMut.isPending}
          onDelete={(id) => {
            setDeleteTarget({ type: 'mcp', item: servers.find((s) => s.id === id)! });
          }}
          isDeleting={deleteMcpMut.isPending}
          onFeatureToggle={(data) => {
            featureToggleMut.mutate(data);
          }}
          isFeatureToggling={featureToggleMut.isPending}
          onToggleToolsExpanded={() => {
            setToolsExpanded(!toolsExpanded);
          }}
          onToggleToolVisibility={toggleToolVisibility}
        />
      )}

      {activeTab === 'oauth' && (
        <OAuthTab
          integrations={integrations}
          onDelete={(id) => {
            setDeleteTarget({ type: 'integration', item: integrations.find((i) => i.id === id)! });
          }}
          isDeleting={deleteIntegrationMut.isPending}
        />
      )}
    </div>
  );
}

function MessagingTab({
  integrations,
  platformsData,
  hasRegisteredPlatforms,
  unregisteredPlatforms,
  connectingPlatform,
  formData,
  onConnectPlatform,
  onFormDataChange,
  onCreateIntegration,
  isCreating,
  createError,
  onStart,
  onStop,
  onDelete,
  isStarting,
  isStopping,
  isDeleting,
}: {
  integrations: IntegrationInfo[];
  platformsData: Set<string>;
  hasRegisteredPlatforms: boolean;
  unregisteredPlatforms: string[];
  connectingPlatform: string | null;
  formData: Record<string, string>;
  onConnectPlatform: (platform: string | null) => void;
  onFormDataChange: (data: Record<string, string>) => void;
  onCreateIntegration: () => void;
  isCreating: boolean;
  createError: Error | null;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  isStarting: boolean;
  isStopping: boolean;
  isDeleting: boolean;
}) {
  return (
    <div className="space-y-6">
      {!hasRegisteredPlatforms && (
        <div className="card p-4 border-l-4 border-l-yellow-500 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div>
              <p className="font-medium text-sm">No platform adapters registered</p>
              <p className="text-xs text-muted mt-1">
                Platform adapters (Telegram, Discord, etc.) need to be installed and registered. See
                the integration documentation for setup instructions.
              </p>
            </div>
          </div>
        </div>
      )}

      {integrations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted">Configured Integrations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onStart={onStart}
                onStop={onStop}
                onDelete={onDelete}
                isStarting={isStarting}
                isStopping={isStopping}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Available Platforms</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {unregisteredPlatforms.map((platformId) => {
            const meta = PLATFORM_META[platformId];
            const isRegistered = platformsData.has(platformId);

            if (connectingPlatform === platformId) {
              return (
                <div key={platformId} className="card p-4 border-primary border-2">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-sm">Connect {meta.name}</h3>
                  </div>
                  {meta.setupSteps && (
                    <div className="mb-4 p-3 bg-surface rounded-md">
                      <p className="text-xs font-medium text-muted mb-2">Setup Steps</p>
                      <ol className="text-xs space-y-1">
                        {meta.setupSteps.map((step, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-muted">{idx + 1}.</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      onCreateIntegration();
                    }}
                    className="space-y-3"
                  >
                    {meta.fields.map((field) => (
                      <div key={field.key}>
                        <label className="text-xs text-muted block mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          value={formData[field.key] || ''}
                          onChange={(e) => {
                            onFormDataChange({ ...formData, [field.key]: e.target.value });
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        {field.helpText && (
                          <p className="text-xs text-muted mt-1 flex items-center gap-1">
                            <HelpCircle className="w-3 h-3" />
                            {field.helpText}
                          </p>
                        )}
                      </div>
                    ))}
                    {createError && (
                      <p className="text-xs text-red-400">
                        {createError.message || 'Connection failed'}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={!formData.displayName || isCreating}
                        className="btn btn-primary text-xs px-3 py-1.5"
                      >
                        {isCreating ? 'Connecting...' : 'Connect'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onConnectPlatform(null);
                        }}
                        className="btn btn-ghost text-xs px-3 py-1.5"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              );
            }

            return (
              <div
                key={platformId}
                className={`card p-4 ${isRegistered ? '' : 'opacity-60 cursor-not-allowed'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-surface text-muted">{meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm">{meta.name}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          isRegistered ? 'bg-green-500/10 text-green-400' : 'bg-surface text-muted'
                        }`}
                      >
                        {isRegistered ? 'Available' : 'Coming Soon'}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1">{meta.description}</p>
                    {isRegistered && (
                      <button
                        onClick={() => {
                          onConnectPlatform(platformId);
                        }}
                        className="btn btn-primary text-xs px-3 py-1.5 mt-2"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  onStart,
  onStop,
  onDelete,
  isStarting,
  isStopping,
  isDeleting,
}: {
  integration: IntegrationInfo;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  isStarting: boolean;
  isStopping: boolean;
  isDeleting: boolean;
}) {
  const meta = PLATFORM_META[integration.platform] ?? {
    name: integration.platform,
    description: '',
    icon: <Globe className="w-6 h-6" />,
    fields: BASE_FIELDS,
  };
  const statusConfig = STATUS_CONFIG[integration.status];
  const isConnected = integration.status === 'connected';
  const isLoading = isStarting || isStopping || isDeleting;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-surface text-muted">{meta.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">{integration.displayName}</h3>
            <span className={`text-xs flex items-center gap-1 ${statusConfig.color}`}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">{meta.name}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted">
            <span>{integration.messageCount} messages</span>
            {integration.lastMessageAt && (
              <span>Last: {formatRelativeTime(integration.lastMessageAt)}</span>
            )}
          </div>
          {integration.errorMessage && (
            <p className="text-xs text-red-400 mt-1 truncate" title={integration.errorMessage}>
              {integration.errorMessage}
            </p>
          )}
          {integration.status === 'error' && (
            <button
              onClick={() => {
                onStart(integration.id);
              }}
              disabled={isLoading}
              className="text-xs text-primary mt-1"
            >
              Retry
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
        {isConnected ? (
          <button
            onClick={() => {
              onStop(integration.id);
            }}
            disabled={isLoading}
            className="text-xs text-muted hover:text-destructive transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => {
              onStart(integration.id);
            }}
            disabled={isLoading}
            className="text-xs text-muted hover:text-primary transition-colors"
          >
            Start
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete ${integration.displayName}?`)) onDelete(integration.id);
          }}
          disabled={isLoading}
          className="text-xs text-muted hover:text-destructive transition-colors ml-auto"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function McpTab({
  servers,
  externalServers,
  localServer,
  tools,
  toolsByServer,
  featureConfig,
  showAddForm,
  form,
  toolsExpanded,
  hiddenTools,
  isRestarting,
  onShowAddForm,
  onFormChange,
  onAddMcp,
  isAdding,
  addError,
  onAddEnvVar,
  onRemoveEnvVar,
  onEnvChange,
  onToggle,
  isToggling,
  onDelete,
  isDeleting,
  onFeatureToggle,
  isFeatureToggling,
  onToggleToolsExpanded,
  onToggleToolVisibility,
}: {
  servers: McpServerConfig[];
  externalServers: McpServerConfig[];
  localServer?: McpServerConfig;
  tools: McpToolDef[];
  toolsByServer: Record<string, McpToolDef[]>;
  featureConfig?: McpFeatureConfig;
  showAddForm: boolean;
  form: AddServerForm;
  toolsExpanded: boolean;
  hiddenTools: Set<string>;
  isRestarting: boolean;
  onShowAddForm: (show: boolean) => void;
  onFormChange: (form: AddServerForm) => void;
  onAddMcp: () => void;
  isAdding: boolean;
  addError: Error | null;
  onAddEnvVar: () => void;
  onRemoveEnvVar: (index: number) => void;
  onEnvChange: (index: number, field: 'key' | 'value', val: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  isToggling: boolean;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  onFeatureToggle: (data: Partial<McpFeatureConfig>) => void;
  isFeatureToggling: boolean;
  onToggleToolsExpanded: () => void;
  onToggleToolVisibility: (toolKey: string) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
          {servers.filter((s) => s.enabled).length} enabled / {servers.length} configured
        </span>
        <button
          className="btn btn-primary text-sm px-3 py-1.5 flex items-center gap-1 whitespace-nowrap"
          onClick={() => {
            onShowAddForm(!showAddForm);
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Server
        </button>
      </div>

      {showAddForm && (
        <div className="card p-4 border-primary border-2">
          <h3 className="font-medium text-sm mb-3">Add MCP Server</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAddMcp();
            }}
            className="space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    onFormChange({ ...form, name: e.target.value });
                  }}
                  placeholder="e.g. filesystem-server"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Transport</label>
                <select
                  value={form.transport}
                  onChange={(e) => {
                    onFormChange({ ...form, transport: e.target.value as TransportType });
                  }}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="stdio">stdio</option>
                  <option value="sse">sse</option>
                  <option value="streamable-http">streamable-http</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => {
                  onFormChange({ ...form, description: e.target.value });
                }}
                placeholder="Optional description"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {form.transport === 'stdio' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Command</label>
                  <input
                    type="text"
                    value={form.command}
                    onChange={(e) => {
                      onFormChange({ ...form, command: e.target.value });
                    }}
                    placeholder="e.g. npx or python"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Args (space-separated)
                  </label>
                  <input
                    type="text"
                    value={form.args}
                    onChange={(e) => {
                      onFormChange({ ...form, args: e.target.value });
                    }}
                    placeholder="e.g. -y @modelcontextprotocol/server-filesystem /tmp"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">URL</label>
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => {
                    onFormChange({ ...form, url: e.target.value });
                  }}
                  placeholder="https://example.com/mcp"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Environment Variables</label>
                <button
                  type="button"
                  onClick={onAddEnvVar}
                  className="text-xs text-primary hover:text-primary/80"
                >
                  + Add Variable
                </button>
              </div>
              {form.env.map((entry, i) => (
                <div key={i} className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={entry.key}
                    onChange={(e) => {
                      onEnvChange(i, 'key', e.target.value);
                    }}
                    placeholder="KEY"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-muted-foreground">=</span>
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(e) => {
                      onEnvChange(i, 'value', e.target.value);
                    }}
                    placeholder="value"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveEnvVar(i);
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {addError && (
              <p className="text-xs text-red-400">{addError.message || 'Failed to add server'}</p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!form.name.trim() || isAdding}
                className="btn btn-primary text-sm px-3 py-1.5"
              >
                {isAdding ? 'Adding...' : 'Add Server'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onShowAddForm(false);
                }}
                className="btn btn-ghost text-sm px-3 py-1.5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {localServer && (
        <LocalServerCard
          server={localServer}
          toolCount={tools.filter((t) => t.serverId === localServer.id).length}
          onDelete={() => {
            onDelete(localServer.id);
          }}
          onToggle={(enabled) => {
            onToggle(localServer.id, enabled);
          }}
          isToggling={isToggling}
          isDeleting={isDeleting}
          isRestarting={isRestarting}
          featureConfig={featureConfig}
          onFeatureToggle={onFeatureToggle}
          isFeatureToggling={isFeatureToggling}
        />
      )}

      {externalServers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Configured Servers</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            {externalServers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                toolCount={tools.filter((t) => t.serverId === server.id).length}
                onDelete={() => {
                  onDelete(server.id);
                }}
                onToggle={(enabled) => {
                  onToggle(server.id, enabled);
                }}
                isToggling={isToggling}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        </div>
      )}

      {!localServer && externalServers.length === 0 && (
        <div className="card p-6 text-center text-sm text-muted-foreground">
          No MCP servers configured yet. Click "Add Server" to connect one.
        </div>
      )}

      {tools.length > 0 && (
        <div className="card p-4">
          <button
            onClick={onToggleToolsExpanded}
            className="flex items-center gap-2 w-full text-left"
          >
            {toolsExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
            <Wrench className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Discovered Tools</span>
            <span className="text-xs text-muted-foreground ml-auto">{tools.length} tools</span>
          </button>

          {toolsExpanded && (
            <div className="mt-3 space-y-3">
              {Object.entries(toolsByServer).map(([serverName, serverTools]) => {
                const isLocal = serverName === LOCAL_MCP_NAME;
                return (
                  <div key={serverName}>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">{serverName}</h4>
                    <div className="space-y-1">
                      {serverTools.map((tool) => {
                        const toolKey = `${tool.serverId}:${tool.name}`;
                        const isHidden = hiddenTools.has(toolKey);
                        return (
                          <div
                            key={toolKey}
                            className={`flex items-start gap-2 p-2 rounded bg-muted/30 text-sm ${isHidden ? 'opacity-40' : ''}`}
                          >
                            <Wrench className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="font-mono text-xs">{tool.name}</span>
                              {tool.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {tool.description}
                                </p>
                              )}
                            </div>
                            {!isLocal && (
                              <button
                                onClick={() => {
                                  onToggleToolVisibility(toolKey);
                                }}
                                className="text-muted-foreground hover:text-foreground p-0.5 shrink-0"
                                title={isHidden ? 'Show tool' : 'Hide tool'}
                              >
                                {isHidden ? (
                                  <EyeOff className="w-3 h-3" />
                                ) : (
                                  <Eye className="w-3 h-3" />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LocalServerCard({
  server,
  toolCount,
  onDelete,
  onToggle,
  isToggling,
  isDeleting,
  isRestarting,
  featureConfig,
  onFeatureToggle,
  isFeatureToggling,
}: {
  server: McpServerConfig;
  toolCount: number;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  isToggling: boolean;
  isDeleting: boolean;
  isRestarting: boolean;
  featureConfig?: McpFeatureConfig;
  onFeatureToggle: (data: Partial<McpFeatureConfig>) => void;
  isFeatureToggling: boolean;
}) {
  return (
    <div className={`card p-3 sm:p-4 ${!server.enabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <div
          className={`p-1.5 sm:p-2 rounded-lg shrink-0 transition-colors ${isRestarting ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' : 'bg-surface text-muted-foreground'}`}
        >
          <Wrench className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-sm truncate">{server.name}</h3>
            <button
              onClick={() => {
                onToggle(!server.enabled);
              }}
              disabled={isToggling}
              className={`text-xs flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full transition-colors ${
                server.enabled
                  ? 'text-green-400 hover:bg-green-400/10'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {server.enabled ? (
                <>
                  <Power className="w-3 h-3" /> Enabled
                </>
              ) : (
                <>
                  <PowerOff className="w-3 h-3" /> Disabled
                </>
              )}
            </button>
          </div>
          {server.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{server.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-xs text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted/50">{server.transport}</span>
            <span className="shrink-0">{toolCount} tools</span>
            {isRestarting && <span className="text-yellow-400 animate-pulse">Reloading...</span>}
          </div>
        </div>
      </div>

      {featureConfig && server.enabled && (
        <div className="mt-3 pt-3 border-t border-border">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            Feature Toggles
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-center gap-2.5 p-2 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
              <GitBranchIcon className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">Git & GitHub</span>
              </div>
              <input
                type="checkbox"
                checked={featureConfig.exposeGit}
                onChange={(e) => {
                  onFeatureToggle({ exposeGit: e.target.checked });
                }}
                disabled={isFeatureToggling}
                className="w-3.5 h-3.5 rounded accent-primary shrink-0"
              />
            </label>
            <label className="flex items-center gap-2.5 p-2 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
              <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium">Filesystem</span>
              </div>
              <input
                type="checkbox"
                checked={featureConfig.exposeFilesystem}
                onChange={(e) => {
                  onFeatureToggle({ exposeFilesystem: e.target.checked });
                }}
                disabled={isFeatureToggling}
                className="w-3.5 h-3.5 rounded accent-primary shrink-0"
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
        {featureConfig && server.enabled && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Info className="w-2.5 h-2.5" />
            Feature toggles control which tool categories are available. To grant a personality access, edit the personality and enable MCP connections.
          </p>
        )}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" />
          Remove
        </button>
      </div>
    </div>
  );
}

function ServerCard({
  server,
  toolCount,
  onDelete,
  onToggle,
  isToggling,
  isDeleting,
}: {
  server: McpServerConfig;
  toolCount: number;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  isToggling: boolean;
  isDeleting: boolean;
}) {
  const transportIcon =
    server.transport === 'stdio' ? <Terminal className="w-5 h-5" /> : <Globe className="w-5 h-5" />;

  return (
    <div className={`card p-3 sm:p-4 ${!server.enabled ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <div className="p-1.5 sm:p-2 rounded-lg bg-surface text-muted-foreground shrink-0">
          {transportIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium text-sm truncate">{server.name}</h3>
            <button
              onClick={() => {
                onToggle(!server.enabled);
              }}
              disabled={isToggling}
              className={`text-xs flex items-center gap-1 shrink-0 px-2 py-0.5 rounded-full transition-colors ${
                server.enabled
                  ? 'text-green-400 hover:bg-green-400/10'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {server.enabled ? (
                <>
                  <Power className="w-3 h-3" /> Enabled
                </>
              ) : (
                <>
                  <PowerOff className="w-3 h-3" /> Disabled
                </>
              )}
            </button>
          </div>
          {server.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{server.description}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-xs text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted/50">{server.transport}</span>
            {server.transport === 'stdio' && server.command && (
              <span className="truncate font-mono max-w-[120px] sm:max-w-[200px]">
                {server.command}
              </span>
            )}
            {server.transport !== 'stdio' && server.url && (
              <span className="truncate font-mono max-w-[120px] sm:max-w-[200px]">
                {server.url}
              </span>
            )}
            <span className="shrink-0">{toolCount} tools</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto flex items-center gap-1"
        >
          <Trash2 className="w-3 h-3" />
          Remove
        </button>
      </div>
    </div>
  );
}

function OAuthTab({
  integrations,
  onDelete,
  isDeleting,
}: {
  integrations: IntegrationInfo[];
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const oauthProviders = [
    {
      id: 'google_oauth',
      name: 'Google',
      description: 'Sign in with Google account',
      icon: <Globe className="w-6 h-6" />,
      oauthUrl: '/api/v1/auth/oauth/google',
    },
    {
      id: 'github_oauth',
      name: 'GitHub',
      description: 'Sign in with GitHub account',
      icon: <GitBranchIcon className="w-6 h-6" />,
      oauthUrl: '/api/v1/auth/oauth/github',
    },
  ];

  const connectedOAuth = integrations.filter((i) => i.platform.endsWith('_oauth'));

  const handleOAuthConnect = (oauthUrl: string) => {
    window.location.href = oauthUrl;
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Connect your account with OAuth providers for secure authentication. OAuth connections allow
        you to sign in using your existing accounts from supported providers.
      </p>

      {connectedOAuth.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted">Connected OAuth Providers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {connectedOAuth.map((integration) => (
              <div key={integration.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <h3 className="font-medium text-sm">{integration.displayName}</h3>
                      <p className="text-xs text-muted-foreground">Connected</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Disconnect ${integration.displayName}?`))
                        onDelete(integration.id);
                    }}
                    disabled={isDeleting}
                    className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Available OAuth Providers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {oauthProviders.map((provider) => {
            const isConnected = connectedOAuth.some((i) => i.platform === provider.id);

            return (
              <div key={provider.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-surface text-muted">{provider.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm">{provider.name}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          isConnected
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-green-500/10 text-green-400'
                        }`}
                      >
                        {isConnected ? 'Connected' : 'Available'}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1">{provider.description}</p>
                    {!isConnected && (
                      <button
                        onClick={() => handleOAuthConnect(provider.oauthUrl)}
                        className="btn btn-primary text-xs px-3 py-1.5 mt-2"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
