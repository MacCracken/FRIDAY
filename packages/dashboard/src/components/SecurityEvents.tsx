/**
 * Security Events Component
 * 
 * Displays security events, audit status, and threat indicators
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  ShieldX,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  RefreshCw,
  Lock,
  Unlock
} from 'lucide-react';
import { fetchSecurityEvents, verifyAuditChain } from '../api/client';
import type { MetricsSnapshot, SecurityEvent } from '../types';

interface SecurityEventsProps {
  metrics?: MetricsSnapshot;
}

const SEVERITY_ICONS: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-info" />,
  warn: <AlertTriangle className="w-4 h-4 text-warning" />,
  error: <XCircle className="w-4 h-4 text-destructive" />,
  critical: <ShieldAlert className="w-4 h-4 text-destructive" />,
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'border-l-info',
  warn: 'border-l-warning',
  error: 'border-l-destructive',
  critical: 'border-l-destructive bg-destructive/5',
};

export function SecurityEvents({ metrics }: SecurityEventsProps) {
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<{
    valid: boolean;
    entriesChecked: number;
    error?: string;
  } | null>(null);
  
  const { data: eventsData } = useQuery({
    queryKey: ['security-events'],
    queryFn: () => fetchSecurityEvents({ limit: 20 }),
    refetchInterval: 10000,
  });
  
  const events = eventsData?.events ?? [];
  
  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const result = await verifyAuditChain();
      setVerificationResult(result);
    } finally {
      setVerifying(false);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Security Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Audit Chain Status */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Audit Chain</h3>
            <button
              onClick={handleVerifyChain}
              disabled={verifying}
              className="btn-ghost p-2"
              aria-label="Verify audit chain"
            >
              <RefreshCw className={`w-4 h-4 ${verifying ? 'animate-spin' : ''}`} />
            </button>
          </div>
          
          <div className="flex items-center gap-3">
            {metrics?.security?.auditChainValid ? (
              <>
                <ShieldCheck className="w-10 h-10 text-success" />
                <div>
                  <p className="font-semibold text-success">Valid</p>
                  <p className="text-xs text-muted-foreground">
                    {metrics?.security?.auditEntriesTotal ?? 0} entries
                  </p>
                </div>
              </>
            ) : (
              <>
                <ShieldX className="w-10 h-10 text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Invalid</p>
                  <p className="text-xs text-muted-foreground">Requires attention</p>
                </div>
              </>
            )}
          </div>
          
          {verificationResult && (
            <div className={`mt-3 p-2 rounded text-xs ${
              verificationResult.valid ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
            }`}>
              {verificationResult.valid 
                ? `Verified ${verificationResult.entriesChecked} entries`
                : verificationResult.error || 'Verification failed'
              }
            </div>
          )}
        </div>
        
        {/* Authentication Stats */}
        <div className="card p-4">
          <h3 className="font-medium mb-4">Authentication</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Attempts</span>
              <span className="font-mono">{metrics?.security?.authAttemptsTotal ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-success">Success</span>
              <span className="font-mono">{metrics?.security?.authSuccessTotal ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-destructive">Failures</span>
              <span className="font-mono">{metrics?.security?.authFailuresTotal ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Sessions</span>
              <span className="font-mono">{metrics?.security?.activeSessions ?? 0}</span>
            </div>
          </div>
        </div>
        
        {/* Threat Summary */}
        <div className="card p-4">
          <h3 className="font-medium mb-4">Threat Summary</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Rate Limit Hits</span>
              <span className={`font-mono ${(metrics?.security?.rateLimitHitsTotal ?? 0) > 0 ? 'text-warning' : ''}`}>
                {metrics?.security?.rateLimitHitsTotal ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Blocked Requests</span>
              <span className={`font-mono ${(metrics?.security?.blockedRequestsTotal ?? 0) > 0 ? 'text-warning' : ''}`}>
                {metrics?.security?.blockedRequestsTotal ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-destructive">Injection Attempts</span>
              <span className={`font-mono ${(metrics?.security?.injectionAttemptsTotal ?? 0) > 0 ? 'text-destructive font-bold' : ''}`}>
                {metrics?.security?.injectionAttemptsTotal ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Permission Denials</span>
              <span className="font-mono">{metrics?.security?.permissionDenialsTotal ?? 0}</span>
            </div>
          </div>
        </div>
      </div>
      
      {/* Recent Events */}
      <div className="card">
        <div className="p-4 border-b">
          <h3 className="font-medium">Recent Security Events</h3>
        </div>
        <div className="divide-y">
          {events.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No security events recorded</p>
            </div>
          ) : (
            events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ event }: { event: SecurityEvent }) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };
  
  return (
    <div className={`p-4 border-l-4 ${SEVERITY_COLORS[event.severity] ?? 'border-l-muted'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {SEVERITY_ICONS[event.severity]}
          <div>
            <p className="font-medium">{event.type.replace(/_/g, ' ')}</p>
            <p className="text-sm text-muted-foreground">{event.message}</p>
            {event.userId && (
              <p className="text-xs text-muted-foreground mt-1">
                User: {event.userId}
              </p>
            )}
            {event.ipAddress && (
              <p className="text-xs text-muted-foreground">
                IP: {event.ipAddress}
              </p>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(event.timestamp)}
        </div>
      </div>
    </div>
  );
}
