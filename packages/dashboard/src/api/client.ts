/**
 * API Client for SecureYeoman Dashboard
 *
 * All requests go to the local gateway
 */

import type {
  MetricsSnapshot,
  Task,
  SecurityEvent,
  HealthStatus,
  Personality,
  PersonalityCreate,
  Skill,
  SkillCreate,
  OnboardingStatus,
  PromptPreview,
  ApiKey,
  ApiKeyCreateRequest,
  ApiKeyCreateResponse,
  SoulConfig,
  IntegrationInfo,
  ChatResponse,
  ModelInfoResponse,
  McpServerConfig,
  McpToolDef,
  McpResourceDef,
  Passion,
  Inspiration,
  Pain,
  KnowledgeEntry,
  HeartbeatTask,
} from '../types.js';

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

// ── Auth token management ─────────────────────────────────────────────

let _accessToken: string | null = null;
let _refreshToken: string | null = null;
let _onAuthFailure: (() => void) | null = null;
let _isRefreshing = false;
let _refreshPromise: Promise<boolean> | null = null;

export function setAuthTokens(accessToken: string, refreshToken: string): void {
  _accessToken = accessToken;
  _refreshToken = refreshToken;
  localStorage.setItem('accessToken', accessToken);
  localStorage.setItem('refreshToken', refreshToken);
}

export function clearAuthTokens(): void {
  _accessToken = null;
  _refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

export function getAccessToken(): string | null {
  if (!_accessToken) {
    _accessToken = localStorage.getItem('accessToken');
  }
  return _accessToken;
}

export function getRefreshToken(): string | null {
  if (!_refreshToken) {
    _refreshToken = localStorage.getItem('refreshToken');
  }
  return _refreshToken;
}

export function setOnAuthFailure(callback: () => void): void {
  _onAuthFailure = callback;
}

// ── Token refresh ─────────────────────────────────────────────────────

async function attemptTokenRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    setAuthTokens(data.accessToken, data.refreshToken ?? refreshToken);
    return true;
  } catch {
    return false;
  }
}

// ── Core request function ─────────────────────────────────────────────

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  skipAuth = false
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const token = getAccessToken();

  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && !skipAuth) {
    // Attempt token refresh (deduplicate concurrent refreshes)
    if (!_isRefreshing) {
      _isRefreshing = true;
      _refreshPromise = attemptTokenRefresh();
    }

    const refreshed = await _refreshPromise;
    _isRefreshing = false;
    _refreshPromise = null;

    if (refreshed) {
      // Retry the original request with new token
      const newToken = getAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryResponse = await fetch(url, { ...options, headers });

      if (!retryResponse.ok) {
        const error = await retryResponse.json().catch(() => ({ message: 'Unknown error' }));
        throw new APIError(
          error.message || `HTTP ${retryResponse.status}`,
          retryResponse.status,
          error.code
        );
      }
      return retryResponse.json();
    }

    // Refresh failed — clear auth and notify
    clearAuthTokens();
    _onAuthFailure?.();
    throw new APIError('Authentication failed', 401);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new APIError(
      error.message || error.error || `HTTP ${response.status}`,
      response.status,
      error.code
    );
  }

  return response.json();
}

// ── Login / Logout ────────────────────────────────────────────────────

export async function login(
  password: string,
  rememberMe = false
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}> {
  return request(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ password, rememberMe }),
    },
    true
  );
}

export async function logout(): Promise<void> {
  try {
    await request<{ message: string }>('/auth/logout', { method: 'POST' });
  } catch {
    // Logout should clear local state regardless of server response
  }
  clearAuthTokens();
}

// ── Health check (unauthenticated) ────────────────────────────────────

export async function fetchHealth(): Promise<HealthStatus> {
  try {
    const response = await fetch('/health');
    if (!response.ok) {
      return {
        status: 'error',
        version: 'unknown',
        uptime: 0,
        checks: { database: false, auditChain: false },
      };
    }
    return response.json();
  } catch {
    return {
      status: 'error',
      version: 'unknown',
      uptime: 0,
      checks: { database: false, auditChain: false },
    };
  }
}

// ── Metrics ───────────────────────────────────────────────────────────

export async function fetchMetrics(): Promise<MetricsSnapshot> {
  try {
    return await request<MetricsSnapshot>('/metrics');
  } catch {
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

// ── Tasks ─────────────────────────────────────────────────────────────

export async function fetchTasks(params?: {
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: Task[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.type) query.set('type', params.type);
  if (params?.from) query.set('from', params.from);
  if (params?.to) query.set('to', params.to);
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

export async function fetchTask(id: string): Promise<Task | null> {
  try {
    return await request<Task>(`/tasks/${id}`);
  } catch {
    return null;
  }
}

export async function createTask(data: {
  name: string;
  type?: string;
  description?: string;
  input?: unknown;
  timeoutMs?: number;
}): Promise<Task> {
  return await request<Task>('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await request(`/tasks/${id}`, {
    method: 'DELETE',
  });
}

export async function updateTask(
  id: string,
  data: { name?: string; type?: string; description?: string }
): Promise<Task> {
  return request(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Security ──────────────────────────────────────────────────────────

export async function fetchSecurityEvents(params?: {
  severity?: string;
  limit?: number;
}): Promise<{ events: SecurityEvent[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.limit) query.set('limit', params.limit.toString());

  const queryString = query.toString();
  try {
    const raw = await request<{ events: Array<Record<string, unknown>>; total: number }>(
      `/security/events${queryString ? `?${queryString}` : ''}`
    );
    // Map audit-chain entries to the dashboard SecurityEvent shape
    const events: SecurityEvent[] = (raw.events ?? []).map((e) => ({
      id: (e.id as string) ?? '',
      type: (e.type as string) ?? (e.event as string) ?? 'unknown',
      severity: mapLevelToSeverity((e.severity as string) ?? (e.level as string)),
      message: (e.message as string) ?? '',
      userId:
        (e.userId as string) ??
        ((e.metadata as Record<string, unknown>)?.userId as string | undefined),
      ipAddress:
        (e.ipAddress as string) ??
        ((e.metadata as Record<string, unknown>)?.ip as string | undefined),
      timestamp: (e.timestamp as number) ?? 0,
      acknowledged: false,
    }));
    return { events, total: raw.total };
  } catch {
    return { events: [], total: 0 };
  }
}

function mapLevelToSeverity(level: string): SecurityEvent['severity'] {
  switch (level) {
    case 'error':
    case 'fatal':
      return 'error';
    case 'warn':
      return 'warn';
    case 'security':
      return 'critical';
    default:
      return 'info';
  }
}

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

// ─── Soul API ──────────────────────────────────────────────────────

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>('/soul/onboarding/status');
}

export async function completeOnboarding(
  data: PersonalityCreate & { agentName?: string }
): Promise<{
  agentName: string;
  personality: Personality;
}> {
  return request('/soul/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchAgentName(): Promise<{ agentName: string }> {
  return request('/soul/agent-name');
}

export async function updateAgentName(agentName: string): Promise<{ agentName: string }> {
  return request('/soul/agent-name', {
    method: 'PUT',
    body: JSON.stringify({ agentName }),
  });
}

export async function fetchPersonalities(): Promise<{ personalities: Personality[] }> {
  return request('/soul/personalities');
}

export async function fetchActivePersonality(): Promise<{ personality: Personality | null }> {
  return request('/soul/personality');
}

export async function createPersonality(
  data: PersonalityCreate
): Promise<{ personality: Personality }> {
  return request('/soul/personalities', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePersonality(
  id: string,
  data: Partial<PersonalityCreate>
): Promise<{ personality: Personality }> {
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

export async function fetchSkills(params?: {
  status?: string;
  source?: string;
}): Promise<{ skills: Skill[] }> {
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

export async function updateSkill(
  id: string,
  data: Partial<SkillCreate>
): Promise<{ skill: Skill }> {
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

export async function fetchPromptPreview(personalityId?: string): Promise<PromptPreview> {
  const query = personalityId ? `?personalityId=${personalityId}` : '';
  return request(`/soul/prompt/preview${query}`);
}

// ─── API Keys ─────────────────────────────────────────────────────────

export async function fetchApiKeys(): Promise<{ keys: ApiKey[] }> {
  return request('/auth/api-keys');
}

export async function createApiKey(data: ApiKeyCreateRequest): Promise<ApiKeyCreateResponse> {
  return request('/auth/api-keys', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await request(`/auth/api-keys/${id}`, { method: 'DELETE' });
}

// ─── Soul Config ──────────────────────────────────────────────────────

export async function fetchSoulConfig(): Promise<SoulConfig> {
  const data = await request<{ config: SoulConfig }>('/soul/config');
  return data.config;
}

// ─── Integrations ─────────────────────────────────────────────────────

export async function fetchIntegrations(): Promise<{
  integrations: IntegrationInfo[];
  total: number;
  running: number;
}> {
  try {
    return await request('/integrations');
  } catch {
    return { integrations: [], total: 0, running: 0 };
  }
}

export async function fetchAvailablePlatforms(): Promise<{ platforms: string[] }> {
  try {
    return await request('/integrations/platforms');
  } catch {
    return { platforms: [] };
  }
}

export async function createIntegration(data: {
  platform: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
}): Promise<IntegrationInfo> {
  return request('/integrations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateIntegration(
  id: string,
  data: Partial<{ displayName: string; enabled: boolean; config: Record<string, unknown> }>
): Promise<IntegrationInfo> {
  return request(`/integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteIntegration(id: string): Promise<void> {
  await request(`/integrations/${id}`, { method: 'DELETE' });
}

export async function startIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/start`, { method: 'POST' });
}

export async function stopIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/stop`, { method: 'POST' });
}

// ─── Auth Roles ───────────────────────────────────────────────────

export async function fetchRoles(): Promise<{
  roles: Array<{ name: string; permissions: string[] }>;
}> {
  try {
    return await request('/auth/roles');
  } catch {
    return { roles: [] };
  }
}

// ─── Audit Stats ──────────────────────────────────────────────────

export async function fetchAuditStats(): Promise<{
  totalEntries: number;
  oldestEntry?: number;
  lastVerification?: number;
  chainValid: boolean;
  dbSizeEstimateMb?: number;
}> {
  try {
    return await request('/audit/stats');
  } catch {
    return { totalEntries: 0, chainValid: false };
  }
}

// ─── Audit Retention & Export ─────────────────────────────────

export async function enforceRetention(data: {
  maxAgeDays?: number;
  maxEntries?: number;
}): Promise<{ deletedCount: number; remainingCount: number }> {
  return request('/audit/retention', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function exportAuditBackup(): Promise<Blob> {
  const base = (window as any).__FRIDAY_API_BASE__ || `${window.location.protocol}//${window.location.hostname}:18789/api/v1`;
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${base}/audit/export`, { headers });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

// ─── Chat ─────────────────────────────────────────────────────

export async function sendChatMessage(data: {
  message: string;
  history?: Array<{ role: string; content: string }>;
  personalityId?: string;
  editorContent?: string;
}): Promise<ChatResponse> {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Model Info ───────────────────────────────────────────────

export async function fetchModelInfo(): Promise<ModelInfoResponse> {
  return request('/model/info');
}

export async function switchModel(data: {
  provider: string;
  model: string;
}): Promise<{ success: boolean; model: string }> {
  return request('/model/switch', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ─── Spirit API ───────────────────────────────────────────────

export async function fetchPassions(): Promise<{ passions: Passion[] }> {
  try {
    return await request('/spirit/passions');
  } catch {
    return { passions: [] };
  }
}

export async function createPassion(data: {
  name: string;
  description?: string;
  intensity?: number;
  isActive?: boolean;
}): Promise<{ passion: Passion }> {
  return request('/spirit/passions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePassion(
  id: string,
  data: Partial<{ name: string; description: string; intensity: number; isActive: boolean }>
): Promise<{ passion: Passion }> {
  return request(`/spirit/passions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deletePassion(id: string): Promise<void> {
  await request(`/spirit/passions/${id}`, { method: 'DELETE' });
}

export async function fetchInspirations(): Promise<{ inspirations: Inspiration[] }> {
  try {
    return await request('/spirit/inspirations');
  } catch {
    return { inspirations: [] };
  }
}

export async function createInspiration(data: {
  source: string;
  description?: string;
  impact?: number;
  isActive?: boolean;
}): Promise<{ inspiration: Inspiration }> {
  return request('/spirit/inspirations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateInspiration(
  id: string,
  data: Partial<{ source: string; description: string; impact: number; isActive: boolean }>
): Promise<{ inspiration: Inspiration }> {
  return request(`/spirit/inspirations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteInspiration(id: string): Promise<void> {
  await request(`/spirit/inspirations/${id}`, { method: 'DELETE' });
}

export async function fetchPains(): Promise<{ pains: Pain[] }> {
  try {
    return await request('/spirit/pains');
  } catch {
    return { pains: [] };
  }
}

export async function createPainEntry(data: {
  trigger: string;
  description?: string;
  severity?: number;
  isActive?: boolean;
}): Promise<{ pain: Pain }> {
  return request('/spirit/pains', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePain(
  id: string,
  data: Partial<{ trigger: string; description: string; severity: number; isActive: boolean }>
): Promise<{ pain: Pain }> {
  return request(`/spirit/pains/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deletePain(id: string): Promise<void> {
  await request(`/spirit/pains/${id}`, { method: 'DELETE' });
}

// ─── Brain API ────────────────────────────────────────────────

export async function fetchKnowledge(): Promise<{ knowledge: KnowledgeEntry[] }> {
  try {
    return await request('/brain/knowledge');
  } catch {
    return { knowledge: [] };
  }
}

export async function learnKnowledge(
  topic: string,
  content: string
): Promise<{ entry: KnowledgeEntry }> {
  return request('/brain/knowledge', {
    method: 'POST',
    body: JSON.stringify({ topic, content }),
  });
}

export async function updateKnowledge(
  id: string,
  data: { content?: string; confidence?: number }
): Promise<{ knowledge: KnowledgeEntry }> {
  return request(`/brain/knowledge/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteKnowledge(id: string): Promise<{ message: string }> {
  return request(`/brain/knowledge/${id}`, { method: 'DELETE' });
}

export async function fetchHeartbeatTasks(): Promise<{ tasks: HeartbeatTask[] }> {
  try {
    return await request('/brain/heartbeat/tasks');
  } catch {
    return { tasks: [] };
  }
}

export async function updateHeartbeatTask(
  name: string,
  data: { intervalMs?: number; enabled?: boolean; config?: Record<string, unknown> }
): Promise<{ task: HeartbeatTask }> {
  return request(`/brain/heartbeat/tasks/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function fetchExternalSyncStatus(): Promise<{
  configured: boolean;
  provider?: string;
  path?: string;
  lastSync?: { timestamp: number; entriesExported: number; errors: string[] } | null;
  error?: string;
}> {
  try {
    const result = await request<Record<string, unknown>>('/brain/sync/status');
    return { configured: true, ...result } as {
      configured: boolean;
      provider?: string;
      path?: string;
      lastSync?: { timestamp: number; entriesExported: number; errors: string[] } | null;
    };
  } catch {
    return { configured: false };
  }
}

export async function triggerExternalSync(): Promise<{ result: Record<string, unknown> }> {
  return request('/brain/sync', { method: 'POST' });
}

export interface ExternalBrainConfig {
  configured: boolean;
  enabled?: boolean;
  provider?: string;
  path?: string;
}

export async function fetchExternalBrainConfig(): Promise<ExternalBrainConfig> {
  try {
    const result = await request<ExternalBrainConfig>('/brain/sync/config');
    return result;
  } catch {
    return { configured: false };
  }
}

export async function updateExternalBrainConfig(config: {
  enabled?: boolean;
  provider?: string;
  path?: string;
  subdir?: string;
  syncIntervalMs?: number;
}): Promise<{ success: boolean }> {
  return request('/brain/sync/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ─── MCP Servers ──────────────────────────────────────────────

export async function fetchMcpServers(): Promise<{ servers: McpServerConfig[]; total: number }> {
  try {
    return await request('/mcp/servers');
  } catch {
    return { servers: [], total: 0 };
  }
}

export async function addMcpServer(data: {
  name: string;
  description?: string;
  transport?: 'stdio' | 'sse' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}): Promise<{ server: McpServerConfig }> {
  return request('/mcp/servers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteMcpServer(id: string): Promise<void> {
  await request(`/mcp/servers/${id}`, { method: 'DELETE' });
}

export async function patchMcpServer(
  id: string,
  data: { enabled: boolean }
): Promise<{ server: McpServerConfig }> {
  return request(`/mcp/servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function fetchMcpTools(): Promise<{ tools: McpToolDef[]; total: number }> {
  try {
    return await request('/mcp/tools');
  } catch {
    return { tools: [], total: 0 };
  }
}

export async function fetchMcpResources(): Promise<{ resources: McpResourceDef[] }> {
  try {
    return await request('/mcp/resources');
  } catch {
    return { resources: [] };
  }
}

// ─── Terminal API ───────────────────────────────────────────────

export interface TerminalCommandResult {
  output: string;
  error: string;
  exitCode: number;
  cwd: string;
}

export async function executeTerminalCommand(
  command: string,
  cwd: string
): Promise<TerminalCommandResult> {
  return request('/terminal/execute', {
    method: 'POST',
    body: JSON.stringify({ command, cwd }),
  });
}
