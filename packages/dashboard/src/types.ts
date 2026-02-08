/**
 * Dashboard Types
 * 
 * Mirrors the shared types but optimized for frontend use
 */

export interface MetricsSnapshot {
  timestamp: number;
  tasks: TaskMetrics;
  resources: ResourceMetrics;
  security: SecurityMetrics;
}

export interface TaskMetrics {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  successRate: number;
  failureRate: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  queueDepth: number;
  inProgress: number;
}

export interface ResourceMetrics {
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  diskUsedMb: number;
  diskLimitMb?: number;
  tokensUsedToday: number;
  tokensLimitDaily?: number;
  tokensCachedToday: number;
  costUsdToday: number;
  costUsdMonth: number;
  apiCallsTotal: number;
  apiErrorsTotal: number;
  apiLatencyAvgMs: number;
}

export interface SecurityMetrics {
  authAttemptsTotal: number;
  authSuccessTotal: number;
  authFailuresTotal: number;
  activeSessions: number;
  permissionChecksTotal: number;
  permissionDenialsTotal: number;
  blockedRequestsTotal: number;
  rateLimitHitsTotal: number;
  injectionAttemptsTotal: number;
  eventsBySeverity: Record<string, number>;
  eventsByType: Record<string, number>;
  auditEntriesTotal: number;
  auditChainValid: boolean;
  lastAuditVerification?: number;
}

export interface Task {
  id: string;
  correlationId?: string;
  type: string;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  result?: {
    success: boolean;
    error?: {
      code: string;
      message: string;
    };
  };
}

export interface SecurityEvent {
  id: string;
  type: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  message: string;
  userId?: string;
  ipAddress?: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  checks: {
    database: boolean;
    auditChain: boolean;
  };
}

export interface WebSocketMessage {
  type: 'update' | 'event' | 'error' | 'ack';
  channel: string;
  payload: unknown;
  timestamp: number;
  sequence: number;
}
