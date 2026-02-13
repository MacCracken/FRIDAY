import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Blocks,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
  Terminal,
  Globe,
  Wrench,
} from 'lucide-react';
import {
  fetchMcpServers,
  addMcpServer,
  deleteMcpServer,
  fetchMcpTools,
} from '../api/client';
import { ConfirmDialog } from './common/ConfirmDialog';
import type { McpServerConfig, McpToolDef } from '../types';

type TransportType = 'stdio' | 'sse' | 'streamable-http';

interface AddServerForm {
  name: string;
  description: string;
  transport: TransportType;
  command: string;
  args: string;
  url: string;
  env: Array<{ key: string; value: string }>;
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

export function McpManager() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<AddServerForm>(EMPTY_FORM);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null);

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

  const servers = serversData?.servers ?? [];
  const tools = toolsData?.tools ?? [];

  const addMut = useMutation({
    mutationFn: () => {
      const envRecord: Record<string, string> = {};
      for (const entry of form.env) {
        if (entry.key.trim()) envRecord[entry.key.trim()] = entry.value;
      }
      return addMcpServer({
        name: form.name,
        description: form.description || undefined,
        transport: form.transport,
        command: form.transport === 'stdio' ? form.command || undefined : undefined,
        args: form.transport === 'stdio' && form.args.trim()
          ? form.args.split(/\s+/)
          : undefined,
        url: form.transport !== 'stdio' ? form.url || undefined : undefined,
        env: Object.keys(envRecord).length > 0 ? envRecord : undefined,
        enabled: true,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
      setForm(EMPTY_FORM);
      setShowAddForm(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMcpServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcpServers'] });
      void queryClient.invalidateQueries({ queryKey: ['mcpTools'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMut.mutate();
  };

  const handleAddEnvVar = () => {
    setForm((f) => ({ ...f, env: [...f.env, { key: '', value: '' }] }));
  };

  const handleRemoveEnvVar = (index: number) => {
    setForm((f) => ({ ...f, env: f.env.filter((_, i) => i !== index) }));
  };

  const handleEnvChange = (index: number, field: 'key' | 'value', val: string) => {
    setForm((f) => ({
      ...f,
      env: f.env.map((entry, i) => (i === index ? { ...entry, [field]: val } : entry)),
    }));
  };

  const toolsByServer = tools.reduce<Record<string, McpToolDef[]>>((acc, tool) => {
    const key = tool.serverName || tool.serverId;
    (acc[key] ??= []).push(tool);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove MCP Server"
        message={`Are you sure you want to remove "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteMut.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary flex items-center gap-2">
            <Blocks className="w-5 h-5" />
            MCP Servers
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage external Model Context Protocol servers
          </p>
        </div>
        <div className="flex items-center gap-3">
          {serversData && (
            <span className="text-sm text-muted-foreground">
              {servers.filter((s) => s.enabled).length} enabled / {serversData.total} configured
            </span>
          )}
          <button
            className="btn btn-primary text-sm px-3 py-1.5 flex items-center gap-1"
            onClick={() => {
              setShowAddForm(!showAddForm);
              setForm(EMPTY_FORM);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Server
          </button>
        </div>
      </div>

      {/* Add Server Form */}
      {showAddForm && (
        <div className="card p-4 border-primary border-2">
          <h3 className="font-medium text-sm mb-3">Add MCP Server</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. filesystem-server"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Transport</label>
                <select
                  value={form.transport}
                  onChange={(e) => setForm({ ...form, transport: e.target.value as TransportType })}
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
                onChange={(e) => setForm({ ...form, description: e.target.value })}
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
                    onChange={(e) => setForm({ ...form, command: e.target.value })}
                    placeholder="e.g. npx or python"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Args (space-separated)</label>
                  <input
                    type="text"
                    value={form.args}
                    onChange={(e) => setForm({ ...form, args: e.target.value })}
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
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}

            {/* Environment Variables */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Environment Variables</label>
                <button
                  type="button"
                  onClick={handleAddEnvVar}
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
                    onChange={(e) => handleEnvChange(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-muted-foreground">=</span>
                  <input
                    type="text"
                    value={entry.value}
                    onChange={(e) => handleEnvChange(i, 'value', e.target.value)}
                    placeholder="value"
                    className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveEnvVar(i)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {addMut.isError && (
              <p className="text-xs text-red-400">
                {addMut.error instanceof Error ? addMut.error.message : 'Failed to add server'}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!form.name.trim() || addMut.isPending}
                className="btn btn-primary text-sm px-3 py-1.5"
              >
                {addMut.isPending ? 'Adding...' : 'Add Server'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="btn btn-ghost text-sm px-3 py-1.5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Configured Servers */}
      {servers.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Configured Servers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((server) => {
              const serverTools = tools.filter((t) => t.serverId === server.id);
              return (
                <ServerCard
                  key={server.id}
                  server={server}
                  toolCount={serverTools.length}
                  onDelete={() => setDeleteTarget(server)}
                  isDeleting={deleteMut.isPending}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center text-sm text-muted-foreground">
          No MCP servers configured yet. Click "Add Server" to connect one.
        </div>
      )}

      {/* Discovered Tools */}
      {tools.length > 0 && (
        <div className="card p-4">
          <button
            onClick={() => setToolsExpanded(!toolsExpanded)}
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
              {Object.entries(toolsByServer).map(([serverName, serverTools]) => (
                <div key={serverName}>
                  <h4 className="text-xs font-medium text-muted-foreground mb-1">{serverName}</h4>
                  <div className="space-y-1">
                    {serverTools.map((tool) => (
                      <div
                        key={`${tool.serverId}-${tool.name}`}
                        className="flex items-start gap-2 p-2 rounded bg-muted/30 text-sm"
                      >
                        <Wrench className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <span className="font-mono text-xs">{tool.name}</span>
                          {tool.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ServerCard({
  server,
  toolCount,
  onDelete,
  isDeleting,
}: {
  server: McpServerConfig;
  toolCount: number;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const transportIcon =
    server.transport === 'stdio' ? (
      <Terminal className="w-5 h-5" />
    ) : (
      <Globe className="w-5 h-5" />
    );

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-surface text-muted-foreground">
          {transportIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm truncate">{server.name}</h3>
            <span
              className={`text-xs flex items-center gap-1 ${
                server.enabled ? 'text-green-400' : 'text-muted-foreground'
              }`}
            >
              {server.enabled ? (
                <><Power className="w-3 h-3" /> Enabled</>
              ) : (
                <><PowerOff className="w-3 h-3" /> Disabled</>
              )}
            </span>
          </div>
          {server.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{server.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted/50">{server.transport}</span>
            {server.transport === 'stdio' && server.command && (
              <span className="truncate font-mono">{server.command}</span>
            )}
            {server.transport !== 'stdio' && server.url && (
              <span className="truncate font-mono">{server.url}</span>
            )}
            <span>{toolCount} tools</span>
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
