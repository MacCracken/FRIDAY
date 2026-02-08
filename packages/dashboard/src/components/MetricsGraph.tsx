/**
 * Metrics Graph Component
 * 
 * Visualizes system activity using ReactFlow
 */

import { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Shield, Activity, Database, Cpu, Network } from 'lucide-react';
import type { MetricsSnapshot } from '../types';

interface MetricsGraphProps {
  metrics?: MetricsSnapshot;
}

// Custom node component
function SystemNode({ data }: { data: { label: string; value: string | number; icon: React.ReactNode; status: 'ok' | 'warning' | 'error' } }) {
  const statusColor = {
    ok: 'bg-success/20 border-success',
    warning: 'bg-warning/20 border-warning',
    error: 'bg-destructive/20 border-destructive',
  }[data.status];
  
  return (
    <div className={`px-4 py-3 rounded-lg border-2 ${statusColor} min-w-[140px]`}>
      <div className="flex items-center gap-2 mb-1">
        <div className="text-muted-foreground">{data.icon}</div>
        <span className="text-xs font-medium text-muted-foreground">{data.label}</span>
      </div>
      <div className="text-lg font-bold">{data.value}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  system: SystemNode,
};

export function MetricsGraph({ metrics }: MetricsGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      // Central Agent Node
      {
        id: 'agent',
        type: 'system',
        position: { x: 250, y: 150 },
        data: {
          label: 'SecureClaw Agent',
          value: metrics?.tasks?.inProgress ?? 0,
          icon: <Shield className="w-4 h-4" />,
          status: 'ok',
        },
      },
      // Task Queue
      {
        id: 'tasks',
        type: 'system',
        position: { x: 50, y: 50 },
        data: {
          label: 'Task Queue',
          value: metrics?.tasks?.queueDepth ?? 0,
          icon: <Activity className="w-4 h-4" />,
          status: (metrics?.tasks?.queueDepth ?? 0) > 10 ? 'warning' : 'ok',
        },
        sourcePosition: Position.Right,
      },
      // Audit Chain
      {
        id: 'audit',
        type: 'system',
        position: { x: 450, y: 50 },
        data: {
          label: 'Audit Chain',
          value: metrics?.security?.auditEntriesTotal ?? 0,
          icon: <Database className="w-4 h-4" />,
          status: metrics?.security?.auditChainValid ? 'ok' : 'error',
        },
        targetPosition: Position.Left,
      },
      // Resources
      {
        id: 'resources',
        type: 'system',
        position: { x: 50, y: 250 },
        data: {
          label: 'Memory',
          value: `${(metrics?.resources?.memoryUsedMb ?? 0).toFixed(0)} MB`,
          icon: <Cpu className="w-4 h-4" />,
          status: (metrics?.resources?.memoryPercent ?? 0) > 80 ? 'warning' : 'ok',
        },
        sourcePosition: Position.Right,
      },
      // Security
      {
        id: 'security',
        type: 'system',
        position: { x: 450, y: 250 },
        data: {
          label: 'Security Events',
          value: (metrics?.security?.blockedRequestsTotal ?? 0) + (metrics?.security?.injectionAttemptsTotal ?? 0),
          icon: <Network className="w-4 h-4" />,
          status: (metrics?.security?.injectionAttemptsTotal ?? 0) > 0 ? 'warning' : 'ok',
        },
        targetPosition: Position.Left,
      },
    ];
    
    const edges: Edge[] = [
      {
        id: 'tasks-agent',
        source: 'tasks',
        target: 'agent',
        animated: (metrics?.tasks?.inProgress ?? 0) > 0,
        style: { stroke: '#0ea5e9' },
      },
      {
        id: 'agent-audit',
        source: 'agent',
        target: 'audit',
        animated: true,
        style: { stroke: '#22c55e' },
      },
      {
        id: 'resources-agent',
        source: 'resources',
        target: 'agent',
        style: { stroke: '#6b7280' },
      },
      {
        id: 'agent-security',
        source: 'agent',
        target: 'security',
        style: { stroke: '#f59e0b' },
      },
    ];
    
    return { nodes, edges };
  }, [metrics]);
  
  return (
    <div className="h-[400px] w-full rounded-lg border bg-muted/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#888" gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap 
          nodeColor={(node) => {
            const status = node.data?.status as string;
            if (status === 'error') return '#ef4444';
            if (status === 'warning') return '#f59e0b';
            return '#22c55e';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
}
