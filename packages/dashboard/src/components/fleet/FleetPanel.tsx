/**
 * FleetPanel — Edge node fleet management dashboard panel.
 *
 * Shows topology overview, health metrics, and per-node management actions
 * for all registered edge nodes (A2A peers).
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Server,
  Cpu,
  MemoryStick,
  Wifi,
  WifiOff,
  Loader2,
  RefreshCw,
  Tag,
  Zap,
  Activity,
} from 'lucide-react';
import { fetchA2APeers, getAccessToken } from '../../api/client';

// ── Types ─────────────────────────────────────────────────────────

interface PeerAgent {
  id: string;
  name: string;
  url: string;
  trustLevel: string;
  status: string;
  lastSeen: number;
  capabilities: { name: string; description: string; version: string }[];
}

interface NodeCapabilities {
  nodeId: string;
  hostname: string;
  arch: string;
  platform: string;
  totalMemoryMb: number;
  cpuCores: number;
  hasGpu: boolean;
  tags: string[];
}

interface NodeHealth {
  status: string;
  capabilities: NodeCapabilities;
}

interface EnrichedNode extends PeerAgent {
  health: NodeCapabilities | null;
  healthLoading: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

function formatRelativeTime(timestampMs: number): string {
  if (!timestampMs) return 'never';
  const diffMs = Date.now() - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

function truncateId(id: string, len = 12): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

async function fetchNodeHealth(peerUrl: string): Promise<NodeHealth | null> {
  try {
    const token = getAccessToken();
    const res = await fetch(`${peerUrl}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<NodeHealth>;
  } catch {
    return null;
  }
}

async function pingNode(peerUrl: string): Promise<boolean> {
  try {
    const token = getAccessToken();
    const res = await fetch(`${peerUrl}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Sub-components ────────────────────────────────────────────────

function OverviewCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="card p-3 sm:p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isOnline = status === 'online';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border font-medium ${
        isOnline
          ? 'bg-green-500/10 text-green-500 border-green-500/20'
          : 'bg-muted text-muted-foreground border-border'
      }`}
    >
      {isOnline ? <Wifi className="w-3 h-3 shrink-0" /> : <WifiOff className="w-3 h-3 shrink-0" />}
      {status}
    </span>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
        >
          <Tag className="w-2.5 h-2.5" />
          {tag}
        </span>
      ))}
    </div>
  );
}

// ── Node row ──────────────────────────────────────────────────────

function NodeRow({ node }: { node: EnrichedNode }) {
  const [pingResult, setPingResult] = useState<boolean | null>(null);
  const [pinging, setPinging] = useState(false);

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    const ok = await pingNode(node.url);
    setPingResult(ok);
    setPinging(false);
    // Clear result after 3 seconds
    setTimeout(() => {
      setPingResult(null);
    }, 3000);
  };

  const caps = node.health;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
      {/* Name */}
      <td className="px-3 py-3 text-sm font-medium whitespace-nowrap">
        <div className="flex items-center gap-2">
          <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="truncate max-w-[140px]" title={node.name}>
            {node.name}
          </span>
        </div>
      </td>

      {/* Node ID */}
      <td className="px-3 py-3 whitespace-nowrap">
        <code
          className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground"
          title={caps?.nodeId ?? node.id}
        >
          {truncateId(caps?.nodeId ?? node.id)}
        </code>
      </td>

      {/* Status */}
      <td className="px-3 py-3 whitespace-nowrap">
        <StatusBadge status={node.status} />
      </td>

      {/* Arch */}
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {node.healthLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : caps ? (
          <span className="font-mono">{caps.arch}</span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>

      {/* Memory */}
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {node.healthLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : caps ? (
          <span className="font-mono">{(caps.totalMemoryMb / 1024).toFixed(1)} GB</span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>

      {/* CPU */}
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {node.healthLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : caps ? (
          <span className="font-mono">{caps.cpuCores}c</span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </td>

      {/* GPU */}
      <td className="px-3 py-3 text-xs whitespace-nowrap">
        {node.healthLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : caps ? (
          caps.hasGpu ? (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20">
              <Zap className="w-2.5 h-2.5" />
              GPU
            </span>
          ) : (
            <span className="text-muted-foreground/50 text-xs">—</span>
          )
        ) : (
          <span className="text-muted-foreground/50 text-xs">—</span>
        )}
      </td>

      {/* Tags */}
      <td className="px-3 py-3 min-w-[120px]">
        {node.healthLoading ? (
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        ) : (
          <TagList tags={caps?.tags ?? []} />
        )}
      </td>

      {/* Last Seen */}
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatRelativeTime(node.lastSeen)}
      </td>

      {/* Actions */}
      <td className="px-3 py-3 whitespace-nowrap">
        <button
          onClick={() => {
            void handlePing();
          }}
          disabled={pinging}
          title="Ping node"
          className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
            pingResult === true
              ? 'bg-green-500/10 text-green-500 border-green-500/20'
              : pingResult === false
                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                : 'border-border hover:bg-muted/50 text-muted-foreground hover:text-foreground'
          }`}
        >
          {pinging ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Activity className="w-3 h-3" />
          )}
          {pingResult === true ? 'alive' : pingResult === false ? 'dead' : 'ping'}
        </button>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────

export function FleetPanel() {
  const queryClient = useQueryClient();

  // Fetch peer list with 30-second auto-refresh
  const { data: peersData, isLoading: peersLoading } = useQuery({
    queryKey: ['fleetPeers'],
    queryFn: fetchA2APeers,
    refetchInterval: 30_000,
  });

  const peers: PeerAgent[] = peersData?.peers ?? [];

  // Fetch health/capabilities for each online node
  const healthQueries = useQuery({
    queryKey: ['fleetHealth', peers.map((p) => p.id).join(',')],
    queryFn: async () => {
      const onlinePeers = peers.filter((p) => p.status === 'online');
      const results = await Promise.allSettled(
        onlinePeers.map((peer) =>
          fetchNodeHealth(peer.url).then((h) => ({ id: peer.id, health: h?.capabilities ?? null }))
        )
      );
      const map: Record<string, NodeCapabilities | null> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          map[r.value.id] = r.value.health;
        }
      }
      return map;
    },
    enabled: peers.length > 0,
    refetchInterval: 30_000,
  });

  const healthMap: Record<string, NodeCapabilities | null> = healthQueries.data ?? {};

  const enrichedNodes: EnrichedNode[] = peers.map((peer) => ({
    ...peer,
    health: healthMap[peer.id] ?? null,
    healthLoading: healthQueries.isLoading && peer.status === 'online',
  }));

  // Aggregate stats
  const totalNodes = peers.length;
  const onlineCount = peers.filter((p) => p.status === 'online').length;
  const offlineCount = totalNodes - onlineCount;

  const allCaps = Object.values(healthMap).filter(Boolean) as NodeCapabilities[];
  const totalCpuCores = allCaps.reduce((sum, c) => sum + (c.cpuCores ?? 0), 0);
  const totalMemoryGb = allCaps.reduce((sum, c) => sum + (c.totalMemoryMb ?? 0), 0) / 1024;

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['fleetPeers'] });
    void queryClient.invalidateQueries({ queryKey: ['fleetHealth'] });
  };

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight">Edge Fleet</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Node topology, health, and management
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={peersLoading || healthQueries.isLoading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${peersLoading || healthQueries.isLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        <OverviewCard
          icon={<Server className="w-4 h-4" />}
          label="Total Nodes"
          value={totalNodes}
          sub={peersLoading ? 'loading…' : undefined}
        />
        <OverviewCard
          icon={<Wifi className="w-4 h-4" />}
          label="Online / Offline"
          value={`${onlineCount} / ${offlineCount}`}
          sub={
            totalNodes > 0 ? `${Math.round((onlineCount / totalNodes) * 100)}% healthy` : undefined
          }
        />
        <OverviewCard
          icon={<Cpu className="w-4 h-4" />}
          label="Total CPU Cores"
          value={totalCpuCores || '—'}
          sub={
            healthQueries.isLoading
              ? 'fetching…'
              : allCaps.length > 0
                ? `across ${allCaps.length} nodes`
                : 'no data'
          }
        />
        <OverviewCard
          icon={<MemoryStick className="w-4 h-4" />}
          label="Total Memory"
          value={totalMemoryGb > 0 ? `${totalMemoryGb.toFixed(1)} GB` : '—'}
          sub={
            healthQueries.isLoading
              ? 'fetching…'
              : allCaps.length > 0
                ? `across ${allCaps.length} nodes`
                : 'no data'
          }
        />
      </div>

      {/* Node list */}
      {peersLoading ? (
        <div className="card p-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : totalNodes === 0 ? (
        <div className="card p-8 text-center">
          <Server className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-sm font-semibold mb-1">No edge nodes registered</h3>
          <p className="text-xs text-muted-foreground">
            Add peers via the A2A Protocol page to populate the fleet.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Nodes
            </span>
            <span className="text-xs text-muted-foreground">{totalNodes} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Node ID
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Arch
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Memory
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    CPU
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    GPU
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Tags
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Last Seen
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {enrichedNodes.map((node) => (
                  <NodeRow key={node.id} node={node} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
