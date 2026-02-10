/**
 * API Client for SecureYeoman Dashboard
 * 
 * All requests go to the local gateway
 */

import type { MetricsSnapshot, Task, SecurityEvent, HealthStatus, Personality, PersonalityCreate, Skill, SkillCreate, OnboardingStatus, PromptPreview } from '../types';

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

// ─── Soul API ──────────────────────────────────────────────────

/**
 * Onboarding
 */
export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>('/soul/onboarding/status');
}

export async function completeOnboarding(data: PersonalityCreate & { agentName?: string }): Promise<{
  agentName: string;
  personality: Personality;
}> {
  return request('/soul/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Agent name
 */
export async function fetchAgentName(): Promise<{ agentName: string }> {
  return request('/soul/agent-name');
}

export async function updateAgentName(agentName: string): Promise<{ agentName: string }> {
  return request('/soul/agent-name', {
    method: 'PUT',
    body: JSON.stringify({ agentName }),
  });
}

/**
 * Personalities
 */
export async function fetchPersonalities(): Promise<{ personalities: Personality[] }> {
  return request('/soul/personalities');
}

export async function fetchActivePersonality(): Promise<{ personality: Personality | null }> {
  return request('/soul/personality');
}

export async function createPersonality(data: PersonalityCreate): Promise<{ personality: Personality }> {
  return request('/soul/personalities', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePersonality(id: string, data: Partial<PersonalityCreate>): Promise<{ personality: Personality }> {
  return request(`/soul/personalities/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deletePersonality(id: string): Promise<void> {
  await request(`/soul/personalities/${id}`, { method: 'DELETE' });
}

export async function activatePersonality(id: string): Promise<{ personality: Personality }> {
  return request(`/soul/personalities/${id}/activate`, { method: 'POST' });
}

/**
 * Skills
 */
export async function fetchSkills(params?: { status?: string; source?: string }): Promise<{ skills: Skill[] }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.source) query.set('source', params.source);
  const qs = query.toString();
  return request(`/soul/skills${qs ? `?${qs}` : ''}`);
}

export async function createSkill(data: SkillCreate): Promise<{ skill: Skill }> {
  return request('/soul/skills', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSkill(id: string, data: Partial<SkillCreate>): Promise<{ skill: Skill }> {
  return request(`/soul/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  await request(`/soul/skills/${id}`, { method: 'DELETE' });
}

export async function enableSkill(id: string): Promise<void> {
  await request(`/soul/skills/${id}/enable`, { method: 'POST' });
}

export async function disableSkill(id: string): Promise<void> {
  await request(`/soul/skills/${id}/disable`, { method: 'POST' });
}

export async function approveSkill(id: string): Promise<{ skill: Skill }> {
  return request(`/soul/skills/${id}/approve`, { method: 'POST' });
}

export async function rejectSkill(id: string): Promise<void> {
  await request(`/soul/skills/${id}/reject`, { method: 'POST' });
}

/**
 * Prompt preview
 */
export async function fetchPromptPreview(): Promise<PromptPreview> {
  return request('/soul/prompt/preview');
}
