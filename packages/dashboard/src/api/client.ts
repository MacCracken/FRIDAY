/**
 * API Client for SecureClaw Dashboard
 * 
 * All requests go to the local gateway
 */

import type { MetricsSnapshot, Task, SecurityEvent, HealthStatus } from '../types';

const API_BASE = '/api/v1';

class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new APIError(
      error.message || `HTTP ${response.status}`,
      response.status,
      error.code
    );
  }
  
  return response.json();
}

/**
 * Health check
 */
export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const response = await fetch('/health');
    if (!response.ok) {
      return { status: 'error', version: 'unknown', uptime: 0, checks: { database: false, auditChain: false } };
    }
    return response.json();
  } catch {
    return { status: 'error', version: 'unknown', uptime: 0, checks: { database: false, auditChain: false } };
  }
}

/**
 * Fetch current metrics
 */
export async function fetchMetrics(): Promise<MetricsSnapshot> {
  try {
    return await request<MetricsSnapshot>('/metrics');
  } catch {
    // Return empty metrics if gateway is not running
    return {
      timestamp: Date.now(),
      tasks: {
        total: 0,
        byStatus: {},
        byType: {},
        successRate: 0,
        failureRate: 0,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        queueDepth: 0,
        inProgress: 0,
      },
      resources: {
        cpuPercent: 0,
        memoryUsedMb: 0,
        memoryLimitMb: 0,
        memoryPercent: 0,
        diskUsedMb: 0,
        tokensUsedToday: 0,
        tokensCachedToday: 0,
        costUsdToday: 0,
        costUsdMonth: 0,
        apiCallsTotal: 0,
        apiErrorsTotal: 0,
        apiLatencyAvgMs: 0,
      },
      security: {
        authAttemptsTotal: 0,
        authSuccessTotal: 0,
        authFailuresTotal: 0,
        activeSessions: 0,
        permissionChecksTotal: 0,
        permissionDenialsTotal: 0,
        blockedRequestsTotal: 0,
        rateLimitHitsTotal: 0,
        injectionAttemptsTotal: 0,
        eventsBySeverity: {},
        eventsByType: {},
        auditEntriesTotal: 0,
        auditChainValid: false,
      },
    };
  }
}

/**
 * Fetch task list
 */
export async function fetchTasks(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: Task[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  
  const queryString = query.toString();
  try {
    return await request<{ tasks: Task[]; total: number }>(
      `/tasks${queryString ? `?${queryString}` : ''}`
    );
  } catch {
    return { tasks: [], total: 0 };
  }
}

/**
 * Fetch single task
 */
export async function fetchTask(id: string): Promise<Task | null> {
  try {
    return await request<Task>(`/tasks/${id}`);
  } catch {
    return null;
  }
}

/**
 * Fetch security events
 */
export async function fetchSecurityEvents(params?: {
  severity?: string;
  limit?: number;
}): Promise<{ events: SecurityEvent[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.limit) query.set('limit', params.limit.toString());
  
  const queryString = query.toString();
  try {
    return await request<{ events: SecurityEvent[]; total: number }>(
      `/security/events${queryString ? `?${queryString}` : ''}`
    );
  } catch {
    return { events: [], total: 0 };
  }
}

/**
 * Verify audit chain
 */
export async function verifyAuditChain(): Promise<{
  valid: boolean;
  entriesChecked: number;
  error?: string;
}> {
  try {
    return await request<{ valid: boolean; entriesChecked: number; error?: string }>(
      '/audit/verify',
      { method: 'POST' }
    );
  } catch {
    return { valid: false, entriesChecked: 0, error: 'Failed to verify' };
  }
}
