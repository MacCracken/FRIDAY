/**
 * SandboxConfigPanel — Editable sandbox settings for Admin > Security.
 *
 * Shows available sandbox technologies ranked by isolation strength,
 * active technology with health status, and configuration controls.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import * as api from '../api/client';

function StrengthBar({ strength }: { strength: number }) {
  const color = strength >= 70 ? 'bg-green-500' : strength >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${strength}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground">{strength}</span>
    </div>
  );
}

export default function SandboxConfigPanel() {
  const queryClient = useQueryClient();

  const { data: capabilities } = useQuery({
    queryKey: ['sandbox-capabilities'],
    queryFn: () => api.fetchSandboxCapabilities(),
    refetchInterval: 60_000,
  });

  const { data: status } = useQuery({
    queryKey: ['sandbox-status'],
    queryFn: () => api.fetchSandboxStatus(),
  });

  const { data: health, refetch: refetchHealth } = useQuery({
    queryKey: ['sandbox-health'],
    queryFn: () => api.fetchSandboxHealth(),
    refetchInterval: 120_000,
  });

  const switchTechnology = async (tech: string) => {
    await api.switchSandboxTechnology(tech);
    void queryClient.invalidateQueries({ queryKey: ['sandbox-status'] });
    void queryClient.invalidateQueries({ queryKey: ['sandbox-capabilities'] });
    void queryClient.invalidateQueries({ queryKey: ['sandbox-health'] });
  };

  return (
    <div className="space-y-4">
      {/* Header with health status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Sandbox Isolation</h3>
        </div>
        <div className="flex items-center gap-2">
          {health && (
            <span
              className={`flex items-center gap-1 text-[10px] ${health.healthy ? 'text-green-500' : 'text-red-500'}`}
            >
              {health.healthy ? (
                <CheckCircle className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              {health.healthy ? 'Healthy' : 'Degraded'}
              <span className="text-muted-foreground">({health.checkDurationMs}ms)</span>
            </span>
          )}
          <button
            onClick={() => {
              void refetchHealth();
            }}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Run health check"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Active technology */}
      {status && (
        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <div>
                <div className="text-xs font-medium">{status.sandboxType}</div>
                <div className="text-[10px] text-muted-foreground">
                  Active &middot; {status.technology === 'auto' ? 'auto-selected' : 'explicit'}
                </div>
              </div>
            </div>
            <StrengthBar strength={status.strength} />
          </div>
        </div>
      )}

      {/* Technology list */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Available Technologies
        </h4>
        {(capabilities?.technologies ?? []).map((tech) => (
          <div
            key={tech.technology}
            className={`flex items-center justify-between p-2 rounded-lg border ${
              tech.technology === capabilities?.activeTechnology
                ? 'border-primary/30 bg-primary/5'
                : tech.available
                  ? 'border-border bg-card hover:bg-muted/50 cursor-pointer'
                  : 'border-border bg-card opacity-50'
            }`}
            onClick={() => {
              if (tech.available && tech.technology !== capabilities?.activeTechnology) {
                void switchTechnology(tech.technology);
              }
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              {tech.available ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium capitalize">{tech.technology}</div>
                {!tech.available && tech.missingPrerequisites.length > 0 && (
                  <div className="text-[10px] text-muted-foreground truncate">
                    Missing: {tech.missingPrerequisites.join(', ')}
                  </div>
                )}
              </div>
            </div>
            <StrengthBar strength={tech.strength} />
          </div>
        ))}
      </div>

      {/* Health error details */}
      {health && !health.healthy && health.error && (
        <div className="p-2 rounded-lg border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-1.5 text-xs text-red-500">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="font-medium">Health Check Failed</span>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">{health.error}</p>
        </div>
      )}
    </div>
  );
}
