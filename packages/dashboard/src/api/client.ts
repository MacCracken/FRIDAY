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
  HeartbeatStatus,
  HeartbeatLogEntry,
  Memory,
  AutonomyOverview,
  AuditRun,
  AuditItemStatus,
  ServerNotification,
  UserNotificationPref,
  RiskAssessment,
  ExternalFeed,
  ExternalFinding,
  CreateRiskAssessmentOptions,
  CreateExternalFeedOptions,
  CreateExternalFindingOptions,
  BackupRecord,
  TenantRecord,
  OAuthConnectedToken,
  AiHealthStatus,
  FederationPeer,
  ApiKeyUsageSummary,
  ApiKeyUsageRow,
  KbDocument,
  KnowledgeHealthStats,
  AlertRule,
  CatalogSkill,
  WorkflowExport,
  SwarmTemplateExport,
  CompatibilityCheckResult,
  ReasoningStrategy,
} from '../types.js';

import type {
  Department,
  RegisterEntry,
  DepartmentScore,
  DepartmentScorecard,
  RiskHeatmapCell,
  RiskTrendPoint,
  AthiScenario,
  AthiRiskMatrixCell,
  AthiExecutiveSummary,
  PersonalityVersion,
  WorkflowVersion,
  DriftSummary,
  CitationFeedback,
  ProvenanceScores,
  ScanHistoryRow,
  QuarantineEntry,
  ExternalizationPolicy,
} from '@secureyeoman/shared';

export type { CompatibilityCheckResult } from '../types.js';
export type { ReasoningStrategy } from '../types.js';

const API_BASE = '/api/v1';

/** Default request timeout. Prevents fetch() from hanging indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Shorter timeout for token refresh — we need a fast fail so auth doesn't stall. */
const REFRESH_TIMEOUT_MS = 10_000;

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

/**
 * Verify the current session token with the server.
 * Returns true if the token is valid, false otherwise.
 * On failure, clears stale tokens from localStorage.
 */
export async function verifySession(): Promise<boolean> {
  const token = getAccessToken();
  if (!token) return false;
  try {
    await request('/metrics');
    return true;
  } catch {
    // request() already handles 401 → refresh → clearAuthTokens → onAuthFailure
    return false;
  }
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
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
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
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    // Respect a caller-supplied signal (e.g. React Query's abort controller)
    // and fall back to a 30-second timeout to prevent hanging fetches.
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 401 && !skipAuth) {
    // Deduplicate concurrent refreshes: all in-flight 401s await the same
    // promise, and `finally` guarantees the flags are cleared regardless of
    // whether the refresh succeeded, failed, or threw an exception.
    if (!_isRefreshing) {
      _isRefreshing = true;
      _refreshPromise = attemptTokenRefresh().finally(() => {
        _isRefreshing = false;
        _refreshPromise = null;
      });
    }

    const refreshed = await _refreshPromise;

    if (refreshed) {
      // Retry the original request with new token
      const newToken = getAccessToken();
      headers.Authorization = `Bearer ${newToken}`;
      const retryResponse = await fetch(url, {
        ...options,
        headers,
        signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!retryResponse.ok) {
        const error = await retryResponse
          .json()
          .catch(() => ({ message: `HTTP ${retryResponse.status}` }));
        throw new APIError(
          error.message || `HTTP ${retryResponse.status}`,
          retryResponse.status,
          error.error || error.code
        );
      }
      return parseResponseBody(retryResponse);
    }

    // Refresh failed — clear auth and notify
    clearAuthTokens();
    _onAuthFailure?.();
    throw new APIError('Authentication failed', 401);
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
    throw new APIError(
      error.message || error.error || `HTTP ${response.status}`,
      response.status,
      error.error || error.code
    );
  }

  return parseResponseBody(response);
}

/** Parse a response body, returning undefined for 204 / empty responses. */
async function parseResponseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
        inputTokensToday: 0,
        outputTokensToday: 0,
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
        auditChainValid: true,
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
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ events: SecurityEvent[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.severity) query.set('severity', params.severity);
  if (params?.type) query.set('type', params.type);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset !== undefined) query.set('offset', params.offset.toString());

  const queryString = query.toString();
  try {
    const raw = await request<{ events: Record<string, unknown>[]; total: number }>(
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

// ── ML Security Summary ──────────────────────────────────────────────

export interface MlSecuritySummary {
  enabled: boolean;
  period: '24h' | '7d' | '30d';
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  detections: {
    anomaly: number;
    injectionAttempt: number;
    sandboxViolation: number;
    secretAccess: number;
    total: number;
  };
  trend: { bucket: string; timestamp: number; count: number }[];
}

export async function fetchMlSummary(params?: {
  period?: '24h' | '7d' | '30d';
}): Promise<MlSecuritySummary> {
  const qs = params?.period ? `?period=${params.period}` : '';
  try {
    return await request<MlSecuritySummary>(`/security/ml/summary${qs}`);
  } catch {
    return {
      enabled: false,
      period: params?.period ?? '7d',
      riskScore: 0,
      riskLevel: 'low',
      detections: {
        anomaly: 0,
        injectionAttempt: 0,
        sandboxViolation: 0,
        secretAccess: 0,
        total: 0,
      },
      trend: [],
    };
  }
}

export async function fetchAuditEntries(params?: {
  from?: number;
  to?: number;
  level?: string;
  event?: string;
  userId?: string;
  taskId?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  entries: import('../types').AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}> {
  const query = new URLSearchParams();
  if (params?.from) query.set('from', params.from.toString());
  if (params?.to) query.set('to', params.to.toString());
  if (params?.level) query.set('level', params.level);
  if (params?.event) query.set('event', params.event);
  if (params?.userId) query.set('userId', params.userId);
  if (params?.taskId) query.set('taskId', params.taskId);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset !== undefined) query.set('offset', params.offset.toString());

  const queryString = query.toString();
  try {
    return await request(`/audit${queryString ? `?${queryString}` : ''}`);
  } catch {
    return { entries: [], total: 0, limit: params?.limit ?? 50, offset: params?.offset ?? 0 };
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

export interface CommunityPersonality {
  name: string;
  description: string;
  category: string;
  author: string;
  version: string;
  traits: Record<string, string>;
  sex?: string;
  filename: string;
  avatarFile?: string;
  systemPrompt: string;
}

export async function fetchCommunityPersonalities(): Promise<{
  personalities: CommunityPersonality[];
}> {
  return request('/marketplace/community/personalities');
}

export async function installCommunityPersonality(
  filename: string
): Promise<{ personality: Personality }> {
  return request('/marketplace/community/personalities/install', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
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

export async function enablePersonality(id: string): Promise<void> {
  await request(`/soul/personalities/${id}/enable`, { method: 'POST' });
}

export async function disablePersonality(id: string): Promise<void> {
  await request(`/soul/personalities/${id}/disable`, { method: 'POST' });
}

export async function setDefaultPersonality(id: string): Promise<{ personality: Personality }> {
  return request(`/soul/personalities/${id}/set-default`, { method: 'POST' });
}

export async function clearDefaultPersonality(): Promise<{ success: boolean }> {
  return request('/soul/personalities/clear-default', { method: 'POST' });
}

export async function uploadPersonalityAvatar(
  id: string,
  file: File
): Promise<{ personality: Personality }> {
  const formData = new FormData();
  formData.append('avatar', file);
  const token = getAccessToken();
  const response = await fetch(`${API_BASE}/soul/personalities/${id}/avatar`, {
    method: 'POST',
    body: formData,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(err.message ?? 'Upload failed');
  }
  return response.json();
}

export async function deletePersonalityAvatar(id: string): Promise<{ personality: Personality }> {
  return request(`/soul/personalities/${id}/avatar`, { method: 'DELETE' });
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

export async function updateSoulConfig(patch: Partial<SoulConfig>): Promise<SoulConfig> {
  const data = await request<{ config: SoulConfig }>('/soul/config', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
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
  const result = await request<{ integration: IntegrationInfo }>('/integrations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return result.integration;
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

export async function claimGmailOAuth(data: {
  connectionToken: string;
  displayName: string;
  enableRead: boolean;
  enableSend: boolean;
  labelFilter: 'all' | 'label' | 'custom';
  labelName?: string;
}): Promise<{
  success: boolean;
  config: {
    platform: string;
    displayName: string;
    enabled: boolean;
    config: Record<string, unknown>;
  };
}> {
  return request(
    '/auth/oauth/claim',
    {
      method: 'POST',
      body: JSON.stringify(data),
    },
    true
  );
}

export async function testIntegration(id: string): Promise<{ ok: boolean; message: string }> {
  return request(`/integrations/${id}/test`, { method: 'POST' });
}

export async function startIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/start`, { method: 'POST' });
}

export async function stopIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/stop`, { method: 'POST' });
}

// ─── Training Dataset Export ──────────────────────────────────────

export interface TrainingStats {
  conversations: number;
  memories: number;
  knowledge: number;
}

export async function fetchTrainingStats(): Promise<TrainingStats> {
  return request<TrainingStats>('/training/stats');
}

export async function exportTrainingDataset(opts: {
  format: 'sharegpt' | 'instruction' | 'raw';
  from?: number;
  to?: number;
  personalityIds?: string[];
  limit?: number;
}): Promise<{ url: string; filename: string }> {
  const token = getAccessToken();
  const response = await fetch('/api/v1/training/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(opts),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const err = (await response.json()) as { message?: string };
    throw new Error(err.message ?? `Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const ext = opts.format === 'raw' ? 'txt' : 'jsonl';
  const filename = `training-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
  return { url, filename };
}

// ─── Distillation Jobs ─────────────────────────────────────────────

export interface DistillationJob {
  id: string;
  name: string;
  teacherProvider: string;
  teacherModel: string;
  exportFormat: 'sharegpt' | 'instruction';
  maxSamples: number;
  personalityIds: string[];
  outputPath: string;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
  samplesGenerated: number;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface CreateDistillationJobRequest {
  name: string;
  teacherProvider: string;
  teacherModel: string;
  exportFormat?: 'sharegpt' | 'instruction';
  maxSamples?: number;
  personalityIds?: string[];
  outputPath: string;
  priorityMode?: 'failure-first' | 'uniform' | 'success-first';
  curriculumMode?: boolean;
  counterfactualMode?: boolean;
  maxCounterfactualSamples?: number;
}

export async function fetchDistillationJobs(): Promise<DistillationJob[]> {
  const data = await request<{ jobs: DistillationJob[] }>('/training/distillation/jobs');
  return data.jobs;
}

export async function createDistillationJob(
  req: CreateDistillationJobRequest
): Promise<DistillationJob> {
  return request<DistillationJob>('/training/distillation/jobs', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function deleteDistillationJob(id: string): Promise<void> {
  await request<undefined>(`/training/distillation/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function runDistillationJob(id: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(
    `/training/distillation/jobs/${encodeURIComponent(id)}/run`,
    { method: 'POST' }
  );
}

// ─── Finetune Jobs ─────────────────────────────────────────────────

export interface FinetuneJob {
  id: string;
  name: string;
  baseModel: string;
  adapterName: string;
  datasetPath: string;
  loraRank: number;
  loraAlpha: number;
  batchSize: number;
  epochs: number;
  vramBudgetGb: number;
  image: string;
  containerId: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';
  adapterPath: string | null;
  errorMessage: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface CreateFinetuneJobRequest {
  name: string;
  baseModel: string;
  adapterName: string;
  datasetPath: string;
  loraRank?: number;
  loraAlpha?: number;
  batchSize?: number;
  epochs?: number;
  vramBudgetGb?: number;
}

export async function fetchFinetuneJobs(): Promise<FinetuneJob[]> {
  const data = await request<{ jobs: FinetuneJob[] }>('/training/finetune/jobs');
  return data.jobs;
}

export async function createFinetuneJob(req: CreateFinetuneJobRequest): Promise<FinetuneJob> {
  return request<FinetuneJob>('/training/finetune/jobs', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function deleteFinetuneJob(id: string): Promise<void> {
  await request<undefined>(`/training/finetune/jobs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function registerFinetuneAdapter(
  id: string
): Promise<{ success: boolean; adapterName: string }> {
  return request<{ success: boolean; adapterName: string }>(
    `/training/finetune/jobs/${encodeURIComponent(id)}/register`,
    { method: 'POST' }
  );
}

// ─── Phase 92: Training Stream + Quality + Computer Use ───────────

/** Open an SSE connection to the live training stream. */
export function fetchTrainingStream(): EventSource {
  const token = getAccessToken();
  const url = `${API_BASE}/training/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  return new EventSource(url);
}

export interface QualityScore {
  conversationId: string;
  qualityScore: number;
  signalSource: string;
  scoredAt: string;
}

export async function fetchQualityScores(limit = 100): Promise<{ conversations: QualityScore[] }> {
  return request<{ conversations: QualityScore[] }>(`/training/quality?limit=${limit}`);
}

export async function triggerQualityScoring(): Promise<{ scored: number }> {
  return request<{ scored: number }>('/training/quality/score', { method: 'POST' });
}

export interface ComputerUseEpisode {
  id: string;
  sessionId: string;
  skillName: string;
  stateEncoding: Record<string, unknown>;
  actionType: string;
  actionTarget: string;
  actionValue: string;
  reward: number;
  done: boolean;
  createdAt: string;
}

export interface SkillStat {
  skillName: string;
  episodeCount: number;
  successRate: number;
  avgReward: number;
}

export async function recordComputerUseEpisode(
  ep: Omit<ComputerUseEpisode, 'id' | 'createdAt'>
): Promise<ComputerUseEpisode> {
  return request<ComputerUseEpisode>('/training/computer-use/episodes', {
    method: 'POST',
    body: JSON.stringify(ep),
  });
}

export async function fetchComputerUseEpisodes(opts?: {
  skillName?: string;
  sessionId?: string;
  limit?: number;
}): Promise<ComputerUseEpisode[]> {
  const params = new URLSearchParams();
  if (opts?.skillName) params.set('skillName', opts.skillName);
  if (opts?.sessionId) params.set('sessionId', opts.sessionId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const data = await request<{ episodes: ComputerUseEpisode[] }>(
    `/training/computer-use/episodes${qs ? `?${qs}` : ''}`
  );
  return data.episodes;
}

export async function fetchComputerUseStats(): Promise<{
  skillBreakdown: SkillStat[];
  totals: { totalEpisodes: number; avgReward: number };
}> {
  return request(`/training/computer-use/stats`);
}

export async function deleteComputerUseEpisode(id: string): Promise<void> {
  await request<undefined>(`/training/computer-use/episodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Phase 97: LLM-as-Judge Evaluation ────────────────────────────

export interface EvalDataset {
  id: string;
  name: string;
  personalityId: string | null;
  contentHash: string;
  samples: { prompt: string; gold?: string }[];
  sampleCount: number;
  judgePrompt: string | null;
  judgeModel: string | null;
  createdAt: number;
}

export interface EvalRunSummary {
  evalRunId: string;
  datasetId: string;
  modelName: string;
  sampleCount: number;
  avgGroundedness: number;
  avgCoherence: number;
  avgRelevance: number;
  avgFluency: number;
  avgHarmlessness: number;
  scoredAt: number;
}

export interface EvalScore {
  id: string;
  evalRunId: string;
  datasetId: string;
  modelName: string;
  sampleIndex: number;
  prompt: string;
  response: string;
  groundedness: number;
  coherence: number;
  relevance: number;
  fluency: number;
  harmlessness: number;
  rationale: Record<string, string> | null;
  scoredAt: number;
}

export interface PairwiseComparisonSummary {
  comparisonId: string;
  datasetId: string;
  modelA: string;
  modelB: string;
  sampleCount: number;
  winsA: number;
  winsB: number;
  ties: number;
  winRateA: number;
  winRateB: number;
  scoredAt: number;
}

export interface PairwiseResult {
  id: string;
  comparisonId: string;
  datasetId: string;
  modelA: string;
  modelB: string;
  sampleIndex: number;
  prompt: string;
  responseA: string;
  responseB: string;
  winner: 'a' | 'b' | 'tie';
  reason: string;
  scoredAt: number;
}

export async function fetchEvalDatasets(): Promise<EvalDataset[]> {
  const data = await request<{ datasets: EvalDataset[] }>('/training/judge/datasets');
  return data.datasets;
}

export async function createEvalDataset(req: {
  name: string;
  samples: { prompt: string; gold?: string }[];
  personalityId?: string;
}): Promise<EvalDataset> {
  return request<EvalDataset>('/training/judge/datasets', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function deleteEvalDataset(id: string): Promise<void> {
  await request<undefined>(`/training/judge/datasets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function runPointwiseEval(req: {
  datasetId: string;
  modelName: string;
  finetuneJobId?: string;
  maxSamples?: number;
}): Promise<{ status: string }> {
  return request<{ status: string }>('/training/judge/pointwise', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function fetchEvalRuns(): Promise<EvalRunSummary[]> {
  const data = await request<{ runs: EvalRunSummary[] }>('/training/judge/runs');
  return data.runs;
}

export async function fetchEvalRunScores(runId: string): Promise<EvalScore[]> {
  const data = await request<{ scores: EvalScore[] }>(
    `/training/judge/runs/${encodeURIComponent(runId)}`
  );
  return data.scores;
}

export async function runPairwiseComparison(req: {
  datasetId: string;
  modelA: string;
  modelB: string;
  maxSamples?: number;
}): Promise<{ status: string }> {
  return request<{ status: string }>('/training/judge/pairwise', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function fetchPairwiseComparisons(): Promise<PairwiseComparisonSummary[]> {
  const data = await request<{ comparisons: PairwiseComparisonSummary[] }>(
    '/training/judge/comparisons'
  );
  return data.comparisons;
}

export async function fetchPairwiseDetails(comparisonId: string): Promise<PairwiseResult[]> {
  const data = await request<{ results: PairwiseResult[] }>(
    `/training/judge/comparisons/${encodeURIComponent(comparisonId)}`
  );
  return data.results;
}

// ─── AI Health ────────────────────────────────────────────────────

export async function fetchAiHealth(): Promise<AiHealthStatus> {
  return request<AiHealthStatus>('/ai/health');
}

// ─── OAuth Connected Tokens ────────────────────────────────────────

export async function fetchOAuthConfig(): Promise<{ providers: { id: string; name: string }[] }> {
  try {
    return await request<{ providers: { id: string; name: string }[] }>('/auth/oauth/config');
  } catch {
    return { providers: [] };
  }
}

export async function fetchOAuthTokens(): Promise<OAuthConnectedToken[]> {
  try {
    const data = await request<{ tokens: OAuthConnectedToken[] }>('/auth/oauth/tokens');
    return data.tokens;
  } catch {
    return [];
  }
}

export async function revokeOAuthToken(id: string): Promise<void> {
  await request(`/auth/oauth/tokens/${id}`, { method: 'DELETE' });
}

export async function refreshOAuthToken(id: string): Promise<void> {
  await request(`/auth/oauth/tokens/${id}/refresh`, { method: 'POST' });
}

export async function reloadOAuthConfig(): Promise<{
  providers: { id: string; name: string }[];
}> {
  return request('/auth/oauth/reload', { method: 'POST' });
}

// ─── Auth Roles ───────────────────────────────────────────────────

export interface RoleInfo {
  id: string;
  name: string;
  description?: string;
  permissions: { resource: string; action: string }[];
  inheritFrom?: string[];
  isBuiltin: boolean;
}

export async function fetchRoles(): Promise<{ roles: RoleInfo[] }> {
  try {
    return await request('/auth/roles');
  } catch {
    return { roles: [] };
  }
}

export async function createRole(data: {
  name: string;
  description?: string;
  permissions: { resource: string; action: string }[];
  inheritFrom?: string[];
}): Promise<{ role: RoleInfo }> {
  return request('/auth/roles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateRole(
  id: string,
  data: {
    name?: string;
    description?: string;
    permissions?: { resource: string; action: string }[];
    inheritFrom?: string[];
  }
): Promise<{ role: RoleInfo }> {
  return request(`/auth/roles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteRole(id: string): Promise<{ message: string }> {
  return request(`/auth/roles/${id}`, { method: 'DELETE' });
}

export interface AssignmentInfo {
  userId: string;
  roleId: string;
}

export async function fetchAssignments(): Promise<{ assignments: AssignmentInfo[] }> {
  try {
    return await request('/auth/assignments');
  } catch {
    return { assignments: [] };
  }
}

export async function assignRole(data: {
  userId: string;
  roleId: string;
}): Promise<{ assignment: AssignmentInfo }> {
  return request('/auth/assignments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function revokeAssignment(userId: string): Promise<{ message: string }> {
  return request(`/auth/assignments/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

// ─── Users ────────────────────────────────────────────────────────

export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isBuiltin?: boolean;
  createdAt: number;
  lastLoginAt?: number;
}

export async function fetchUsers(): Promise<{ users: UserInfo[] }> {
  try {
    return await request('/auth/users');
  } catch {
    return { users: [] };
  }
}

export async function createUser(data: {
  email: string;
  displayName: string;
  password: string;
  isAdmin?: boolean;
}): Promise<{ user: UserInfo }> {
  return request('/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateUser(
  id: string,
  data: { displayName?: string; isAdmin?: boolean }
): Promise<{ user: UserInfo }> {
  return request(`/auth/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteUser(id: string): Promise<{ message: string }> {
  return request(`/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ─── Audit Stats ──────────────────────────────────────────────────

export async function fetchAuditStats(): Promise<{
  totalEntries: number;
  oldestEntry?: number;
  lastVerification?: number;
  chainValid: boolean;
  dbSizeEstimateMb?: number;
  chainError?: string;
  chainBrokenAt?: string;
}> {
  try {
    return await request('/audit/stats');
  } catch {
    return { totalEntries: 0, chainValid: true };
  }
}

export async function repairAuditChain(): Promise<{
  repairedCount: number;
  entriesTotal: number;
}> {
  return request('/audit/repair', { method: 'POST' });
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
  const base =
    (window as unknown as { __FRIDAY_API_BASE__?: string }).__FRIDAY_API_BASE__ ||
    `${window.location.protocol}//${window.location.hostname}:18789/api/v1`;
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}/audit/export`, { headers });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

// Audit log export
export async function exportAuditLog(opts: {
  format: 'jsonl' | 'csv' | 'syslog';
  from?: number;
  to?: number;
  level?: string[];
  event?: string[];
  userId?: string;
  limit?: number;
}): Promise<Blob> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/audit/export`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts),
    signal: AbortSignal.timeout(120_000), // large exports may take time
  });
  if (!res.ok) {
    const text = await res.text();
    throw new APIError(text || 'Export failed', res.status);
  }
  return res.blob();
}

// ─── Chat ─────────────────────────────────────────────────────

export async function sendChatMessage(data: {
  message: string;
  history?: { role: string; content: string }[];
  personalityId?: string;
  strategyId?: string;
  editorContent?: string;
  saveAsMemory?: boolean;
  memoryEnabled?: boolean;
  conversationId?: string;
  clientContext?: { viewportHint?: 'mobile' | 'tablet' | 'desktop' };
}): Promise<ChatResponse> {
  return request('/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rememberChatMessage(
  content: string,
  context?: Record<string, string>
): Promise<{ memory: Memory }> {
  return request('/chat/remember', {
    method: 'POST',
    body: JSON.stringify({ content, context }),
  });
}

export async function submitFeedback(
  conversationId: string,
  messageId: string,
  feedback: 'positive' | 'negative' | 'correction',
  details?: string
): Promise<{ stored: boolean }> {
  return request('/chat/feedback', {
    method: 'POST',
    body: JSON.stringify({ conversationId, messageId, feedback, details }),
  });
}

export async function fetchMemories(opts?: {
  search?: string;
  personalityId?: string | null;
}): Promise<{ memories: Memory[] }> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.personalityId) params.set('personalityId', opts.personalityId);
  const qs = params.toString();
  try {
    return await request(`/brain/memories${qs ? `?${qs}` : ''}`);
  } catch {
    return { memories: [] };
  }
}

export async function addMemory(data: {
  type: 'episodic' | 'semantic' | 'procedural' | 'preference';
  content: string;
  source: string;
  context?: Record<string, string>;
  importance?: number;
}): Promise<{ memory: Memory }> {
  return request('/brain/memories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteMemory(id: string): Promise<{ message: string }> {
  return request(`/brain/memories/${id}`, { method: 'DELETE' });
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

export async function patchModelConfig(data: {
  localFirst: boolean;
}): Promise<{ success: boolean; localFirst: boolean }> {
  return request('/model/config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Ollama Model Lifecycle ────────────────────────────────────

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export async function* fetchOllamaPull(
  model: string
): AsyncGenerator<OllamaPullProgress, void, unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (_accessToken) headers.Authorization = `Bearer ${_accessToken}`;

  const response = await fetch(`${API_BASE}/model/ollama/pull`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.body) throw new Error('No response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.replace(/^data: /, '').trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as OllamaPullProgress;
        } catch {
          // ignore parse errors
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function deleteOllamaModel(model: string): Promise<void> {
  const encodedName = encodeURIComponent(model);
  await request(`/model/ollama/${encodedName}`, { method: 'DELETE' });
}

// ─── Provider Health (Phase 119) ──────────────────────────────

export interface ProviderHealthEntry {
  errorRate: number;
  p95LatencyMs: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  consecutiveFailures: number;
  totalRequests: number;
}

export async function fetchProviderHealth(): Promise<Record<string, ProviderHealthEntry>> {
  try {
    return await request<Record<string, ProviderHealthEntry>>('/model/health');
  } catch {
    return {};
  }
}

// ─── Model Default (persistent) ───────────────────────────────

export interface ModelDefaultResponse {
  provider: string | null;
  model: string | null;
}

export async function fetchModelDefault(): Promise<ModelDefaultResponse> {
  try {
    return await request<ModelDefaultResponse>('/model/default');
  } catch {
    return { provider: null, model: null };
  }
}

export async function setModelDefault(data: {
  provider: string;
  model: string;
}): Promise<{ success: boolean }> {
  return request('/model/default', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function clearModelDefault(): Promise<{ success: boolean }> {
  return request('/model/default', { method: 'DELETE' });
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

export async function fetchKnowledge(opts?: {
  personalityId?: string | null;
}): Promise<{ knowledge: KnowledgeEntry[] }> {
  const params = new URLSearchParams();
  if (opts?.personalityId) params.set('personalityId', opts.personalityId);
  const qs = params.toString();
  try {
    return await request(`/brain/knowledge${qs ? `?${qs}` : ''}`);
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

export async function fetchHeartbeatStatus(): Promise<HeartbeatStatus> {
  try {
    return await request<HeartbeatStatus>('/brain/heartbeat/status');
  } catch {
    return {
      running: false,
      enabled: false,
      intervalMs: 0,
      beatCount: 0,
      lastBeat: null,
      tasks: [],
    };
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

export async function fetchHeartbeatLog(params?: {
  checkName?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ entries: HeartbeatLogEntry[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.checkName) q.set('checkName', params.checkName);
  if (params?.status) q.set('status', params.status);
  if (params?.limit !== undefined) q.set('limit', String(params.limit));
  if (params?.offset !== undefined) q.set('offset', String(params.offset));
  const qs = q.toString();
  try {
    return await request(`/proactive/heartbeat/log${qs ? `?${qs}` : ''}`);
  } catch {
    return { entries: [], total: 0 };
  }
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
    return { configured: true, ...result };
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

export interface McpConfigResponse {
  exposeGit: boolean;
  exposeFilesystem: boolean;
  exposeWeb: boolean;
  exposeWebScraping: boolean;
  exposeWebSearch: boolean;
  exposeBrowser: boolean;
  exposeDesktopControl: boolean;
  exposeNetworkTools: boolean;
  exposeTwingateTools: boolean;
  exposeOrgIntentTools: boolean;
  respectContentSignal: boolean;
  allowedUrls: string[];
  webRateLimitPerMinute: number;
  proxyEnabled: boolean;
  proxyProviders: string[];
  proxyStrategy: string;
  proxyDefaultCountry: string;
  exposeSecurityTools: boolean;
  allowedTargets: string[];
  exposeGmail: boolean;
  exposeTwitter: boolean;
  exposeGithub: boolean;
  alwaysSendFullSchemas: boolean;
  exposeKnowledgeBase: boolean;
  exposeDockerTools: boolean;
  // CI/CD (Phase 90)
  exposeGithubActions: boolean;
  exposeJenkins: boolean;
  jenkinsUrl?: string;
  jenkinsUsername?: string;
  jenkinsApiToken?: string;
  exposeGitlabCi: boolean;
  gitlabUrl?: string;
  gitlabToken?: string;
  exposeNorthflank: boolean;
  northflankApiKey?: string;
  // Terminal tools
  exposeTerminal: boolean;
  terminalAllowedCommands?: string[];
  // Cross-project integration tools
  exposeAgnosticTools: boolean;
  exposeAgnosTools: boolean;
  exposeBullshiftTools: boolean;
  exposePhotisnadiTools: boolean;
  exposeIfranTools: boolean;
  exposeDeltaTools: boolean;
  exposeVoiceTools: boolean;
  exposeEdgeTools: boolean;
}

export async function fetchMcpConfig(): Promise<McpConfigResponse> {
  try {
    return await request('/mcp/config');
  } catch {
    return {
      exposeGit: false,
      exposeFilesystem: false,
      exposeWeb: false,
      exposeWebScraping: true,
      exposeWebSearch: true,
      exposeBrowser: false,
      exposeDesktopControl: false,
      exposeNetworkTools: false,
      exposeTwingateTools: false,
      exposeOrgIntentTools: false,
      respectContentSignal: true,
      allowedUrls: [],
      webRateLimitPerMinute: 10,
      proxyEnabled: false,
      proxyProviders: [],
      proxyStrategy: 'round-robin',
      proxyDefaultCountry: '',
      exposeSecurityTools: false,
      allowedTargets: [],
      exposeGmail: false,
      exposeTwitter: false,
      exposeGithub: false,
      alwaysSendFullSchemas: false,
      exposeKnowledgeBase: false,
      exposeDockerTools: false,
      exposeGithubActions: false,
      exposeJenkins: false,
      exposeGitlabCi: false,
      gitlabUrl: 'https://gitlab.com',
      exposeNorthflank: false,
      exposeTerminal: false,
      exposeAgnosticTools: false,
      exposeAgnosTools: false,
      exposeBullshiftTools: false,
      exposePhotisnadiTools: false,
      exposeIfranTools: false,
      exposeDeltaTools: false,
      exposeVoiceTools: false,
      exposeEdgeTools: false,
    };
  }
}

export async function fetchCicdConfig(): Promise<import('../types').CicdPlatformConfig> {
  const config = await fetchMcpConfig();
  return {
    exposeGithubActions: config.exposeGithubActions ?? false,
    exposeJenkins: config.exposeJenkins ?? false,
    jenkinsUrl: config.jenkinsUrl,
    jenkinsUsername: config.jenkinsUsername,
    exposeGitlabCi: config.exposeGitlabCi ?? false,
    gitlabUrl: config.gitlabUrl ?? 'https://gitlab.com',
    exposeNorthflank: config.exposeNorthflank ?? false,
  };
}

export async function updateCicdConfig(
  cfg: Partial<import('../types').CicdPlatformConfig>
): Promise<McpConfigResponse> {
  return updateMcpConfig(cfg);
}

export async function patchMcpConfig(data: Partial<McpConfigResponse>): Promise<McpConfigResponse> {
  return updateMcpConfig(data);
}

export async function updateMcpConfig(
  data: Partial<McpConfigResponse>
): Promise<McpConfigResponse> {
  return request('/mcp/config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Ecosystem Services ────────────────────────────────────

export interface EcosystemServiceInfo {
  id: string;
  displayName: string;
  description: string;
  url: string;
  status: 'disconnected' | 'connected' | 'unreachable' | 'error';
  enabled: boolean;
  lastProbeAt: number | null;
  lastProbeLatencyMs: number | null;
  error: string | null;
  secretsProvisioned: boolean;
}

export async function fetchEcosystemServices(): Promise<EcosystemServiceInfo[]> {
  const res = await request<{ services: EcosystemServiceInfo[] }>('/ecosystem/services');
  return res.services;
}

export async function probeEcosystemService(id: string): Promise<EcosystemServiceInfo> {
  return request(`/ecosystem/services/${encodeURIComponent(id)}/probe`, { method: 'POST' });
}

export async function enableEcosystemService(id: string): Promise<EcosystemServiceInfo> {
  return request(`/ecosystem/services/${encodeURIComponent(id)}/enable`, { method: 'POST' });
}

export async function disableEcosystemService(id: string): Promise<EcosystemServiceInfo> {
  return request(`/ecosystem/services/${encodeURIComponent(id)}/disable`, { method: 'POST' });
}

// ─── AGNOS Sandbox Profiles ─────────────────────────────────

export interface AgnosSandboxProfile {
  id: string;
  name: string;
  description?: string;
  seccomp?: boolean;
  landlock?: boolean;
  networkEnabled?: boolean;
  allowProcessSpawn?: boolean;
  maxMemoryMb?: number;
  allowedHosts?: string[];
}

export async function fetchAgnosSandboxProfiles(): Promise<AgnosSandboxProfile[]> {
  const res = await request<{ profiles: AgnosSandboxProfile[] }>(
    '/ecosystem/services/agnos/sandbox-profiles'
  );
  return res.profiles;
}

// ─── Code Forge ─────────────────────────────────────────────

export interface ForgeConnection {
  key: string;
  provider: string;
  baseUrl: string;
}

export interface ForgeRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  visibility: string;
  defaultBranch: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForgePullRequest {
  id: string;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  sourceBranch: string;
  targetBranch: string;
  author: string;
  url: string;
  createdAt: string;
}

export interface ForgePipeline {
  id: string;
  name: string;
  status: string;
  ref: string;
  sha: string;
  url: string | null;
  createdAt: string;
}

export async function fetchForgeConnections(): Promise<ForgeConnection[]> {
  const res = await request<{ connections: ForgeConnection[] }>('/forge/connections');
  return res.connections;
}

export async function addForgeConnection(config: {
  provider: string;
  baseUrl: string;
  token?: string;
}): Promise<ForgeConnection> {
  return request('/forge/connections', { method: 'POST', body: JSON.stringify(config) });
}

export async function removeForgeConnection(key: string): Promise<void> {
  await request(`/forge/connections/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function fetchForgeRepos(key: string): Promise<ForgeRepo[]> {
  const res = await request<{ repos: ForgeRepo[] }>(`/forge/${encodeURIComponent(key)}/repos`);
  return res.repos;
}

export async function fetchForgePulls(
  key: string,
  owner: string,
  name: string
): Promise<ForgePullRequest[]> {
  const res = await request<{ pulls: ForgePullRequest[] }>(
    `/forge/${encodeURIComponent(key)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`
  );
  return res.pulls;
}

export async function fetchForgePipelines(
  key: string,
  owner: string,
  name: string
): Promise<ForgePipeline[]> {
  const res = await request<{ pipelines: ForgePipeline[] }>(
    `/forge/${encodeURIComponent(key)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pipelines`
  );
  return res.pipelines;
}

// ─── Artifact Registry ──────────────────────────────────────

export interface ContainerImage {
  name: string;
  fullName: string;
  tags: ContainerTag[];
  registry: string;
  visibility?: 'public' | 'private';
  updatedAt?: string;
}

export interface ContainerTag {
  name: string;
  digest: string;
  size?: number;
  pushedAt?: string;
  architecture?: string;
}

export interface BuildArtifact {
  id: string;
  name: string;
  size: number;
  downloadUrl?: string;
  pipelineId: string;
  createdAt: string;
  expiresAt?: string;
}

export async function fetchContainerImages(key: string, owner: string): Promise<ContainerImage[]> {
  const res = await request<{ images: ContainerImage[] }>(
    `/forge/${encodeURIComponent(key)}/artifacts/images?owner=${encodeURIComponent(owner)}`
  );
  return res.images;
}

export async function fetchImageTags(
  key: string,
  owner: string,
  name: string
): Promise<ContainerTag[]> {
  const res = await request<{ tags: ContainerTag[] }>(
    `/forge/${encodeURIComponent(key)}/artifacts/images/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tags`
  );
  return res.tags;
}

export async function fetchBuildArtifacts(
  key: string,
  owner: string,
  repo: string,
  pipelineId: string
): Promise<BuildArtifact[]> {
  const res = await request<{ artifacts: BuildArtifact[] }>(
    `/forge/${encodeURIComponent(key)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pipelines/${encodeURIComponent(pipelineId)}/artifacts`
  );
  return res.artifacts;
}

// ─── Webhook Timeline ───────────────────────────────────────

export interface WebhookTimelineEvent {
  id: string;
  provider: string;
  event: string;
  ref: string;
  conclusion: string;
  runId: string;
  repoUrl: string;
  logsUrl?: string;
  receivedAt: string;
  metadata: Record<string, unknown>;
}

export interface WebhookTimelineFilters {
  provider?: string;
  repo?: string;
  event?: string;
  limit?: number;
  offset?: number;
}

export async function fetchWebhookTimeline(
  filters?: WebhookTimelineFilters
): Promise<{ events: WebhookTimelineEvent[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.repo) params.set('repo', filters.repo);
  if (filters?.event) params.set('event', filters.event);
  if (filters?.limit != null) params.set('limit', String(filters.limit));
  if (filters?.offset != null) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return request(`/webhooks/timeline${qs ? `?${qs}` : ''}`);
}

export async function fetchWebhookTimelineEvent(
  id: string
): Promise<{ event: WebhookTimelineEvent }> {
  return request(`/webhooks/timeline/${encodeURIComponent(id)}`);
}

export async function clearWebhookTimeline(): Promise<void> {
  await request('/webhooks/timeline', { method: 'DELETE' });
}

// ─── Trading & Market Data ──────────────────────────────────

export interface MarketQuoteResponse {
  provider: string;
  data: Record<string, unknown>;
}

export interface MarketHistoricalResponse {
  provider: string;
  symbol: string;
  data: Record<string, unknown>;
}

export async function fetchMarketQuote(symbol: string): Promise<MarketQuoteResponse> {
  return request(`/trading/quote?symbol=${encodeURIComponent(symbol)}`);
}

export async function fetchMarketHistorical(
  symbol: string,
  days = 100
): Promise<MarketHistoricalResponse> {
  return request(`/trading/historical?symbol=${encodeURIComponent(symbol)}&days=${days}`);
}

export async function fetchMarketSearch(keywords: string): Promise<MarketQuoteResponse> {
  return request(`/trading/search?keywords=${encodeURIComponent(keywords)}`);
}

export async function fetchBullshiftPositions(): Promise<unknown> {
  return request('/trading/bullshift/positions');
}

export async function fetchBullshiftAccount(): Promise<unknown> {
  return request('/trading/bullshift/account');
}

export async function fetchBullshiftHealth(): Promise<{ status: string }> {
  return request('/trading/bullshift/health');
}

// ─── MCP Health ─────────────────────────────────────────────

export async function fetchMcpHealth(): Promise<{
  health: import('../types').McpServerHealth[];
}> {
  try {
    return await request('/mcp/health');
  } catch {
    return { health: [] };
  }
}

export async function fetchMcpServerHealth(
  serverId: string
): Promise<import('../types').McpServerHealth | null> {
  try {
    return await request(`/mcp/servers/${serverId}/health`);
  } catch {
    return null;
  }
}

export async function triggerMcpHealthCheck(
  serverId: string
): Promise<import('../types').McpServerHealth> {
  return request(`/mcp/servers/${serverId}/health/check`, { method: 'POST' });
}

// ─── MCP Credentials ───────────────────────────────────────

export async function fetchMcpCredentialKeys(serverId: string): Promise<{ keys: string[] }> {
  try {
    return await request(`/mcp/servers/${serverId}/credentials`);
  } catch {
    return { keys: [] };
  }
}

export async function storeMcpCredential(
  serverId: string,
  key: string,
  value: string
): Promise<void> {
  await request(`/mcp/servers/${serverId}/credentials/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function deleteMcpCredential(serverId: string, key: string): Promise<void> {
  await request(`/mcp/servers/${serverId}/credentials/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  });
}

// ─── Marketplace API ────────────────────────────────────────────

export async function fetchMarketplaceSkills(
  query?: string,
  source?: string,
  personalityId?: string,
  origin?: 'marketplace' | 'community',
  limit?: number,
  offset?: number,
  category?: string
): Promise<{ skills: import('../types').CatalogSkill[]; total: number }> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (origin) {
    params.set('origin', origin);
  } else if (source) {
    params.set('source', source);
  }
  if (personalityId !== undefined) params.set('personalityId', personalityId);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  if (category) params.set('category', category);
  const qs = params.toString();
  return request(`/marketplace${qs ? `?${qs}` : ''}`);
}

export async function installMarketplaceSkill(
  id: string,
  personalityId?: string
): Promise<{ message: string }> {
  return request(`/marketplace/${id}/install`, {
    method: 'POST',
    body: personalityId ? JSON.stringify({ personalityId }) : undefined,
  });
}

export async function uninstallMarketplaceSkill(
  id: string,
  personalityId?: string
): Promise<{ message: string }> {
  return request(`/marketplace/${id}/uninstall`, {
    method: 'POST',
    body: personalityId !== undefined ? JSON.stringify({ personalityId }) : undefined,
  });
}

export async function syncCommunitySkills(): Promise<{
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: string[];
  workflowsAdded?: number;
  workflowsUpdated?: number;
  swarmsAdded?: number;
  swarmsUpdated?: number;
}> {
  return request('/marketplace/community/sync', { method: 'POST' });
}

export async function fetchCommunityStatus(): Promise<{
  communityRepoPath: string | null;
  skillCount: number;
  lastSyncedAt: number | null;
}> {
  return request('/marketplace/community/status');
}

// ─── Personality Export/Import API (Phase 107-D) ──────────────────────

export async function exportPersonality(id: string, format: 'md' | 'json' = 'md'): Promise<Blob> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/soul/personalities/${id}/export?format=${format}`, {
    headers,
  });
  if (!res.ok) throw new Error(`Export failed: ${res.status}`);
  return res.blob();
}

export async function importPersonality(
  file: File
): Promise<{ personality: { id: string; name: string }; warnings: string[] }> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/soul/personalities/import`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `Import failed: ${res.status}`);
  }
  return res.json();
}

// ─── Reports API ────────────────────────────────────────────────

export interface ReportSummary {
  id: string;
  title: string;
  format: string;
  generatedAt: number;
  entryCount: number;
  sizeBytes: number;
}

export async function fetchReports(): Promise<{ reports: ReportSummary[]; total: number }> {
  try {
    return await request('/reports');
  } catch {
    return { reports: [], total: 0 };
  }
}

export async function generateReport(opts: {
  title: string;
  format: string;
}): Promise<{ report: ReportSummary }> {
  return request('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function downloadReport(reportId: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/reports/${reportId}/download`, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
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
  cwd: string,
  allowedCommands?: string[],
  override?: boolean
): Promise<TerminalCommandResult> {
  return request('/terminal/execute', {
    method: 'POST',
    body: JSON.stringify({ command, cwd, allowedCommands, override }),
  });
}

// ─── Conversations API ────────────────────────────────────────

import type { Conversation, ConversationDetail, ConversationMessageResponse } from '../types.js';
export type { Conversation, ConversationDetail, ConversationMessageResponse };

export async function fetchConversations(options?: {
  limit?: number;
  offset?: number;
  personalityId?: string;
}): Promise<{ conversations: Conversation[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.offset) params.set('offset', String(options.offset));
  if (options?.personalityId) params.set('personalityId', options.personalityId);
  const qs = params.toString();
  return request(`/conversations${qs ? `?${qs}` : ''}`);
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  return request(`/conversations/${id}`);
}

export async function createConversation(
  title: string,
  personalityId?: string
): Promise<Conversation> {
  return request('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, personalityId }),
  });
}

export async function deleteConversation(id: string): Promise<{ success: boolean }> {
  return request(`/conversations/${id}`, { method: 'DELETE' });
}

export async function renameConversation(id: string, title: string): Promise<Conversation> {
  return request(`/conversations/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });
}

// ─── Conversation Export & Share API ──────────────────────────────

export type ConversationExportFormat = 'markdown' | 'json' | 'text';

/**
 * Export a conversation as a downloadable file.
 * Triggers a browser download via a hidden <a> element.
 */
export async function exportConversation(
  id: string,
  format: ConversationExportFormat = 'markdown'
): Promise<void> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}/conversations/${id}/export?format=${format}`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Export failed: ${response.statusText}`);
  }

  const blob = await response.blob();

  // Extract filename from Content-Disposition header, or generate a default
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const ext = format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'txt';
  const filename = filenameMatch?.[1] ?? `conversation-${id}.${ext}`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ShareLinkResponse {
  shareId: string;
  expiresAt: number;
  url: string;
}

export async function createShareLink(id: string): Promise<ShareLinkResponse> {
  return request(`/conversations/${id}/share`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function revokeShareLink(id: string, shareId: string): Promise<void> {
  await request(`/conversations/${id}/share`, {
    method: 'DELETE',
    body: JSON.stringify({ shareId }),
  });
}

export async function fetchSharedConversation(token: string): Promise<ConversationDetail> {
  return request(`/conversations/shared/${token}`, {}, true);
}

// ─── Semantic Search API ──────────────────────────────────────────

export async function searchSimilar(params: {
  query: string;
  threshold?: number;
  type?: string;
  limit?: number;
  personalityId?: string | null;
}): Promise<{ results: { id: string; score: number; metadata?: Record<string, unknown> }[] }> {
  const queryParams = new URLSearchParams();
  queryParams.set('query', params.query);
  if (params.threshold !== undefined) queryParams.set('threshold', String(params.threshold));
  if (params.type) queryParams.set('type', params.type);
  if (params.limit) queryParams.set('limit', String(params.limit));
  if (params.personalityId) queryParams.set('personalityId', params.personalityId);
  return request(`/brain/search/similar?${queryParams.toString()}`);
}

export async function reindexBrain(): Promise<{
  message: string;
  memoriesCount: number;
  knowledgeCount: number;
}> {
  return request('/brain/reindex', { method: 'POST' });
}

// ─── Consolidation API ─────────────────────────────────────────

export async function runConsolidation(): Promise<{ report: unknown }> {
  return request('/brain/consolidation/run', { method: 'POST' });
}

export async function fetchConsolidationSchedule(): Promise<{ schedule: string }> {
  return request('/brain/consolidation/schedule');
}

export async function updateConsolidationSchedule(schedule: string): Promise<{ schedule: string }> {
  return request('/brain/consolidation/schedule', {
    method: 'PUT',
    body: JSON.stringify({ schedule }),
  });
}

export async function fetchConsolidationHistory(): Promise<{
  history: {
    timestamp: number;
    totalCandidates: number;
    summary: Record<string, number>;
    dryRun: boolean;
    durationMs: number;
  }[];
}> {
  try {
    return await request('/brain/consolidation/history');
  } catch {
    return { history: [] };
  }
}

// ─── Memory Audit API (Phase 118) ─────────────────────────────────

export async function triggerMemoryAudit(opts?: {
  scope?: string;
  personalityId?: string;
}): Promise<{ report: Record<string, unknown> }> {
  return request('/brain/audit/run', {
    method: 'POST',
    body: JSON.stringify({
      scope: opts?.scope ?? 'daily',
      personalityId: opts?.personalityId,
    }),
  });
}

export async function fetchAuditReports(opts?: {
  scope?: string;
  status?: string;
  limit?: number;
}): Promise<{ reports: Record<string, unknown>[] }> {
  const params = new URLSearchParams();
  if (opts?.scope) params.set('scope', opts.scope);
  if (opts?.status) params.set('status', opts.status);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  try {
    return await request(`/brain/audit/reports${qs ? `?${qs}` : ''}`);
  } catch {
    return { reports: [] };
  }
}

export async function fetchAuditReport(id: string): Promise<{ report: Record<string, unknown> }> {
  return request(`/brain/audit/reports/${id}`);
}

export async function approveAuditReport(id: string): Promise<{ report: Record<string, unknown> }> {
  return request(`/brain/audit/reports/${id}/approve`, { method: 'POST' });
}

export async function fetchAuditSchedules(): Promise<{
  schedules: Record<string, string>;
}> {
  try {
    return await request('/brain/audit/schedule');
  } catch {
    return { schedules: { daily: '30 3 * * *', weekly: '0 4 * * 0', monthly: '0 5 1 * *' } };
  }
}

export async function updateAuditSchedule(
  scope: string,
  schedule: string
): Promise<{ schedules: Record<string, string> }> {
  return request('/brain/audit/schedule', {
    method: 'PUT',
    body: JSON.stringify({ scope, schedule }),
  });
}

export async function fetchMemoryHealth(personalityId?: string): Promise<{
  health: {
    healthScore: number;
    totalMemories: number;
    totalKnowledge: number;
    avgImportance: number;
    expiringWithin7Days: number;
    lowImportanceRatio: number;
    duplicateEstimate: number;
    lastAuditAt: number | null;
    lastAuditScope: string | null;
    compressionSavings: number;
  };
}> {
  const qs = personalityId ? `?personalityId=${encodeURIComponent(personalityId)}` : '';
  try {
    return await request(`/brain/audit/health${qs}`);
  } catch {
    return {
      health: {
        healthScore: 0,
        totalMemories: 0,
        totalKnowledge: 0,
        avgImportance: 0,
        expiringWithin7Days: 0,
        lowImportanceRatio: 0,
        duplicateEstimate: 0,
        lastAuditAt: null,
        lastAuditScope: null,
        compressionSavings: 0,
      },
    };
  }
}

// ─── History Compression API ──────────────────────────────────────

export interface HistoryEntry {
  id: string;
  conversationId: string;
  tier: 'message' | 'topic' | 'bulk';
  content: string;
  tokenCount: number;
  sequence: number;
  createdAt: number;
  sealedAt: number | null;
}

export interface CompressedContext {
  messages: unknown[];
  topics: unknown[];
  bulk: unknown[];
  totalTokens: number;
  tokenBudget: { messages: number; topics: number; bulk: number };
}

export async function fetchConversationHistory(
  conversationId: string,
  tier?: string
): Promise<{ entries: HistoryEntry[]; total: number }> {
  const params = tier ? `?tier=${tier}` : '';
  try {
    return await request(`/conversations/${conversationId}/history${params}`);
  } catch {
    return { entries: [], total: 0 };
  }
}

export async function sealConversationTopic(conversationId: string): Promise<{ message: string }> {
  return request(`/conversations/${conversationId}/seal-topic`, { method: 'POST' });
}

export async function fetchCompressedContext(
  conversationId: string,
  maxTokens?: number
): Promise<CompressedContext> {
  const params = maxTokens ? `?maxTokens=${maxTokens}` : '';
  return request(`/conversations/${conversationId}/compressed-context${params}`);
}

// ─── Conversation Branching & Replay API (Phase 99) ──────────────

import type { BranchTreeNode, ReplayJob, ReplayBatchReport } from '../types.js';
export type { BranchTreeNode, ReplayJob, ReplayBatchReport };

export async function branchFromMessage(
  conversationId: string,
  messageIndex: number,
  opts?: { title?: string; branchLabel?: string }
): Promise<Conversation> {
  return request(`/conversations/${conversationId}/branch`, {
    method: 'POST',
    body: JSON.stringify({ messageIndex, ...opts }),
  });
}

export async function fetchBranches(conversationId: string): Promise<{ branches: Conversation[] }> {
  return request(`/conversations/${conversationId}/branches`);
}

export async function fetchBranchTree(conversationId: string): Promise<BranchTreeNode> {
  return request(`/conversations/${conversationId}/tree`);
}

export async function replayConversation(
  conversationId: string,
  config: { model: string; provider: string; personalityId?: string }
): Promise<{ replayConversationId: string; replayJobId: string }> {
  return request(`/conversations/${conversationId}/replay`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function createReplayBatch(config: {
  sourceConversationIds: string[];
  replayModel: string;
  replayProvider: string;
  replayPersonalityId?: string;
}): Promise<ReplayJob> {
  return request('/conversations/replay-batch', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function fetchReplayJobs(): Promise<{ jobs: ReplayJob[] }> {
  return request('/replay-jobs');
}

export async function fetchReplayJob(id: string): Promise<ReplayJob> {
  return request(`/replay-jobs/${id}`);
}

export async function fetchReplayReport(id: string): Promise<ReplayBatchReport> {
  return request(`/replay-jobs/${id}/report`);
}

// ─── Sub-Agent Delegation API ─────────────────────────────────────

export interface AgentProfileInfo {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  maxTokenBudget: number;
  allowedTools: string[];
  defaultModel: string | null;
  isBuiltin: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface DelegationInfo {
  id: string;
  parentDelegationId: string | null;
  profileId: string;
  task: string;
  context: string | null;
  status: string;
  result: string | null;
  error: string | null;
  depth: number;
  maxDepth: number;
  tokenBudget: number;
  tokensUsedPrompt: number;
  tokensUsedCompletion: number;
  timeoutMs: number;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  initiatedBy: string | null;
  correlationId: string | null;
}

export interface DelegationResultInfo {
  delegationId: string;
  profile: string;
  status: string;
  result: string | null;
  error: string | null;
  tokenUsage: { prompt: number; completion: number; total: number };
  durationMs: number;
  subDelegations: DelegationResultInfo[];
}

export interface ActiveDelegationInfo {
  delegationId: string;
  profileId: string;
  profileName: string;
  task: string;
  status: string;
  depth: number;
  tokensUsed: number;
  tokenBudget: number;
  startedAt: number;
  elapsedMs: number;
  initiatedByPersonalityId?: string;
}

export async function fetchAgentProfiles(): Promise<{ profiles: AgentProfileInfo[] }> {
  try {
    return await request('/agents/profiles');
  } catch {
    return { profiles: [] };
  }
}

export async function createAgentProfile(data: {
  name: string;
  description?: string;
  systemPrompt: string;
  maxTokenBudget?: number;
  allowedTools?: string[];
  defaultModel?: string | null;
}): Promise<{ profile: AgentProfileInfo }> {
  return request('/agents/profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAgentProfile(
  id: string,
  data: Partial<{
    name: string;
    description: string;
    systemPrompt: string;
    maxTokenBudget: number;
    allowedTools: string[];
    defaultModel: string | null;
  }>
): Promise<{ profile: AgentProfileInfo }> {
  return request(`/agents/profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAgentProfile(id: string): Promise<{ success: boolean }> {
  return request(`/agents/profiles/${id}`, { method: 'DELETE' });
}

export async function delegateTask(data: {
  profile: string;
  task: string;
  context?: string;
  maxTokenBudget?: number;
  maxDepth?: number;
  timeout?: number;
}): Promise<DelegationResultInfo> {
  return request('/agents/delegate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchDelegations(params?: {
  status?: string;
  profileId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ delegations: DelegationInfo[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.profileId) query.set('profileId', params.profileId);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const qs = query.toString();
  try {
    return await request(`/agents/delegations${qs ? `?${qs}` : ''}`);
  } catch {
    return { delegations: [], total: 0 };
  }
}

export async function fetchActiveDelegations(): Promise<{ delegations: ActiveDelegationInfo[] }> {
  try {
    return await request('/agents/delegations/active');
  } catch {
    return { delegations: [] };
  }
}

export async function fetchDelegation(
  id: string
): Promise<{ delegation: DelegationInfo; tree: DelegationInfo[] } | null> {
  try {
    return await request(`/agents/delegations/${id}`);
  } catch {
    return null;
  }
}

export async function cancelDelegation(id: string): Promise<{ success: boolean }> {
  return request(`/agents/delegations/${id}/cancel`, { method: 'POST' });
}

export async function fetchDelegationMessages(
  delegationId: string
): Promise<{ messages: Record<string, unknown>[] }> {
  try {
    return await request(`/agents/delegations/${delegationId}/messages`);
  } catch {
    return { messages: [] };
  }
}

export async function fetchAgentConfig(): Promise<{
  config: Record<string, unknown>;
  allowedBySecurityPolicy: boolean;
}> {
  try {
    return await request('/agents/config');
  } catch {
    return { config: {}, allowedBySecurityPolicy: false };
  }
}

export async function updateAgentConfig(data: { enabled?: boolean }): Promise<{
  config: Record<string, unknown>;
  allowedBySecurityPolicy: boolean;
}> {
  return request('/agents/config', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export interface SecurityPolicy {
  allowSubAgents: boolean;
  allowA2A: boolean;
  allowSwarms: boolean;
  allowExtensions: boolean;
  allowExecution: boolean;
  allowProactive: boolean;
  allowWorkflows: boolean;
  allowCommunityGitFetch: boolean;
  allowExperiments: boolean;
  allowStorybook: boolean;
  allowMultimodal: boolean;
  allowDesktopControl: boolean;
  allowCamera: boolean;
  allowDynamicTools: boolean;
  sandboxDynamicTools: boolean;
  allowAnomalyDetection: boolean;
  allowSimulation: boolean;
  sandboxFirecracker: boolean;
  sandboxGvisor: boolean;
  sandboxWasm: boolean;
  sandboxCredentialProxy: boolean;
  allowNetworkTools: boolean;
  allowNetBoxWrite: boolean;
  allowTwingate: boolean;
  allowOrgIntent: boolean;
  allowIntent: boolean;
  allowIntentEditor: boolean;
  allowKnowledgeBase: boolean;
  allowCodeEditor: boolean;
  allowAdvancedEditor: boolean;
  allowTrainingExport: boolean;
  promptGuardMode: 'block' | 'warn' | 'disabled';
  responseGuardMode: 'block' | 'warn' | 'disabled';
  jailbreakThreshold: number;
  jailbreakAction: 'block' | 'warn' | 'audit_only';
  strictSystemPromptConfidentiality: boolean;
  abuseDetectionEnabled: boolean;
  contentGuardrailsEnabled: boolean;
  contentGuardrailsPiiMode: 'disabled' | 'detect_only' | 'redact';
  contentGuardrailsToxicityEnabled: boolean;
  contentGuardrailsToxicityMode: 'block' | 'warn' | 'audit_only';
  contentGuardrailsToxicityClassifierUrl?: string;
  contentGuardrailsToxicityThreshold: number;
  contentGuardrailsBlockList: string[];
  contentGuardrailsBlockedTopics: string[];
  contentGuardrailsGroundingEnabled: boolean;
  contentGuardrailsGroundingMode: 'flag' | 'block';
}

export async function fetchSecurityPolicy(): Promise<SecurityPolicy> {
  try {
    return await request('/security/policy');
  } catch {
    return {
      allowSubAgents: false,
      allowA2A: false,
      allowSwarms: false,
      allowExtensions: false,
      allowExecution: true,
      allowProactive: false,
      allowWorkflows: false,
      allowCommunityGitFetch: false,
      allowExperiments: false,
      allowStorybook: false,
      allowMultimodal: false,
      allowDesktopControl: false,
      allowCamera: false,
      allowDynamicTools: false,
      sandboxDynamicTools: true,
      allowAnomalyDetection: false,
      allowSimulation: false,
      sandboxFirecracker: false,
      sandboxGvisor: false,
      sandboxWasm: false,
      sandboxCredentialProxy: false,
      allowNetworkTools: false,
      allowNetBoxWrite: false,
      allowTwingate: false,
      allowOrgIntent: false,
      allowIntent: false,
      allowIntentEditor: false,
      allowKnowledgeBase: false,
      allowCodeEditor: false,
      allowAdvancedEditor: false,
      allowTrainingExport: false,
      promptGuardMode: 'block',
      responseGuardMode: 'block',
      jailbreakThreshold: 0.5,
      jailbreakAction: 'block',
      strictSystemPromptConfidentiality: false,
      abuseDetectionEnabled: true,
      contentGuardrailsEnabled: true,
      contentGuardrailsPiiMode: 'redact',
      contentGuardrailsToxicityEnabled: true,
      contentGuardrailsToxicityMode: 'block',
      contentGuardrailsToxicityThreshold: 0.7,
      contentGuardrailsBlockList: [],
      contentGuardrailsBlockedTopics: [],
      contentGuardrailsGroundingEnabled: true,
      contentGuardrailsGroundingMode: 'block',
    };
  }
}

export async function updateSecurityPolicy(data: Partial<SecurityPolicy>): Promise<SecurityPolicy> {
  return request('/security/policy', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ─── Accelerator & Inference Routing API ──────────────────────────

export type AcceleratorVendor =
  | 'nvidia'
  | 'amd'
  | 'intel'
  | 'google'
  | 'apple'
  | 'aws'
  | 'qualcomm'
  | 'habana'
  | 'vulkan'
  | 'unknown';
export type AcceleratorFamily = 'cpu' | 'gpu' | 'npu' | 'tpu' | 'ai_asic';

export interface GpuDevice {
  index: number;
  name: string;
  vendor: AcceleratorVendor;
  family: AcceleratorFamily;
  vramTotalMb: number;
  vramUsedMb: number;
  vramFreeMb: number;
  utilizationPercent: number;
  temperatureCelsius: number | null;
  driverVersion: string;
  computeCapability: string | null;
  cudaAvailable: boolean;
  rocmAvailable: boolean;
  tpuAvailable: boolean;
}

export interface GpuProbeResult {
  available: boolean;
  devices: GpuDevice[];
  totalVramMb: number;
  totalFreeVramMb: number;
  bestDevice: GpuDevice | null;
  localInferenceViable: boolean;
  tpuCount: number;
  tpuAvailable: boolean;
  source: 'ai-hwaccel' | 'builtin';
  probedAt: string;
}

export interface LocalModel {
  name: string;
  provider: 'ollama' | 'lmstudio' | 'localai';
  sizeBytes: number;
  estimatedVramMb: number;
  lastSeen: string;
  capabilities: string[];
  tier: string;
  family: string;
  parameterCount: string | null;
}

export interface LocalModelRegistryState {
  models: LocalModel[];
  lastRefreshed: string;
  ollamaAvailable: boolean;
  lmstudioAvailable: boolean;
  localaiAvailable: boolean;
}

export interface PrivacyRoutingDecision {
  target: 'local' | 'cloud';
  reason: string;
  localModel: LocalModel | null;
  classificationLevel: string;
  containsPii: boolean;
  localViable: boolean;
  confidence: number;
}

export async function fetchGpuStatus(refresh = false): Promise<GpuProbeResult> {
  return request(`/system/gpu${refresh ? '?refresh=true' : ''}`);
}

export async function fetchLocalModels(refresh = false): Promise<LocalModelRegistryState> {
  return request(`/system/local-models${refresh ? '?refresh=true' : ''}`);
}

export async function checkPrivacyRoute(
  content: string,
  policy?: string
): Promise<PrivacyRoutingDecision> {
  return request('/ai/privacy-route', {
    method: 'POST',
    body: JSON.stringify({ content, policy }),
  });
}

// ─── Agnostic Platform API ────────────────────────────────────────

export interface AgnosticPreset {
  name: string;
  domain: string;
  size: string;
  description: string;
  agent_count: number;
  agents: { key: string; role: string; goal: string }[];
}

export interface AgnosticCrew {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  preset?: string;
  domain?: string;
  created_at: string;
  completed_at?: string;
  agent_results?: unknown[];
}

export interface AgnosticWidgetData {
  status: 'healthy' | 'degraded' | 'offline';
  tasks: { pending: number; running: number; completed: number; failed: number };
  agents: { total: number; active: number };
  presets?: { name: string; domain: string; agent_count: number }[];
  recentTasks: { id: string; title: string; status: string; domain: string; createdAt: string }[];
}

export async function fetchAgnosticWidget(): Promise<AgnosticWidgetData> {
  return request('/integrations/agnostic/widget');
}

export async function fetchAgnosticPresets(params?: {
  domain?: string;
  size?: string;
}): Promise<{ presets: AgnosticPreset[] }> {
  const query = new URLSearchParams();
  if (params?.domain) query.set('domain', params.domain);
  if (params?.size) query.set('size', params.size);
  const qs = query.toString();
  return request(`/integrations/agnostic/presets${qs ? `?${qs}` : ''}`);
}

export async function fetchAgnosticPresetDetail(name: string): Promise<AgnosticPreset> {
  return request(`/integrations/agnostic/presets/${encodeURIComponent(name)}`);
}

export async function fetchAgnosticCrews(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ crews: AgnosticCrew[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const qs = query.toString();
  return request(`/integrations/agnostic/crews${qs ? `?${qs}` : ''}`);
}

export async function submitAgnosticCrew(data: {
  title: string;
  description: string;
  preset?: string;
  priority?: string;
  target_url?: string;
}): Promise<{ crew_id: string; status: string }> {
  return request('/integrations/agnostic/crews', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function cancelAgnosticCrew(crewId: string): Promise<{ status: string }> {
  return request(`/integrations/agnostic/crews/${crewId}/cancel`, { method: 'POST' });
}

// ─── Sandbox API ─────────────────────────────────────────────────

export async function fetchSandboxCapabilities(): Promise<{
  technologies: {
    technology: string;
    available: boolean;
    strength: number;
    missingPrerequisites: string[];
    installHint: string;
  }[];
  activeTechnology: string;
  activeStrength: number;
}> {
  return request('/sandbox/capabilities');
}

export async function fetchSandboxStatus(): Promise<{
  enabled: boolean;
  technology: string;
  sandboxType: string;
  strength: number;
}> {
  return request('/sandbox/status');
}

export async function fetchSandboxHealth(): Promise<{
  healthy: boolean;
  technology: string;
  lastChecked: string;
  checkDurationMs: number;
  error: string | null;
}> {
  return request('/sandbox/health');
}

export async function switchSandboxTechnology(technology: string): Promise<unknown> {
  return request('/sandbox/config', {
    method: 'PATCH',
    body: JSON.stringify({ technology }),
  });
}

// ─── Extensions API (Phase 6.4a) ──────────────────────────────────

export async function fetchExtensions(): Promise<{
  extensions: {
    id: string;
    name: string;
    version: string;
    enabled: boolean;
    createdAt: number;
  }[];
}> {
  try {
    return await request('/extensions');
  } catch {
    return { extensions: [] };
  }
}

export async function registerExtension(data: {
  id: string;
  name: string;
  version: string;
  hooks: { point: string; semantics: string; priority?: number }[];
}): Promise<{ extension: Record<string, unknown> }> {
  return request('/extensions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeExtension(id: string): Promise<{ success: boolean }> {
  return request(`/extensions/${id}`, { method: 'DELETE' });
}

export async function fetchExtensionHooks(): Promise<{
  hooks: {
    id: string;
    extensionId: string;
    hookPoint: string;
    semantics: string;
    priority: number;
    enabled: boolean;
  }[];
}> {
  try {
    return await request('/extensions/hooks');
  } catch {
    return { hooks: [] };
  }
}

export async function registerExtensionHook(data: {
  extensionId: string;
  hookPoint: string;
  semantics: string;
  priority?: number;
}): Promise<{ hook: Record<string, unknown> }> {
  return request('/extensions/hooks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeExtensionHook(id: string): Promise<{ success: boolean }> {
  return request(`/extensions/hooks/${id}`, { method: 'DELETE' });
}

export async function fetchExtensionWebhooks(): Promise<{
  webhooks: { id: string; url: string; hookPoints: string[]; enabled: boolean }[];
}> {
  try {
    return await request('/extensions/webhooks');
  } catch {
    return { webhooks: [] };
  }
}

export async function registerExtensionWebhook(data: {
  url: string;
  hookPoints: string[];
  secret?: string;
  enabled?: boolean;
}): Promise<{ webhook: Record<string, unknown> }> {
  return request('/extensions/webhooks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateExtensionWebhook(
  id: string,
  data: Partial<{ url: string; hookPoints: string[]; enabled: boolean }>
): Promise<{ webhook: Record<string, unknown> }> {
  return request(`/extensions/webhooks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function removeExtensionWebhook(id: string): Promise<{ success: boolean }> {
  return request(`/extensions/webhooks/${id}`, { method: 'DELETE' });
}

export async function discoverExtensions(): Promise<{
  extensions: Record<string, unknown>[];
}> {
  return request('/extensions/discover', { method: 'POST' });
}

export async function fetchExtensionConfig(): Promise<{ config: Record<string, unknown> }> {
  try {
    return await request('/extensions/config');
  } catch {
    return { config: {} };
  }
}

export async function fetchHookExecutionLog(
  hookPoint?: string,
  limit = 100
): Promise<{
  entries: {
    id: string;
    hookPoint: string;
    handlerCount: number;
    durationMs: number;
    vetoed: boolean;
    errors: string[];
    timestamp: number;
    isTest: boolean;
  }[];
}> {
  const params = new URLSearchParams();
  if (hookPoint) params.set('hookPoint', hookPoint);
  params.set('limit', String(limit));
  try {
    return await request(`/extensions/hooks/log?${params.toString()}`);
  } catch {
    return { entries: [] };
  }
}

export async function testHookPoint(data: { hookPoint: string; data?: unknown }): Promise<{
  result: { vetoed: boolean; errors: string[]; transformed?: unknown };
  durationMs: number;
}> {
  return request('/extensions/hooks/test', { method: 'POST', body: JSON.stringify(data) });
}

// ─── Code Execution API (Phase 6.4b) ──────────────────────────────

export async function executeCode(data: {
  runtime: string;
  code: string;
  sessionId?: string;
  timeout?: number;
}): Promise<{
  id: string;
  sessionId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  truncated: boolean;
}> {
  return request('/execution/run', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchExecutionSessions(): Promise<{
  sessions: {
    id: string;
    runtime: string;
    status: string;
    createdAt: number;
    lastActivity: number;
  }[];
}> {
  try {
    return await request('/execution/sessions');
  } catch {
    return { sessions: [] };
  }
}

export async function fetchExecutionSession(id: string): Promise<{
  id: string;
  runtime: string;
  status: string;
  createdAt: number;
  lastActivity: number;
} | null> {
  try {
    return await request(`/execution/sessions/${id}`);
  } catch {
    return null;
  }
}

export async function terminateExecutionSession(id: string): Promise<{ success: boolean }> {
  return request(`/execution/sessions/${id}`, { method: 'DELETE' });
}

export async function fetchExecutionHistory(params?: {
  sessionId?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  executions: {
    id: string;
    sessionId: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration: number;
    createdAt: number;
  }[];
  total: number;
}> {
  const query = new URLSearchParams();
  if (params?.sessionId) query.set('sessionId', params.sessionId);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const qs = query.toString();
  try {
    return await request(`/execution/history${qs ? `?${qs}` : ''}`);
  } catch {
    return { executions: [], total: 0 };
  }
}

export async function approveExecution(id: string): Promise<{ approval: Record<string, unknown> }> {
  return request(`/execution/approve/${id}`, { method: 'POST' });
}

export async function rejectExecution(id: string): Promise<{ approval: Record<string, unknown> }> {
  return request(`/execution/approve/${id}`, { method: 'DELETE' });
}

export async function fetchExecutionConfig(): Promise<{ config: Record<string, unknown> }> {
  try {
    return await request('/execution/config');
  } catch {
    return { config: {} };
  }
}

// ─── A2A Protocol API (Phase 6.5) ─────────────────────────────────

export async function fetchA2APeers(): Promise<{
  peers: {
    id: string;
    name: string;
    url: string;
    trustLevel: string;
    status: string;
    lastSeen: number;
    capabilities: { name: string; description: string; version: string }[];
  }[];
}> {
  try {
    return await request('/a2a/peers');
  } catch {
    return { peers: [] };
  }
}

export async function addA2APeer(data: {
  url: string;
  name?: string;
}): Promise<{ peer: Record<string, unknown> }> {
  return request('/a2a/peers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeA2APeer(id: string): Promise<{ success: boolean }> {
  return request(`/a2a/peers/${id}`, { method: 'DELETE' });
}

export async function updateA2ATrust(
  id: string,
  level: string
): Promise<{ peer: Record<string, unknown> }> {
  return request(`/a2a/peers/${id}/trust`, {
    method: 'PUT',
    body: JSON.stringify({ level }),
  });
}

export async function discoverA2APeers(): Promise<{ peers: Record<string, unknown>[] }> {
  return request('/a2a/discover', { method: 'POST' });
}

export async function fetchA2ACapabilities(): Promise<{
  capabilities: { name: string; description: string; version: string }[];
}> {
  try {
    return await request('/a2a/capabilities');
  } catch {
    return { capabilities: [] };
  }
}

export async function delegateA2ATask(data: {
  peerId: string;
  task: string;
}): Promise<{ message: Record<string, unknown> }> {
  return request('/a2a/delegate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchA2AMessages(params?: {
  peerId?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  messages: {
    id: string;
    type: string;
    fromPeerId: string;
    toPeerId: string;
    payload: unknown;
    timestamp: number;
  }[];
  total: number;
}> {
  const query = new URLSearchParams();
  if (params?.peerId) query.set('peerId', params.peerId);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const qs = query.toString();
  try {
    return await request(`/a2a/messages${qs ? `?${qs}` : ''}`);
  } catch {
    return { messages: [], total: 0 };
  }
}

export async function fetchA2AConfig(): Promise<{ config: Record<string, unknown> }> {
  try {
    return await request('/a2a/config');
  } catch {
    return { config: {} };
  }
}

// ─── Proactive Assistance API (Phase 7.2) ──────────────────────────

export interface ProactiveTriggerData {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  type: 'schedule' | 'event' | 'pattern' | 'webhook' | 'llm';
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  approvalMode: 'auto' | 'suggest' | 'manual';
  cooldownMs: number;
  limitPerDay: number;
  builtin: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProactiveSuggestionData {
  id: string;
  triggerId: string;
  triggerName: string;
  action: Record<string, unknown>;
  context: Record<string, unknown>;
  confidence: number;
  suggestedAt: string;
  status: 'pending' | 'approved' | 'dismissed' | 'executed' | 'expired';
  expiresAt: string;
  approvedAt?: string;
  executedAt?: string;
  dismissedAt?: string;
  result?: Record<string, unknown>;
}

export interface ProactivePatternData {
  id: string;
  type: 'temporal' | 'sequential' | 'contextual';
  description: string;
  confidence: number;
  occurrences: number;
  lastSeen: number;
  context: Record<string, unknown>;
}

export async function fetchProactiveTriggers(filter?: {
  type?: string;
  enabled?: boolean;
}): Promise<{ triggers: ProactiveTriggerData[] }> {
  const query = new URLSearchParams();
  if (filter?.type) query.set('type', filter.type);
  if (filter?.enabled !== undefined) query.set('enabled', String(filter.enabled));
  const qs = query.toString();
  try {
    return await request(`/proactive/triggers${qs ? `?${qs}` : ''}`);
  } catch {
    return { triggers: [] };
  }
}

export async function fetchBuiltinTriggers(): Promise<{ triggers: ProactiveTriggerData[] }> {
  try {
    return await request('/proactive/triggers/builtin');
  } catch {
    return { triggers: [] };
  }
}

export async function createProactiveTrigger(
  data: Omit<ProactiveTriggerData, 'id' | 'createdAt' | 'updatedAt' | 'builtin'>
): Promise<ProactiveTriggerData> {
  return request('/proactive/triggers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateProactiveTrigger(
  id: string,
  data: Partial<ProactiveTriggerData>
): Promise<ProactiveTriggerData> {
  return request(`/proactive/triggers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProactiveTrigger(id: string): Promise<{ success: boolean }> {
  return request(`/proactive/triggers/${id}`, { method: 'DELETE' });
}

export async function enableProactiveTrigger(id: string): Promise<ProactiveTriggerData> {
  return request(`/proactive/triggers/${id}/enable`, { method: 'POST' });
}

export async function disableProactiveTrigger(id: string): Promise<ProactiveTriggerData> {
  return request(`/proactive/triggers/${id}/disable`, { method: 'POST' });
}

export async function testProactiveTrigger(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/proactive/triggers/${id}/test`, { method: 'POST' });
}

export async function enableBuiltinTrigger(id: string): Promise<ProactiveTriggerData> {
  return request(`/proactive/triggers/builtin/${id}/enable`, { method: 'POST' });
}

export async function fetchProactiveSuggestions(filter?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ suggestions: ProactiveSuggestionData[]; total: number }> {
  const query = new URLSearchParams();
  if (filter?.status) query.set('status', filter.status);
  if (filter?.limit) query.set('limit', String(filter.limit));
  if (filter?.offset) query.set('offset', String(filter.offset));
  const qs = query.toString();
  try {
    return await request(`/proactive/suggestions${qs ? `?${qs}` : ''}`);
  } catch {
    return { suggestions: [], total: 0 };
  }
}

export async function approveProactiveSuggestion(
  id: string
): Promise<{ success: boolean; message: string }> {
  return request(`/proactive/suggestions/${id}/approve`, { method: 'POST' });
}

export async function dismissProactiveSuggestion(id: string): Promise<{ success: boolean }> {
  return request(`/proactive/suggestions/${id}/dismiss`, { method: 'POST' });
}

export async function clearExpiredSuggestions(): Promise<{ deleted: number }> {
  return request('/proactive/suggestions/expired', { method: 'DELETE' });
}

export async function fetchProactivePatterns(): Promise<{ patterns: ProactivePatternData[] }> {
  try {
    return await request('/proactive/patterns');
  } catch {
    return { patterns: [] };
  }
}

export async function convertPatternToTrigger(patternId: string): Promise<ProactiveTriggerData> {
  return request(`/proactive/patterns/${patternId}/convert`, { method: 'POST' });
}

export async function fetchProactiveStatus(): Promise<Record<string, unknown>> {
  try {
    return await request('/proactive/status');
  } catch {
    return { initialized: false, enabled: false };
  }
}

export async function fetchProactiveConfig(): Promise<{ config: Record<string, unknown> }> {
  try {
    return await request('/proactive/status');
  } catch {
    return { config: {} };
  }
}

// ─── Multimodal API (Phase 7.3) ───────────────────────────────────

export async function fetchMultimodalConfig(): Promise<Record<string, unknown>> {
  try {
    return await request('/multimodal/config');
  } catch {
    return { enabled: false };
  }
}

export async function fetchMultimodalJobs(params?: {
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ jobs: Record<string, unknown>[]; total: number }> {
  try {
    const query = new URLSearchParams();
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return await request(`/multimodal/jobs${qs ? `?${qs}` : ''}`);
  } catch {
    return { jobs: [], total: 0 };
  }
}

export async function analyzeImage(data: {
  imageBase64: string;
  mimeType: string;
  prompt?: string;
}): Promise<{ description: string; labels: string[]; durationMs: number }> {
  return request('/multimodal/vision/analyze', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMultimodalProvider(
  type: 'vision' | 'tts' | 'stt',
  provider: string
): Promise<void> {
  await request('/multimodal/provider', {
    method: 'PATCH',
    body: JSON.stringify({ type, provider }),
  });
}

export async function transcribeAudio(data: {
  audioBase64: string;
  format?: string;
  language?: string;
}): Promise<{ text: string; language?: string; durationMs: number }> {
  return request('/multimodal/audio/transcribe', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function synthesizeSpeech(data: {
  text: string;
  voice?: string;
  model?: string;
  responseFormat?: string;
}): Promise<{ audioBase64: string; format: string; durationMs: number }> {
  return request('/multimodal/audio/speak', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateImage(data: {
  prompt: string;
  size?: string;
  quality?: string;
  style?: string;
}): Promise<{ imageUrl: string; revisedPrompt?: string; durationMs: number }> {
  return request('/multimodal/image/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function synthesizeSpeechStream(data: {
  text: string;
  voice?: string;
  model?: string;
  responseFormat?: string;
}): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}/multimodal/audio/speak/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`TTS stream error: ${response.status}`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function updateMultimodalModel(type: 'stt' | 'tts', model: string): Promise<void> {
  await request('/multimodal/model', {
    method: 'PATCH',
    body: JSON.stringify({ type, model }),
  });
}

// ─── Browser Automation (Phase 13) ─────────────────────────────────

export async function fetchBrowserSessions(params?: {
  status?: string;
  toolName?: string;
  limit?: number;
  offset?: number;
}): Promise<{ sessions: Record<string, unknown>[]; total: number }> {
  try {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.toolName) query.set('toolName', params.toolName);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const qs = query.toString();
    return await request(`/browser/sessions${qs ? `?${qs}` : ''}`);
  } catch {
    return { sessions: [], total: 0 };
  }
}

export async function fetchBrowserSession(id: string): Promise<Record<string, unknown> | null> {
  try {
    return await request(`/browser/sessions/${id}`);
  } catch {
    return null;
  }
}

export async function closeBrowserSession(id: string): Promise<Record<string, unknown> | null> {
  try {
    return await request(`/browser/sessions/${id}/close`, { method: 'POST' });
  } catch {
    return null;
  }
}

export async function fetchBrowserConfig(): Promise<Record<string, unknown>> {
  try {
    return await request('/browser/config');
  } catch {
    return { exposeBrowser: false };
  }
}

// ─── Cost Analytics (Phase 10) ─────────────────────────────────────

export interface CostProviderBreakdown {
  tokensUsed: number;
  costUsd: number;
  calls: number;
  errors: number;
}

export interface CostBreakdownResponse {
  byProvider: Record<string, CostProviderBreakdown>;
  recommendations: {
    id: string;
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high';
    estimatedSavingsUsd: number;
    currentCostUsd: number;
    suggestedAction: string;
    category: string;
  }[];
}

export async function fetchCostBreakdown(): Promise<CostBreakdownResponse> {
  try {
    return await request<CostBreakdownResponse>('/costs/breakdown');
  } catch {
    return { byProvider: {}, recommendations: [] };
  }
}

export interface CostHistoryRow {
  date: string;
  provider: string;
  model: string;
  personalityId: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  costUsd: number;
  calls: number;
}

export interface CostHistoryResponse {
  records: CostHistoryRow[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    calls: number;
  };
}

export interface CostHistoryParams {
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
  personalityId?: string;
  groupBy?: 'day' | 'hour';
}

export async function fetchCostHistory(
  params: CostHistoryParams = {}
): Promise<CostHistoryResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.provider) qs.set('provider', params.provider);
  if (params.model) qs.set('model', params.model);
  if (params.personalityId) qs.set('personalityId', params.personalityId);
  if (params.groupBy) qs.set('groupBy', params.groupBy);

  const query = qs.toString();
  try {
    return await request<CostHistoryResponse>(`/costs/history${query ? `?${query}` : ''}`);
  } catch {
    return {
      records: [],
      totals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, calls: 0 },
    };
  }
}

export async function resetUsageStat(stat: 'errors' | 'latency'): Promise<{ success: boolean }> {
  return request('/costs/reset', {
    method: 'POST',
    body: JSON.stringify({ stat }),
  });
}

// ─── Agent Swarms API (Phase 17) ───────────────────────────────────

export interface SwarmRoleInfo {
  role: string;
  profileName: string;
  description: string;
}

export interface SwarmTemplate {
  id: string;
  name: string;
  description: string;
  strategy: 'sequential' | 'parallel' | 'dynamic';
  roles: SwarmRoleInfo[];
  coordinatorProfile: string | null;
  isBuiltin: boolean;
  createdAt: number;
}

export interface SwarmMember {
  id: string;
  swarmRunId: string;
  role: string;
  profileName: string;
  delegationId: string | null;
  status: string;
  result: string | null;
  seqOrder: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface SwarmRun {
  id: string;
  templateId: string;
  templateName: string;
  task: string;
  context: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  strategy: 'sequential' | 'parallel' | 'dynamic';
  result: string | null;
  error: string | null;
  tokenBudget: number;
  tokensUsedPrompt: number;
  tokensUsedCompletion: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  initiatedBy: string | null;
  members?: SwarmMember[];
}

export async function fetchSwarmTemplates(): Promise<{ templates: SwarmTemplate[] }> {
  try {
    return await request('/agents/swarms/templates');
  } catch {
    return { templates: [] };
  }
}

export async function createSwarmTemplate(data: {
  name: string;
  description?: string;
  strategy: string;
  roles: SwarmRoleInfo[];
  coordinatorProfile?: string | null;
}): Promise<{ template: SwarmTemplate }> {
  return request('/agents/swarms/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSwarmTemplate(
  id: string,
  data: {
    name?: string;
    description?: string;
    strategy?: string;
    roles?: SwarmRoleInfo[];
    coordinatorProfile?: string | null;
  }
): Promise<{ template: SwarmTemplate }> {
  return request(`/agents/swarms/templates/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteSwarmTemplate(id: string): Promise<{ success: boolean }> {
  return request(`/agents/swarms/templates/${id}`, { method: 'DELETE' });
}

export async function executeSwarm(data: {
  templateId: string;
  task: string;
  context?: string;
  tokenBudget?: number;
}): Promise<{ run: SwarmRun }> {
  return request('/agents/swarms', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchSwarmRuns(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ runs: SwarmRun[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset) query.set('offset', params.offset.toString());
  const qs = query.toString();
  try {
    return await request(`/agents/swarms${qs ? `?${qs}` : ''}`);
  } catch {
    return { runs: [], total: 0 };
  }
}

export async function fetchSwarmRun(id: string): Promise<{ run: SwarmRun } | null> {
  try {
    return await request(`/agents/swarms/${id}`);
  } catch {
    return null;
  }
}

export async function cancelSwarmRun(id: string): Promise<{ success: boolean }> {
  return request(`/agents/swarms/${id}/cancel`, { method: 'POST' });
}

// ─── Group Chat View (ADR 086) ─────────────────────────────────

export interface GroupChatChannel {
  integrationId: string;
  chatId: string;
  platform: string;
  integrationName: string;
  lastMessageAt: number | null;
  lastMessageText: string | null;
  messageCount: number;
  unrepliedCount: number;
  personalityId: string | null;
  personalityName: string | null;
}

export interface GroupChatMessage {
  id: string;
  integrationId: string;
  platform: string;
  direction: 'inbound' | 'outbound';
  senderId: string;
  senderName: string;
  chatId: string;
  text: string;
  attachments: unknown[];
  replyToMessageId?: string;
  platformMessageId?: string;
  metadata: Record<string, unknown>;
  timestamp: number;
  personalityId: string | null;
  personalityName: string | null;
}

export async function fetchGroupChatChannels(params?: {
  platform?: string;
  integrationId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ channels: GroupChatChannel[]; total: number }> {
  try {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.integrationId) qs.set('integrationId', params.integrationId);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return await request(`/group-chat/channels${query ? `?${query}` : ''}`);
  } catch {
    return { channels: [], total: 0 };
  }
}

export async function fetchGroupChatMessages(
  integrationId: string,
  chatId: string,
  params?: { limit?: number; offset?: number; before?: number }
): Promise<{ messages: GroupChatMessage[]; total: number }> {
  try {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.before) qs.set('before', String(params.before));
    const query = qs.toString();
    return await request(
      `/group-chat/channels/${encodeURIComponent(integrationId)}/${encodeURIComponent(chatId)}/messages${query ? `?${query}` : ''}`
    );
  } catch {
    return { messages: [], total: 0 };
  }
}

export async function sendGroupChatMessage(
  integrationId: string,
  chatId: string,
  text: string
): Promise<{ success: boolean; integrationId: string; chatId: string; text: string }> {
  return request(
    `/group-chat/channels/${encodeURIComponent(integrationId)}/${encodeURIComponent(chatId)}/messages`,
    { method: 'POST', body: JSON.stringify({ text }) }
  );
}

// ─── Routing Rules (ADR 087) ───────────────────────────────────

export interface RoutingRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  triggerPlatforms: string[];
  triggerIntegrationIds: string[];
  triggerChatIdPattern: string | null;
  triggerSenderIdPattern: string | null;
  triggerKeywordPattern: string | null;
  triggerDirection: 'inbound' | 'outbound' | 'both';
  actionType: 'forward' | 'reply' | 'personality' | 'notify';
  actionTargetIntegrationId: string | null;
  actionTargetChatId: string | null;
  actionPersonalityId: string | null;
  actionWebhookUrl: string | null;
  actionMessageTemplate: string | null;
  matchCount: number;
  lastMatchedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export async function fetchRoutingRules(params?: {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ rules: RoutingRule[]; total: number }> {
  try {
    const qs = new URLSearchParams();
    if (params?.enabled !== undefined) qs.set('enabled', String(params.enabled));
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return await request(`/routing-rules${query ? `?${query}` : ''}`);
  } catch {
    return { rules: [], total: 0 };
  }
}

export async function createRoutingRule(
  data: Omit<RoutingRule, 'id' | 'matchCount' | 'lastMatchedAt' | 'createdAt' | 'updatedAt'>
): Promise<RoutingRule> {
  return request('/routing-rules', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateRoutingRule(
  id: string,
  data: Partial<
    Omit<RoutingRule, 'id' | 'matchCount' | 'lastMatchedAt' | 'createdAt' | 'updatedAt'>
  >
): Promise<RoutingRule> {
  return request(`/routing-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteRoutingRule(id: string): Promise<void> {
  await request(`/routing-rules/${id}`, { method: 'DELETE' });
}

export async function testRoutingRule(
  id: string,
  params: {
    platform: string;
    integrationId?: string;
    chatId?: string;
    senderId?: string;
    text?: string;
    direction?: 'inbound' | 'outbound';
  }
): Promise<{ rule: RoutingRule; matched: boolean; reason?: string }> {
  return request(`/routing-rules/${id}/test`, { method: 'POST', body: JSON.stringify(params) });
}

// ── Workspaces ────────────────────────────────────────────────────────────

export interface WorkspaceMember {
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joinedAt: number;
  displayName?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description: string;
  members: WorkspaceMember[];
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export async function fetchWorkspaces(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ workspaces: Workspace[]; total: number }> {
  const q = params ? `?limit=${params.limit ?? 50}&offset=${params.offset ?? 0}` : '';
  return request(`/workspaces${q}`);
}

export async function createWorkspace(data: {
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
}): Promise<{ workspace: Workspace }> {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateWorkspace(
  id: string,
  data: { name?: string; description?: string; settings?: Record<string, unknown> }
): Promise<{ workspace: Workspace }> {
  return request(`/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await request(`/workspaces/${id}`, { method: 'DELETE' });
}

export async function fetchWorkspaceMembers(
  workspaceId: string,
  params?: { limit?: number; offset?: number }
): Promise<{ members: WorkspaceMember[]; total: number }> {
  const q = params ? `?limit=${params.limit ?? 50}&offset=${params.offset ?? 0}` : '';
  return request(`/workspaces/${workspaceId}/members${q}`);
}

export async function addWorkspaceMember(
  workspaceId: string,
  data: { userId: string; role?: string }
): Promise<{ member: WorkspaceMember }> {
  return request(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: string
): Promise<{ member: WorkspaceMember }> {
  return request(`/workspaces/${workspaceId}/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  await request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' });
}

// ─── Workflow Engine API ─────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  type: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  dependsOn: string[];
  onError: string;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
  fallbackStepId?: string;
  condition?: string;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowTrigger {
  type: string;
  config: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  triggers: WorkflowTrigger[];
  isEnabled: boolean;
  version: number;
  createdBy: string;
  autonomyLevel?: string;
  emergencyStopProcedure?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowStepRun {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  stepType: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
  triggeredBy: string;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
  stepRuns?: WorkflowStepRun[];
}

export async function fetchWorkflows(opts?: {
  limit?: number;
  offset?: number;
}): Promise<{ definitions: WorkflowDefinition[]; total: number }> {
  try {
    const query = new URLSearchParams();
    if (opts?.limit) query.set('limit', String(opts.limit));
    if (opts?.offset) query.set('offset', String(opts.offset));
    const qs = query.toString();
    return await request(`/workflows${qs ? `?${qs}` : ''}`);
  } catch {
    return { definitions: [], total: 0 };
  }
}

export async function fetchWorkflow(id: string): Promise<{ definition: WorkflowDefinition }> {
  return request(`/workflows/${id}`);
}

export async function createWorkflow(
  data: Partial<WorkflowDefinition>
): Promise<{ definition: WorkflowDefinition }> {
  return request('/workflows', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateWorkflow(
  id: string,
  data: Partial<WorkflowDefinition>
): Promise<{ definition: WorkflowDefinition }> {
  return request(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteWorkflow(id: string): Promise<void> {
  await request(`/workflows/${id}`, { method: 'DELETE' });
}

export async function triggerWorkflow(
  id: string,
  input?: Record<string, unknown>
): Promise<{ run: WorkflowRun }> {
  return request(`/workflows/${id}/run`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export async function fetchWorkflowRuns(
  workflowId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ runs: WorkflowRun[]; total: number }> {
  try {
    const query = new URLSearchParams();
    if (opts?.limit) query.set('limit', String(opts.limit));
    if (opts?.offset) query.set('offset', String(opts.offset));
    const qs = query.toString();
    return await request(`/workflows/${workflowId}/runs${qs ? `?${qs}` : ''}`);
  } catch {
    return { runs: [], total: 0 };
  }
}

export async function fetchWorkflowRun(
  runId: string
): Promise<{ run: WorkflowRun & { stepRuns: WorkflowStepRun[] } }> {
  return request(`/workflows/runs/${runId}`);
}

export async function cancelWorkflowRun(runId: string): Promise<{ run: WorkflowRun }> {
  return request(`/workflows/runs/${runId}`, { method: 'DELETE' });
}

// ── Soul Pending Approvals ────────────────────────────────────────────────────

export interface SoulApproval {
  id: string;
  personalityId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export async function fetchSoulApprovals(opts?: {
  personalityId?: string;
  status?: 'pending' | 'approved' | 'rejected';
  limit?: number;
  offset?: number;
}): Promise<{ approvals: SoulApproval[]; total: number }> {
  try {
    const q = new URLSearchParams();
    if (opts?.personalityId) q.set('personalityId', opts.personalityId);
    if (opts?.status) q.set('status', opts.status);
    if (opts?.limit) q.set('limit', String(opts.limit));
    if (opts?.offset) q.set('offset', String(opts.offset));
    const qs = q.toString();
    return await request(`/soul/approvals${qs ? `?${qs}` : ''}`);
  } catch {
    return { approvals: [], total: 0 };
  }
}

export async function fetchSoulApprovalCount(personalityId?: string): Promise<number> {
  try {
    const q = personalityId ? `?personalityId=${encodeURIComponent(personalityId)}` : '';
    const res = await request<{ count: number }>(`/soul/approvals/count${q}`);
    return res.count;
  } catch {
    return 0;
  }
}

export async function approveSoulAction(approvalId: string): Promise<{ approval: SoulApproval }> {
  return request(`/soul/approvals/${approvalId}/approve`, { method: 'POST' });
}

export async function rejectSoulAction(approvalId: string): Promise<{ approval: SoulApproval }> {
  return request(`/soul/approvals/${approvalId}/reject`, { method: 'POST' });
}

// ── Phase 41: Secrets Management ─────────────────────────────────────────────

export async function fetchSecretKeys(): Promise<{ keys: string[] }> {
  return request('/secrets');
}

export async function checkSecret(name: string): Promise<{ name: string; exists: boolean }> {
  return request(`/secrets/${encodeURIComponent(name)}`);
}

export async function setSecret(name: string, value: string): Promise<void> {
  return request(`/secrets/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export async function deleteSecret(name: string): Promise<void> {
  return request(`/secrets/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── Phase 42: TLS Certificate Status ─────────────────────────────────────────

export interface TlsCertStatus {
  enabled: boolean;
  autoGenerated: boolean;
  certPath: string | null;
  keyPath: string | null;
  caPath: string | null;
  expiresAt: number | null;
  daysUntilExpiry: number | null;
  expired: boolean;
  expiryWarning: boolean;
}

export async function fetchTlsStatus(): Promise<TlsCertStatus> {
  return request('/security/tls');
}

export async function generateTlsCert(): Promise<{ generated: boolean; paths: unknown }> {
  return request('/security/tls/generate', { method: 'POST' });
}

// ─── Organizational Intent API (Phase 48) ──────────────────────────────────

export interface OrgIntentMeta {
  id: string;
  name: string;
  apiVersion: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface OrgIntentGoal {
  id: string;
  name: string;
  description: string;
  priority: number;
  activeWhen?: string;
  successCriteria: string;
  completionCondition?: string;
  ownerRole: string;
  skills: string[];
  signals: string[];
  authorizedActions: string[];
}

export interface OrgIntentSignal {
  id: string;
  name: string;
  description: string;
  direction: 'above' | 'below';
  threshold: number;
  warningThreshold?: number;
  dataSources: string[];
}

export interface OrgIntentDataSource {
  id: string;
  name: string;
  type: 'http' | 'mcp_tool' | 'postgres' | 'prometheus' | 'custom';
  connection: string;
  authSecret?: string;
  schema?: string;
}

export interface OrgIntentAuthorizedAction {
  id: string;
  description: string;
  appliesToGoals: string[];
  appliesToSignals: string[];
  requiredRole?: string;
  conditions?: string;
  mcpTools: string[];
}

export interface OrgIntentTradeoffProfile {
  id: string;
  name: string;
  speedVsThoroughness: number;
  costVsQuality: number;
  autonomyVsConfirmation: number;
  notes?: string;
  isDefault: boolean;
}

export interface OrgIntentHardBoundary {
  id: string;
  rule: string;
  rego?: string;
  rationale: string;
}

export interface OrgIntentPolicy {
  id: string;
  rule: string;
  rego?: string;
  enforcement: 'warn' | 'block';
  rationale: string;
}

export interface OrgIntentDelegationTenant {
  id: string;
  principle: string;
  decisionBoundaries: string[];
}

export interface OrgIntentDoc extends OrgIntentMeta {
  goals: OrgIntentGoal[];
  signals: OrgIntentSignal[];
  dataSources: OrgIntentDataSource[];
  authorizedActions: OrgIntentAuthorizedAction[];
  tradeoffProfiles: OrgIntentTradeoffProfile[];
  hardBoundaries: OrgIntentHardBoundary[];
  policies: OrgIntentPolicy[];
  delegationFramework: { tenants: OrgIntentDelegationTenant[] };
  context: { key: string; value: string }[];
}

export interface SignalReadResult {
  signalId: string;
  value: number | null;
  threshold: number;
  direction: 'above' | 'below';
  status: 'healthy' | 'warning' | 'critical';
  message: string;
}

export interface EnforcementLogEntry {
  id: string;
  eventType: string;
  itemId?: string;
  rule: string;
  rationale?: string;
  actionAttempted?: string;
  agentId?: string;
  sessionId?: string;
  personalityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export async function fetchIntents(): Promise<{ intents: OrgIntentMeta[] }> {
  return request('/intent');
}

export async function fetchActiveIntent(): Promise<{ intent: OrgIntentDoc }> {
  return request('/intent/active');
}

export async function fetchIntent(id: string): Promise<{ intent: OrgIntentDoc }> {
  return request(`/intent/${encodeURIComponent(id)}`);
}

export async function createIntent(
  doc: Record<string, unknown>
): Promise<{ intent: OrgIntentDoc }> {
  return request('/intent', { method: 'POST', body: JSON.stringify(doc) });
}

export async function updateIntent(
  id: string,
  patch: Record<string, unknown>
): Promise<{ intent: OrgIntentDoc }> {
  return request(`/intent/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteIntent(id: string): Promise<void> {
  return request(`/intent/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function activateIntent(id: string): Promise<{ success: boolean }> {
  return request(`/intent/${encodeURIComponent(id)}/activate`, { method: 'POST' });
}

export async function fetchEnforcementLog(opts?: {
  eventType?: string;
  agentId?: string;
  since?: number;
  limit?: number;
}): Promise<{ entries: EnforcementLogEntry[] }> {
  const params = new URLSearchParams();
  if (opts?.eventType) params.set('eventType', opts.eventType);
  if (opts?.agentId) params.set('agentId', opts.agentId);
  if (opts?.since) params.set('since', String(opts.since));
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return request(`/intent/enforcement-log${qs ? `?${qs}` : ''}`);
}

export async function readSignal(signalId: string): Promise<SignalReadResult> {
  return request(`/intent/signals/${encodeURIComponent(signalId)}/value`);
}

export async function fetchGoalTimeline(
  intentId: string,
  goalId: string
): Promise<{ entries: EnforcementLogEntry[] }> {
  return request(
    `/intent/${encodeURIComponent(intentId)}/goals/${encodeURIComponent(goalId)}/timeline`
  );
}

// ─── Autonomy Audit API (Phase 49) ──────────────────────────────────────────

export async function fetchAutonomyOverview(): Promise<AutonomyOverview> {
  const res = await request<{ overview: AutonomyOverview }>('/autonomy/overview');
  return res.overview;
}

export async function fetchAuditRuns(): Promise<AuditRun[]> {
  const res = await request<{ runs: AuditRun[] }>('/autonomy/audits');
  return res.runs;
}

export async function createAuditRun(name: string): Promise<AuditRun> {
  const res = await request<{ run: AuditRun }>('/autonomy/audits', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return res.run;
}

export async function fetchAuditRun(id: string): Promise<AuditRun> {
  const res = await request<{ run: AuditRun }>(`/autonomy/audits/${encodeURIComponent(id)}`);
  return res.run;
}

export async function updateAuditItem(
  runId: string,
  itemId: string,
  update: { status: AuditItemStatus; note: string }
): Promise<AuditRun> {
  const res = await request<{ run: AuditRun }>(
    `/autonomy/audits/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'PUT', body: JSON.stringify(update) }
  );
  return res.run;
}

export async function finalizeAuditRun(id: string): Promise<AuditRun> {
  const res = await request<{ run: AuditRun }>(
    `/autonomy/audits/${encodeURIComponent(id)}/finalize`,
    { method: 'POST' }
  );
  return res.run;
}

export async function emergencyStop(type: 'skill' | 'workflow', id: string): Promise<void> {
  await request(`/autonomy/emergency-stop/${type}/${encodeURIComponent(id)}`, { method: 'POST' });
}

// ─── Notifications API (Phase 51) ────────────────────────────────────────────

export interface FetchNotificationsOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface FetchNotificationsResult {
  notifications: ServerNotification[];
  total: number;
  unreadCount: number;
}

export async function fetchNotifications(
  opts: FetchNotificationsOptions = {}
): Promise<FetchNotificationsResult> {
  const params = new URLSearchParams();
  if (opts.unreadOnly) params.set('unreadOnly', 'true');
  if (opts.limit != null) params.set('limit', String(opts.limit));
  if (opts.offset != null) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return request<FetchNotificationsResult>(`/notifications${qs ? `?${qs}` : ''}`);
}

export async function fetchNotificationCount(): Promise<{ unreadCount: number }> {
  return request<{ unreadCount: number }>('/notifications/count');
}

export async function markNotificationRead(id: string): Promise<void> {
  await request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return request<{ updated: number }>('/notifications/read-all', { method: 'POST' });
}

export async function deleteNotification(id: string): Promise<void> {
  await request(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── User Notification Prefs API (Phase 55) ────────────────────────────────

export async function fetchNotificationPrefs(): Promise<{ prefs: UserNotificationPref[] }> {
  return request<{ prefs: UserNotificationPref[] }>('/users/me/notification-prefs');
}

export interface CreateNotificationPrefBody {
  channel: 'slack' | 'telegram' | 'discord' | 'email';
  chatId: string;
  integrationId?: string | null;
  enabled?: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  minLevel?: 'info' | 'warn' | 'error' | 'critical';
}

export async function createNotificationPref(
  body: CreateNotificationPrefBody
): Promise<{ pref: UserNotificationPref }> {
  return request<{ pref: UserNotificationPref }>('/users/me/notification-prefs', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateNotificationPref(
  id: string,
  patch: Partial<CreateNotificationPrefBody>
): Promise<{ pref: UserNotificationPref }> {
  return request<{ pref: UserNotificationPref }>(
    `/users/me/notification-prefs/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(patch),
    }
  );
}

export async function deleteNotificationPref(id: string): Promise<void> {
  await request(`/users/me/notification-prefs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Risk Assessment API (Phase 53) ────────────────────────────────────────

export async function runRiskAssessment(
  opts: CreateRiskAssessmentOptions
): Promise<RiskAssessment> {
  const res = await request<{ assessment: RiskAssessment }>('/risk/assessments', {
    method: 'POST',
    body: JSON.stringify(opts),
  });
  return res.assessment;
}

export async function fetchRiskAssessments(params?: {
  limit?: number;
  offset?: number;
  status?: string;
}): Promise<{ items: RiskAssessment[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  if (params?.status) q.set('status', params.status);
  const qs = q.toString();
  return request<{ items: RiskAssessment[]; total: number }>(
    `/risk/assessments${qs ? `?${qs}` : ''}`
  );
}

export async function fetchRiskAssessment(id: string): Promise<RiskAssessment> {
  const res = await request<{ assessment: RiskAssessment }>(
    `/risk/assessments/${encodeURIComponent(id)}`
  );
  return res.assessment;
}

export async function downloadRiskReport(id: string, format: string): Promise<string> {
  const url = `/api/v1/risk/assessments/${encodeURIComponent(id)}/report/${encodeURIComponent(format)}`;
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to download report: ${response.status}`);
  }
  return response.text();
}

export async function fetchRiskFeeds(): Promise<ExternalFeed[]> {
  const res = await request<{ feeds: ExternalFeed[] }>('/risk/feeds');
  return res.feeds;
}

export async function createRiskFeed(data: CreateExternalFeedOptions): Promise<ExternalFeed> {
  const res = await request<{ feed: ExternalFeed }>('/risk/feeds', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.feed;
}

export async function deleteRiskFeed(id: string): Promise<void> {
  await request(`/risk/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function ingestRiskFindings(
  feedId: string,
  findings: unknown[]
): Promise<{ created: number; skipped: number }> {
  return request<{ created: number; skipped: number }>(
    `/risk/feeds/${encodeURIComponent(feedId)}/ingest`,
    { method: 'POST', body: JSON.stringify(findings) }
  );
}

export async function fetchRiskFindings(params?: {
  feedId?: string;
  status?: string;
  severity?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ExternalFinding[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.feedId) q.set('feedId', params.feedId);
  if (params?.status) q.set('status', params.status);
  if (params?.severity) q.set('severity', params.severity);
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const qs = q.toString();
  return request<{ items: ExternalFinding[]; total: number }>(
    `/risk/findings${qs ? `?${qs}` : ''}`
  );
}

export async function createRiskFinding(
  data: CreateExternalFindingOptions
): Promise<ExternalFinding> {
  const res = await request<{ finding: ExternalFinding }>('/risk/findings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.finding;
}

export async function acknowledgeRiskFinding(id: string): Promise<ExternalFinding> {
  const res = await request<{ finding: ExternalFinding }>(
    `/risk/findings/${encodeURIComponent(id)}/acknowledge`,
    { method: 'PATCH' }
  );
  return res.finding;
}

export async function resolveRiskFinding(id: string): Promise<ExternalFinding> {
  const res = await request<{ finding: ExternalFinding }>(
    `/risk/findings/${encodeURIComponent(id)}/resolve`,
    { method: 'PATCH' }
  );
  return res.finding;
}

// ── Departmental Risk Register (Phase 111) ─────────────────────────

export async function fetchDepartments(params?: {
  parentId?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ items: Department[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.parentId !== undefined)
    q.set('parentId', params.parentId === null ? 'null' : params.parentId);
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const qs = q.toString();
  return request<{ items: Department[]; total: number }>(`/risk/departments${qs ? `?${qs}` : ''}`);
}

export async function createDepartment(data: {
  name: string;
  description?: string;
  mission?: string;
  parentId?: string;
}): Promise<Department> {
  const res = await request<{ department: Department }>('/risk/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.department;
}

export async function updateDepartment(
  id: string,
  data: Record<string, unknown>
): Promise<Department> {
  const res = await request<{ department: Department }>(
    `/risk/departments/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    }
  );
  return res.department;
}

export async function deleteDepartment(id: string, force = false): Promise<void> {
  await request(`/risk/departments/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, {
    method: 'DELETE',
  });
}

export async function fetchDepartmentScorecard(
  id: string
): Promise<{ scorecard: DepartmentScorecard }> {
  return request<{ scorecard: DepartmentScorecard }>(
    `/risk/departments/${encodeURIComponent(id)}/scorecard`
  );
}

export async function fetchRegisterEntries(params?: {
  departmentId?: string;
  status?: string;
  category?: string;
  severity?: string;
  overdue?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: RegisterEntry[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.departmentId) q.set('departmentId', params.departmentId);
  if (params?.status) q.set('status', params.status);
  if (params?.category) q.set('category', params.category);
  if (params?.severity) q.set('severity', params.severity);
  if (params?.overdue) q.set('overdue', 'true');
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const qs = q.toString();
  return request<{ items: RegisterEntry[]; total: number }>(`/risk/register${qs ? `?${qs}` : ''}`);
}

export async function createRegisterEntry(data: {
  departmentId: string;
  title: string;
  category: string;
  severity: string;
  likelihood: number;
  impact: number;
  description?: string;
  owner?: string;
}): Promise<RegisterEntry> {
  const res = await request<{ entry: RegisterEntry }>('/risk/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.entry;
}

export async function fetchHeatmap(): Promise<{ cells: RiskHeatmapCell[] }> {
  return request<{ cells: RiskHeatmapCell[] }>('/risk/heatmap');
}

export async function fetchRiskTrend(
  departmentId: string,
  days = 30
): Promise<{ points: RiskTrendPoint[] }> {
  return request<{ points: RiskTrendPoint[] }>(
    `/risk/departments/${encodeURIComponent(departmentId)}/trend?days=${days}`
  );
}

export async function fetchRiskSummary(): Promise<{ summary: AthiExecutiveSummary }> {
  return request<{ summary: AthiExecutiveSummary }>('/risk/summary');
}

// Phase 111-D: Report endpoints
export async function fetchDepartmentReport(
  departmentId: string,
  format = 'json'
): Promise<string> {
  return request<string>(
    `/risk/reports/department/${encodeURIComponent(departmentId)}?format=${format}`
  );
}

export async function fetchExecutiveReport(format = 'json'): Promise<string> {
  return request<string>(`/risk/reports/executive?format=${format}`);
}

export async function fetchRegisterReport(
  params: {
    format?: string;
    departmentId?: string;
    status?: string;
    category?: string;
  } = {}
): Promise<string> {
  const qs = new URLSearchParams();
  if (params.format) qs.set('format', params.format);
  if (params.departmentId) qs.set('departmentId', params.departmentId);
  if (params.status) qs.set('status', params.status);
  if (params.category) qs.set('category', params.category);
  return request<string>(`/risk/reports/register?${qs.toString()}`);
}

// Phase 111-F: Additional register/department endpoints
export async function updateRegisterEntry(
  id: string,
  data: Record<string, unknown>
): Promise<RegisterEntry> {
  return request<RegisterEntry>(`/risk/register/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteRegisterEntry(id: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/risk/register/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function snapshotDepartment(id: string): Promise<{ score: DepartmentScore }> {
  return request<{ score: DepartmentScore }>(
    `/risk/departments/${encodeURIComponent(id)}/snapshot`,
    { method: 'POST' }
  );
}

// ── Tenants ────────────────────────────────────────────────────────

export async function fetchTenants(
  opts: { limit?: number; offset?: number } = {}
): Promise<{ tenants: TenantRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return request(`/admin/tenants${qs ? `?${qs}` : ''}`);
}

export async function createTenant(data: {
  name: string;
  slug: string;
  plan?: string;
}): Promise<{ tenant: TenantRecord }> {
  return request('/admin/tenants', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateTenant(
  id: string,
  data: Partial<{ name: string; plan: string; metadata: Record<string, unknown> }>
): Promise<{ tenant: TenantRecord }> {
  return request(`/admin/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteTenant(id: string): Promise<void> {
  await request(`/admin/tenants/${id}`, { method: 'DELETE' });
}

// ── Backup & DR ────────────────────────────────────────────────────────────

export async function fetchBackups(
  opts: { limit?: number; offset?: number } = {}
): Promise<{ backups: BackupRecord[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return request(`/admin/backups${qs ? `?${qs}` : ''}`);
}

export async function createBackup(label: string): Promise<{ backup: BackupRecord }> {
  return request('/admin/backups', { method: 'POST', body: JSON.stringify({ label }) });
}

export async function downloadBackup(id: string): Promise<Blob> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/admin/backups/${id}/download`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new APIError('Download failed', res.status);
  return res.blob();
}

export async function restoreBackup(id: string): Promise<{ message: string }> {
  return request(`/admin/backups/${id}/restore`, {
    method: 'POST',
    body: JSON.stringify({ confirm: 'RESTORE' }),
  });
}

export async function deleteBackup(id: string): Promise<void> {
  await request(`/admin/backups/${id}`, { method: 'DELETE' });
}

// ─── Federation API (Phase 79) ────────────────────────────────────────

export async function fetchFederationPeers(): Promise<{ peers: FederationPeer[] }> {
  return request('/federation/peers');
}

export async function addFederationPeer(data: {
  url: string;
  name: string;
  sharedSecret: string;
}): Promise<{ peer: FederationPeer }> {
  return request('/federation/peers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function removeFederationPeer(id: string): Promise<void> {
  await request(`/federation/peers/${id}`, { method: 'DELETE' });
}

export async function updateFederationPeerFeatures(
  id: string,
  features: Partial<{ knowledge: boolean; marketplace: boolean; personalities: boolean }>
): Promise<void> {
  await request(`/federation/peers/${id}/features`, {
    method: 'PUT',
    body: JSON.stringify(features),
  });
}

export async function checkFederationPeerHealth(id: string): Promise<{ status: string }> {
  return request(`/federation/peers/${id}/health`, { method: 'POST' });
}

export async function fetchPeerMarketplace(
  peerId: string,
  query?: string
): Promise<{ skills: unknown[] }> {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '';
  return request(`/federation/peers/${peerId}/marketplace${qs}`);
}

export async function installSkillFromPeer(
  peerId: string,
  skillId: string,
  personalityId?: string
): Promise<void> {
  await request(`/federation/peers/${peerId}/marketplace/${skillId}/install`, {
    method: 'POST',
    body: JSON.stringify({ personalityId }),
  });
}

export async function exportPersonalityBundle(
  personalityId: string,
  passphrase: string
): Promise<Blob> {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/federation/personalities/${personalityId}/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ passphrase }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new APIError(`Export failed: ${res.status}`, res.status);
  return res.blob();
}

export async function importPersonalityBundle(
  bundleBase64: string,
  passphrase: string,
  nameOverride?: string
): Promise<{ personality: unknown }> {
  return request('/federation/personalities/import', {
    method: 'POST',
    body: JSON.stringify({ bundle: bundleBase64, passphrase, nameOverride }),
  });
}

// ─── Gateway Analytics API (Phase 80) ───────────────────────────────

export async function fetchApiKeyUsage(
  id: string,
  from?: number,
  to?: number
): Promise<{ usage: ApiKeyUsageRow[] }> {
  const params = new URLSearchParams();
  if (from !== undefined) params.set('from', String(from));
  if (to !== undefined) params.set('to', String(to));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/auth/api-keys/${id}/usage${qs}`);
}

export async function fetchApiKeyUsageSummary(): Promise<{ summary: ApiKeyUsageSummary[] }> {
  return request('/auth/api-keys/usage/summary');
}

// ─── Knowledge Base API (Phase 82) ───────────────────────────────────────────

export async function uploadDocument(
  file: File,
  opts?: { personalityId?: string; visibility?: string; title?: string; scope?: string }
): Promise<{ document: KbDocument }> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (opts?.personalityId) formData.append('personalityId', opts.personalityId);
  if (opts?.visibility) formData.append('visibility', opts.visibility);
  if (opts?.title) formData.append('title', opts.title);
  if (opts?.scope) formData.append('scope', opts.scope);

  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/brain/documents/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new APIError(body.message ?? `Upload failed: ${res.status}`, res.status);
  }
  return res.json();
}

export async function ingestUrl(
  url: string,
  opts?: { personalityId?: string; visibility?: string; scope?: string }
): Promise<{ document: KbDocument }> {
  return request('/brain/documents/ingest-url', {
    method: 'POST',
    body: JSON.stringify({ url, ...opts }),
  });
}

export async function ingestText(
  text: string,
  title: string,
  opts?: { personalityId?: string; visibility?: string; scope?: string }
): Promise<{ document: KbDocument }> {
  return request('/brain/documents/ingest-text', {
    method: 'POST',
    body: JSON.stringify({ text, title, ...opts }),
  });
}

export async function ingestGithubWiki(
  owner: string,
  repo: string,
  personalityId?: string,
  scope?: string
): Promise<{ documents: KbDocument[] }> {
  return request('/brain/documents/connectors/github-wiki', {
    method: 'POST',
    body: JSON.stringify({ owner, repo, personalityId, scope }),
  });
}

export async function syncMnemeKnowledge(opts?: {
  mnemeUrl?: string;
  personalityId?: string;
  visibility?: string;
  query?: string;
}): Promise<{ documents: KbDocument[]; count: number }> {
  return request('/brain/documents/connectors/mneme-sync', {
    method: 'POST',
    body: JSON.stringify({
      mnemeUrl: opts?.mnemeUrl,
      personalityId: opts?.personalityId,
      visibility: opts?.visibility,
      query: opts?.query,
    }),
  });
}

export async function listDocuments(opts?: {
  personalityId?: string;
  visibility?: string;
  scope?: string;
}): Promise<{ documents: KbDocument[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.personalityId) params.set('personalityId', opts.personalityId);
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.scope) params.set('scope', opts.scope);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/brain/documents${qs}`);
}

export async function deleteDocument(id: string): Promise<void> {
  await request(`/brain/documents/${id}`, { method: 'DELETE' });
}

export async function fetchKnowledgeHealth(personalityId?: string): Promise<KnowledgeHealthStats> {
  const qs = personalityId ? `?personalityId=${encodeURIComponent(personalityId)}` : '';
  return request(`/brain/knowledge-health${qs}`);
}

// ─── Alert Rules (Phase 83) ────────────────────────────────────────────────

export async function listAlertRules(): Promise<{ rules: AlertRule[] }> {
  return request('/alerts/rules');
}

export async function createAlertRule(
  data: Omit<AlertRule, 'id' | 'lastFiredAt' | 'createdAt' | 'updatedAt'>
): Promise<{ rule: AlertRule }> {
  return request('/alerts/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function patchAlertRule(
  id: string,
  patch: Partial<AlertRule>
): Promise<{ rule: AlertRule }> {
  return request(`/alerts/rules/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteAlertRule(id: string): Promise<void> {
  await request(`/alerts/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function testAlertRule(id: string): Promise<{ fired: boolean; value: number | null }> {
  return request(`/alerts/rules/${encodeURIComponent(id)}/test`, { method: 'POST' });
}

// ─── Shareables — Workflow export/import (Phase 89) ───────────────────────────

export async function exportWorkflow(id: string): Promise<WorkflowExport> {
  return request(`/workflows/${encodeURIComponent(id)}/export`);
}

export async function importWorkflow(
  payload: WorkflowExport
): Promise<{ definition: WorkflowDefinition; compatibility: CompatibilityCheckResult }> {
  return request('/workflows/import', {
    method: 'POST',
    body: JSON.stringify({ workflow: payload }),
  });
}

export async function fetchCommunityWorkflows(
  source?: string
): Promise<{ definitions: WorkflowDefinition[]; total: number }> {
  const qs = source ? `?source=${encodeURIComponent(source)}` : '';
  return request(`/workflows${qs}`);
}

// ─── Shareables — Swarm template export/import (Phase 89) ───────────────────

export async function exportSwarmTemplate(id: string): Promise<SwarmTemplateExport> {
  return request(`/agents/swarms/templates/${encodeURIComponent(id)}/export`);
}

export async function importSwarmTemplate(
  payload: SwarmTemplateExport
): Promise<{ template: unknown; compatibility: CompatibilityCheckResult }> {
  return request('/agents/swarms/templates/import', {
    method: 'POST',
    body: JSON.stringify({ template: payload }),
  });
}

export async function fetchCommunitySwarmTemplates(): Promise<{
  templates: unknown[];
  total: number;
}> {
  return request('/agents/swarms/templates');
}

// ─── Profile Skills (Phase 89) ───────────────────────────────────────────────

export async function fetchProfileSkills(profileId: string): Promise<{ skills: CatalogSkill[] }> {
  return request(`/agents/profiles/${encodeURIComponent(profileId)}/skills`);
}

export async function addProfileSkill(profileId: string, skillId: string): Promise<void> {
  await request(`/agents/profiles/${encodeURIComponent(profileId)}/skills`, {
    method: 'POST',
    body: JSON.stringify({ skillId }),
  });
}

export async function removeProfileSkill(profileId: string, skillId: string): Promise<void> {
  await request(
    `/agents/profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
    {
      method: 'DELETE',
    }
  );
}

// ─── Canvas Workspace API ────────────────────────────────────────

export interface TechStackResponse {
  stacks: string[];
  allowedCommands: string[];
}

export async function fetchTechStack(cwd?: string): Promise<TechStackResponse> {
  const qs = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  return request(`/terminal/tech-stack${qs}`);
}

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
  createdAt: string;
}

export async function listWorktrees(): Promise<{ worktrees: WorktreeInfo[] }> {
  return request('/terminal/worktrees');
}

export async function createWorktree(name?: string): Promise<WorktreeInfo> {
  return request('/terminal/worktrees', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteWorktree(id: string): Promise<void> {
  return request(`/terminal/worktrees/${id}`, { method: 'DELETE' });
}

// ── License ───────────────────────────────────────────────────────────────────

export interface LicenseStatus {
  tier: 'community' | 'pro' | 'enterprise';
  valid: boolean;
  organization: string | null;
  seats: number | null;
  features: string[];
  licenseId: string | null;
  expiresAt: string | null;
  error: string | null;
  enforcementEnabled: boolean;
  gracePeriod: {
    active: boolean;
    daysRemaining: number;
    expiresAt: string;
  } | null;
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
  return request('/license/status');
}

export async function setLicenseKey(key: string): Promise<LicenseStatus> {
  return request('/license/key', {
    method: 'POST',
    body: JSON.stringify({ key }),
  });
}

// ── Conversation Analytics (Phase 96) ─────────────────────────────────────────

export interface SentimentTrendPoint {
  date: string;
  positive: number;
  neutral: number;
  negative: number;
  avgScore: number;
}

export interface EngagementMetrics {
  personalityId: string | null;
  periodDays: number;
  avgConversationLength: number;
  followUpRate: number;
  abandonmentRate: number;
  toolCallSuccessRate: number;
  totalConversations: number;
}

export interface KeyPhraseItem {
  id: string;
  personalityId: string;
  phrase: string;
  frequency: number;
  windowStart: string;
  windowEnd: string;
  updatedAt: string;
}

export interface EntityItem {
  id: string;
  conversationId: string;
  personalityId: string | null;
  entityType: string;
  entityValue: string;
  mentionCount: number;
  firstSeenAt: string;
}

export interface TopEntityItem {
  entityType: string;
  entityValue: string;
  totalMentions: number;
  conversationCount: number;
}

export interface UsageAnomalyItem {
  id: string;
  anomalyType: string;
  personalityId: string | null;
  userId: string | null;
  severity: string;
  details: Record<string, unknown>;
  detectedAt: string;
}

export async function fetchSentimentTrend(
  personalityId: string,
  days = 30
): Promise<SentimentTrendPoint[]> {
  const { trend } = await request<{ trend: SentimentTrendPoint[] }>(
    `/analytics/sentiment/trend/${encodeURIComponent(personalityId)}?days=${days}`
  );
  return trend;
}

export async function fetchEngagementMetrics(
  personalityId?: string,
  periodDays = 30
): Promise<EngagementMetrics> {
  if (personalityId) {
    return request(
      `/analytics/engagement/${encodeURIComponent(personalityId)}?periodDays=${periodDays}`
    );
  }
  return request(`/analytics/engagement?periodDays=${periodDays}`);
}

export async function fetchKeyPhrases(personalityId: string, limit = 50): Promise<KeyPhraseItem[]> {
  const { phrases } = await request<{ phrases: KeyPhraseItem[] }>(
    `/analytics/phrases/${encodeURIComponent(personalityId)}?limit=${limit}`
  );
  return phrases;
}

export async function fetchTopEntities(
  personalityId: string,
  limit = 20
): Promise<TopEntityItem[]> {
  const { entities } = await request<{ entities: TopEntityItem[] }>(
    `/analytics/entities/top/${encodeURIComponent(personalityId)}?limit=${limit}`
  );
  return entities;
}

export async function searchEntities(
  entity: string,
  entityType = 'concept'
): Promise<{ conversationId: string; title: string | null; mentionCount: number }[]> {
  const qs = new URLSearchParams({ entity, entityType }).toString();
  const { results } = await request<{
    results: { conversationId: string; title: string | null; mentionCount: number }[];
  }>(`/analytics/entities?${qs}`);
  return results;
}

export async function fetchAnomalies(opts?: {
  limit?: number;
  anomalyType?: string;
}): Promise<{ anomalies: UsageAnomalyItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (opts?.limit) qs.set('limit', String(opts.limit));
  if (opts?.anomalyType) qs.set('anomalyType', opts.anomalyType);
  const q = qs.toString();
  return request(`/analytics/anomalies${q ? `?${q}` : ''}`);
}

export async function triggerSummarize(): Promise<{ summarized: number }> {
  return request('/analytics/summarize', { method: 'POST' });
}

// ── Phase 98: Lifecycle Platform ────────────────────────────────────────────

// Preference Pairs
export interface PreferencePairItem {
  id: string;
  prompt: string;
  chosen: string;
  rejected: string;
  source: 'annotation' | 'comparison' | 'multi_turn';
  conversationId?: string | null;
  personalityId?: string | null;
  annotatorId?: string | null;
  createdAt: string;
}

export async function fetchPreferencePairs(opts?: {
  personalityId?: string;
  source?: string;
  limit?: number;
}): Promise<{ pairs: PreferencePairItem[] }> {
  const qs = new URLSearchParams();
  if (opts?.personalityId) qs.set('personalityId', opts.personalityId);
  if (opts?.source) qs.set('source', opts.source);
  if (opts?.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return request(`/training/preferences${q ? `?${q}` : ''}`);
}

export async function createPreferencePair(data: {
  prompt: string;
  chosen: string;
  rejected: string;
  source: string;
  personalityId?: string;
  annotatorId?: string;
}): Promise<PreferencePairItem> {
  return request('/training/preferences', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deletePreferencePair(id: string): Promise<void> {
  return request(`/training/preferences/${id}`, { method: 'DELETE' });
}

export async function exportPreferencesAsDpo(opts?: {
  personalityId?: string;
  source?: string;
}): Promise<Response> {
  const token = getAccessToken();
  const url = `${API_BASE}/training/preferences/export`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(opts ?? {}),
  });
}

export async function rateSideBySide(data: {
  prompt: string;
  responseA: string;
  responseB: string;
  winner: 'a' | 'b';
  personalityId?: string;
  annotatorId?: string;
}): Promise<PreferencePairItem> {
  return request('/training/side-by-side/rate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Curated Datasets
export interface CuratedDatasetItem {
  id: string;
  name: string;
  personalityId?: string | null;
  rules: Record<string, unknown>;
  datasetHash: string;
  sampleCount: number;
  totalTokens: number;
  status: 'preview' | 'committed' | 'archived';
  path?: string | null;
  createdAt: string;
}

export async function previewCuratedDataset(
  rules: Record<string, unknown>
): Promise<{ sampleCount: number; totalTokens: number }> {
  return request('/training/curated-datasets/preview', {
    method: 'POST',
    body: JSON.stringify(rules),
  });
}

export async function createCuratedDataset(data: {
  name: string;
  personalityId?: string;
  rules: Record<string, unknown>;
  outputDir: string;
}): Promise<CuratedDatasetItem> {
  return request('/training/curated-datasets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchCuratedDatasets(opts?: {
  status?: string;
}): Promise<{ datasets: CuratedDatasetItem[] }> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request(`/training/curated-datasets${q ? `?${q}` : ''}`);
}

export async function deleteCuratedDataset(id: string): Promise<void> {
  return request(`/training/curated-datasets/${id}`, { method: 'DELETE' });
}

// Experiments
export interface TrainingExperimentItem {
  id: string;
  name: string;
  finetuneJobId?: string | null;
  datasetHash?: string | null;
  hyperparameters: Record<string, unknown>;
  environment: Record<string, unknown>;
  lossCurve: { step: number; loss: number }[];
  evalRunId?: string | null;
  evalMetrics: Record<string, number>;
  status: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExperimentDiffItem {
  hyperparamDiffs: Record<string, { a: unknown; b: unknown }>;
  metricDiffs: Record<string, { a: number | null; b: number | null }>;
  lossCurveA: { step: number; loss: number }[];
  lossCurveB: { step: number; loss: number }[];
}

export async function fetchTrainingExperiments(opts?: {
  status?: string;
}): Promise<{ experiments: TrainingExperimentItem[] }> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request(`/training/experiments${q ? `?${q}` : ''}`);
}

export async function createTrainingExperiment(data: {
  name: string;
  finetuneJobId?: string;
  datasetHash?: string;
  hyperparameters?: Record<string, unknown>;
  environment?: Record<string, unknown>;
}): Promise<TrainingExperimentItem> {
  return request('/training/experiments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getTrainingExperiment(id: string): Promise<TrainingExperimentItem> {
  return request(`/training/experiments/${id}`);
}

export async function deleteTrainingExperiment(id: string): Promise<void> {
  return request(`/training/experiments/${id}`, { method: 'DELETE' });
}

export async function diffTrainingExperiments(
  idA: string,
  idB: string
): Promise<ExperimentDiffItem> {
  return request(`/training/experiments/diff?idA=${idA}&idB=${idB}`);
}

// Model Deployment
export interface ModelVersionItem {
  id: string;
  personalityId: string;
  modelName: string;
  experimentId?: string | null;
  finetuneJobId?: string | null;
  previousModel?: string | null;
  isActive: boolean;
  deployedAt: string;
  rolledBackAt?: string | null;
}

export async function deployModel(data: {
  personalityId: string;
  modelName: string;
  experimentId?: string;
  finetuneJobId?: string;
}): Promise<ModelVersionItem> {
  return request('/training/deploy', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rollbackModel(personalityId: string): Promise<ModelVersionItem> {
  return request('/training/deploy/rollback', {
    method: 'POST',
    body: JSON.stringify({ personalityId }),
  });
}

export async function fetchModelVersions(
  personalityId: string
): Promise<{ versions: ModelVersionItem[] }> {
  return request(`/training/model-versions?personalityId=${personalityId}`);
}

// A/B Tests
export interface AbTestItem {
  id: string;
  personalityId: string;
  name: string;
  modelA: string;
  modelB: string;
  trafficPctB: number;
  status: 'running' | 'completed' | 'cancelled';
  autoPromote: boolean;
  minConversations: number;
  winner?: string | null;
  conversationsA: number;
  conversationsB: number;
  avgQualityA?: number | null;
  avgQualityB?: number | null;
  createdAt: string;
  completedAt?: string | null;
}

export async function createAbTest(data: {
  personalityId: string;
  name: string;
  modelA: string;
  modelB: string;
  trafficPctB: number;
  autoPromote?: boolean;
  minConversations?: number;
}): Promise<AbTestItem> {
  return request('/training/ab-tests', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchAbTests(opts?: {
  personalityId?: string;
  status?: string;
}): Promise<{ tests: AbTestItem[] }> {
  const qs = new URLSearchParams();
  if (opts?.personalityId) qs.set('personalityId', opts.personalityId);
  if (opts?.status) qs.set('status', opts.status);
  const q = qs.toString();
  return request(`/training/ab-tests${q ? `?${q}` : ''}`);
}

export async function getAbTest(id: string): Promise<AbTestItem> {
  return request(`/training/ab-tests/${id}`);
}

export async function completeAbTest(id: string, winner: string): Promise<AbTestItem> {
  return request(`/training/ab-tests/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ winner }),
  });
}

export async function cancelAbTest(id: string): Promise<AbTestItem> {
  return request(`/training/ab-tests/${id}/cancel`, { method: 'POST' });
}

export async function evaluateAbTest(id: string): Promise<{
  winner: string | null;
  avgQualityA: number | null;
  avgQualityB: number | null;
  totalA: number;
  totalB: number;
}> {
  return request(`/training/ab-tests/${id}/evaluate`, { method: 'POST' });
}

// ── Capture Management (Phase 108-F) ──────────────────────────────────────

export interface CaptureConsentItem {
  id: string;
  requestedBy: string;
  userId: string;
  scope: { resource: string; duration: number; purpose: string };
  status: 'pending' | 'granted' | 'denied' | 'expired' | 'revoked';
  expiresAt: number;
  grantedAt?: number;
  requestedAt: number;
}

export interface CaptureRecordingItem {
  id: string;
  userId: string;
  status: 'active' | 'completed' | 'stopped' | 'failed';
  config: Record<string, unknown>;
  filePath?: string;
  fileSize?: number;
  startedAt: number;
  stoppedAt?: number;
}

export async function fetchPendingConsents(): Promise<{ consents: CaptureConsentItem[] }> {
  return request('/capture/consent/pending');
}

export async function grantConsent(id: string): Promise<CaptureConsentItem> {
  return request(`/capture/consent/${id}/grant`, { method: 'POST' });
}

export async function denyConsent(id: string, reason?: string): Promise<CaptureConsentItem> {
  return request(`/capture/consent/${id}/deny`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? 'User denied' }),
  });
}

export async function revokeConsent(id: string): Promise<CaptureConsentItem> {
  return request(`/capture/consent/${id}/revoke`, { method: 'POST' });
}

export async function fetchActiveRecordings(): Promise<{ recordings: CaptureRecordingItem[] }> {
  return request('/desktop/recording/active');
}

export async function stopRecording(sessionId: string): Promise<CaptureRecordingItem> {
  return request('/desktop/recording/stop', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

// ── Reasoning Strategies (Phase 107-A) ────────────────────────

export async function fetchStrategies(
  category?: string
): Promise<{ items: ReasoningStrategy[]; total: number }> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : '';
  return request(`/soul/strategies${qs}`);
}

export async function fetchStrategy(id: string): Promise<ReasoningStrategy> {
  return request(`/soul/strategies/${id}`);
}

export async function createStrategy(data: {
  name: string;
  slug: string;
  category: string;
  description?: string;
  promptPrefix: string;
}): Promise<ReasoningStrategy> {
  return request('/soul/strategies', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateStrategy(
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    category: string;
    description: string;
    promptPrefix: string;
  }>
): Promise<ReasoningStrategy> {
  return request(`/soul/strategies/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteStrategy(id: string): Promise<void> {
  return request(`/soul/strategies/${id}`, { method: 'DELETE' });
}

// ── ATHI Threat Governance (Phase 107-F) ────────────────────────────

export async function fetchAthiScenarios(params?: {
  actor?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AthiScenario[]; total: number }> {
  const q = new URLSearchParams();
  if (params?.actor) q.set('actor', params.actor);
  if (params?.status) q.set('status', params.status);
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.offset != null) q.set('offset', String(params.offset));
  const qs = q.toString();
  return request<{ items: AthiScenario[]; total: number }>(
    `/security/athi/scenarios${qs ? `?${qs}` : ''}`
  );
}

export async function createAthiScenario(data: {
  title: string;
  actor: string;
  techniques: string[];
  harms: string[];
  impacts: string[];
  likelihood: number;
  severity: number;
  mitigations?: { description: string; status?: string; owner?: string; effectiveness?: number }[];
  status?: string;
  description?: string;
}): Promise<AthiScenario> {
  const res = await request<{ scenario: AthiScenario }>('/security/athi/scenarios', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  return res.scenario;
}

export async function updateAthiScenario(
  id: string,
  data: Record<string, unknown>
): Promise<AthiScenario> {
  const res = await request<{ scenario: AthiScenario }>(
    `/security/athi/scenarios/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(data) }
  );
  return res.scenario;
}

export async function deleteAthiScenario(id: string): Promise<void> {
  await request(`/security/athi/scenarios/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function fetchAthiMatrix(): Promise<{ matrix: AthiRiskMatrixCell[] }> {
  return request<{ matrix: AthiRiskMatrixCell[] }>('/security/athi/matrix');
}

export async function fetchAthiTopRisks(limit = 10): Promise<{ topRisks: AthiScenario[] }> {
  return request<{ topRisks: AthiScenario[] }>(`/security/athi/top-risks?limit=${limit}`);
}

export async function fetchAthiSummary(): Promise<{ summary: AthiExecutiveSummary }> {
  return request<{ summary: AthiExecutiveSummary }>('/security/athi/summary');
}

export async function fetchAthiScenariosByTechnique(
  technique: string
): Promise<{ scenarios: AthiScenario[] }> {
  return request<{ scenarios: AthiScenario[] }>(
    `/security/athi/scenarios/by-technique/${encodeURIComponent(technique)}`
  );
}

export async function linkEventsToAthiScenario(
  scenarioId: string,
  eventIds: string[]
): Promise<AthiScenario> {
  const res = await request<{ scenario: AthiScenario }>(
    `/security/athi/scenarios/${encodeURIComponent(scenarioId)}/link-events`,
    { method: 'POST', body: JSON.stringify({ eventIds }) }
  );
  return res.scenario;
}

// ── Personality Versioning (Phase 114) ──────────────────────────────────────

export async function fetchPersonalityVersions(
  personalityId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ versions: PersonalityVersion[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params}` : '';
  return request<{ versions: PersonalityVersion[]; total: number }>(
    `/soul/personalities/${personalityId}/versions${qs}`
  );
}

export async function fetchPersonalityVersion(
  personalityId: string,
  idOrTag: string
): Promise<PersonalityVersion> {
  return request<PersonalityVersion>(`/soul/personalities/${personalityId}/versions/${idOrTag}`);
}

export async function tagPersonalityRelease(
  personalityId: string,
  tag?: string
): Promise<PersonalityVersion> {
  return request<PersonalityVersion>(`/soul/personalities/${personalityId}/versions/tag`, {
    method: 'POST',
    body: JSON.stringify(tag ? { tag } : {}),
  });
}

export async function deletePersonalityTag(
  personalityId: string,
  versionId: string
): Promise<PersonalityVersion> {
  return request<PersonalityVersion>(
    `/soul/personalities/${personalityId}/versions/${versionId}/tag`,
    { method: 'DELETE' }
  );
}

export async function rollbackPersonality(
  personalityId: string,
  versionId: string
): Promise<PersonalityVersion> {
  return request<PersonalityVersion>(
    `/soul/personalities/${personalityId}/versions/${versionId}/rollback`,
    { method: 'POST' }
  );
}

export async function fetchPersonalityDrift(personalityId: string): Promise<DriftSummary> {
  return request<DriftSummary>(`/soul/personalities/${personalityId}/drift`);
}

export async function fetchPersonalityVersionDiff(
  personalityId: string,
  versionA: string,
  versionB: string
): Promise<{ diff: string }> {
  return request<{ diff: string }>(
    `/soul/personalities/${personalityId}/versions/${versionA}/diff/${versionB}`
  );
}

// ── Workflow Versioning (Phase 114) ─────────────────────────────────────────

export async function fetchWorkflowVersions(
  workflowId: string,
  opts?: { limit?: number; offset?: number }
): Promise<{ versions: WorkflowVersion[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString() ? `?${params}` : '';
  return request<{ versions: WorkflowVersion[]; total: number }>(
    `/workflows/${workflowId}/versions${qs}`
  );
}

export async function fetchWorkflowVersion(
  workflowId: string,
  idOrTag: string
): Promise<WorkflowVersion> {
  return request<WorkflowVersion>(`/workflows/${workflowId}/versions/${idOrTag}`);
}

export async function tagWorkflowRelease(
  workflowId: string,
  tag?: string
): Promise<WorkflowVersion> {
  return request<WorkflowVersion>(`/workflows/${workflowId}/versions/tag`, {
    method: 'POST',
    body: JSON.stringify(tag ? { tag } : {}),
  });
}

export async function rollbackWorkflow(
  workflowId: string,
  versionId: string
): Promise<WorkflowVersion> {
  return request<WorkflowVersion>(`/workflows/${workflowId}/versions/${versionId}/rollback`, {
    method: 'POST',
  });
}

export async function fetchWorkflowDrift(workflowId: string): Promise<DriftSummary> {
  return request<DriftSummary>(`/workflows/${workflowId}/drift`);
}

export async function fetchWorkflowVersionDiff(
  workflowId: string,
  versionA: string,
  versionB: string
): Promise<{ diff: string }> {
  return request<{ diff: string }>(
    `/workflows/${workflowId}/versions/${versionA}/diff/${versionB}`
  );
}

// ── Phase 110: Citation API functions ────────────────────────────────────────

export async function fetchCitationFeedback(
  messageId: string
): Promise<{ messageId: string; feedback: CitationFeedback[] }> {
  return request<{ messageId: string; feedback: CitationFeedback[] }>(
    `/brain/citations/${messageId}`
  );
}

export async function submitCitationFeedback(
  messageId: string,
  data: { citationIndex: number; sourceId: string; relevant: boolean }
): Promise<{ id: string }> {
  return request<{ id: string }>(`/brain/citations/${messageId}/feedback`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchDocumentProvenance(
  docId: string
): Promise<{ sourceQuality: ProvenanceScores | null; trustScore: number }> {
  return request<{ sourceQuality: ProvenanceScores | null; trustScore: number }>(
    `/brain/documents/${docId}/provenance`
  );
}

export async function updateDocumentProvenance(
  docId: string,
  scores: Record<string, number>
): Promise<{ document: KbDocument }> {
  return request<{ document: KbDocument }>(`/brain/documents/${docId}/provenance`, {
    method: 'PUT',
    body: JSON.stringify({ scores }),
  });
}

export async function fetchGroundingStats(personalityId?: string): Promise<{
  averageScore: number | null;
  totalMessages: number;
  lowGroundingCount: number;
}> {
  const params = personalityId ? `?personalityId=${personalityId}` : '';
  return request<{
    averageScore: number | null;
    totalMessages: number;
    lowGroundingCount: number;
  }>(`/brain/grounding/stats${params}`);
}

// ── Phase 112: Provider Accounts ───────────────────────────────────────────

export interface ProviderAccountResponse {
  id: string;
  provider: string;
  label: string;
  secretName: string;
  isDefault: boolean;
  accountInfo: Record<string, unknown> | null;
  status: 'active' | 'invalid' | 'rate_limited' | 'disabled';
  lastValidatedAt: number | null;
  baseUrl: string | null;
  tenantId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AccountCostSummaryResponse {
  accountId: string;
  provider: string;
  label: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
}

export interface CostTrendPointResponse {
  date: string;
  costUsd: number;
  requests: number;
}

export async function fetchProviderAccounts(provider?: string): Promise<ProviderAccountResponse[]> {
  const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return request<ProviderAccountResponse[]>(`/provider-accounts${qs}`);
}

export async function createProviderAccount(input: {
  provider: string;
  label: string;
  apiKey: string;
  isDefault?: boolean;
  baseUrl?: string | null;
}): Promise<ProviderAccountResponse> {
  return request<ProviderAccountResponse>('/provider-accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateProviderAccount(
  id: string,
  update: { label?: string; baseUrl?: string | null; status?: string }
): Promise<ProviderAccountResponse> {
  return request<ProviderAccountResponse>(`/provider-accounts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(update),
  });
}

export async function deleteProviderAccount(id: string): Promise<void> {
  return request(`/provider-accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function setDefaultProviderAccount(id: string): Promise<ProviderAccountResponse> {
  return request<ProviderAccountResponse>(
    `/provider-accounts/${encodeURIComponent(id)}/set-default`,
    { method: 'POST' }
  );
}

export async function validateProviderAccount(id: string): Promise<ProviderAccountResponse> {
  return request<ProviderAccountResponse>(`/provider-accounts/${encodeURIComponent(id)}/validate`, {
    method: 'POST',
  });
}

export async function rotateProviderAccountKey(
  id: string,
  newKey: string
): Promise<ProviderAccountResponse> {
  return request<ProviderAccountResponse>(`/provider-accounts/${encodeURIComponent(id)}/rotate`, {
    method: 'POST',
    body: JSON.stringify({ newKey }),
  });
}

export async function validateAllProviderAccounts(): Promise<{
  total: number;
  valid: number;
  invalid: number;
}> {
  return request<{ total: number; valid: number; invalid: number }>(
    '/provider-accounts/validate-all',
    { method: 'POST' }
  );
}

export async function fetchAccountCosts(opts?: {
  from?: number;
  to?: number;
  accountId?: string;
}): Promise<AccountCostSummaryResponse[]> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', String(opts.from));
  if (opts?.to) params.set('to', String(opts.to));
  if (opts?.accountId) params.set('accountId', opts.accountId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<AccountCostSummaryResponse[]>(`/provider-accounts/costs${qs}`);
}

export async function fetchAccountCostTrend(opts?: {
  accountId?: string;
  days?: number;
}): Promise<CostTrendPointResponse[]> {
  const params = new URLSearchParams();
  if (opts?.accountId) params.set('accountId', opts.accountId);
  if (opts?.days) params.set('days', String(opts.days));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<CostTrendPointResponse[]>(`/provider-accounts/costs/trend${qs}`);
}

export async function exportAccountCostsCsv(opts?: {
  from?: number;
  to?: number;
  accountId?: string;
}): Promise<string> {
  const params = new URLSearchParams();
  if (opts?.from) params.set('from', String(opts.from));
  if (opts?.to) params.set('to', String(opts.to));
  if (opts?.accountId) params.set('accountId', opts.accountId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/v1/provider-accounts/costs/export${qs}`, { headers });
  return res.text();
}

// ── AGNOS Token Pools ────────────────────────────────────────────────────────

export interface TokenPoolResponse {
  name: string;
  total: number;
  used: number;
  remaining: number;
  period_seconds?: number;
}

export interface TokenPoolsResponse {
  pools: TokenPoolResponse[];
  available: boolean;
  error?: string;
}

export async function fetchTokenPools(): Promise<TokenPoolsResponse> {
  return request<TokenPoolsResponse>('/provider-accounts/token-pools');
}

export async function fetchTokenPoolDetail(name: string): Promise<TokenPoolResponse> {
  return request<TokenPoolResponse>(`/provider-accounts/token-pools/${encodeURIComponent(name)}`);
}

// ── Sandbox Scanning (Phase 116) ─────────────────────────────────────────────

export async function fetchScanHistory(params?: {
  limit?: number;
  offset?: number;
  verdict?: string;
  sourceContext?: string;
  personalityId?: string;
}): Promise<{ rows: ScanHistoryRow[]; total: number }> {
  const query = new URLSearchParams();
  if (params?.limit) query.set('limit', params.limit.toString());
  if (params?.offset !== undefined) query.set('offset', params.offset.toString());
  if (params?.verdict) query.set('verdict', params.verdict);
  if (params?.sourceContext) query.set('sourceContext', params.sourceContext);
  if (params?.personalityId) query.set('personalityId', params.personalityId);
  const qs = query.toString() ? `?${query.toString()}` : '';
  try {
    return await request<{ rows: ScanHistoryRow[]; total: number }>(`/sandbox/scans${qs}`);
  } catch {
    return { rows: [], total: 0 };
  }
}

export interface ScanStats {
  total: number;
  byVerdict: Record<string, number>;
  bySeverity: Record<string, number>;
  avgDurationMs: number;
  last24h: number;
}

export async function fetchScanStats(): Promise<{ stats: ScanStats }> {
  try {
    return await request<{ stats: ScanStats }>('/sandbox/scans/stats');
  } catch {
    return { stats: { total: 0, byVerdict: {}, bySeverity: {}, avgDurationMs: 0, last24h: 0 } };
  }
}

export async function fetchQuarantineItems(): Promise<{ items: QuarantineEntry[] }> {
  try {
    return await request<{ items: QuarantineEntry[] }>('/sandbox/quarantine');
  } catch {
    return { items: [] };
  }
}

export async function approveQuarantine(id: string): Promise<void> {
  await request(`/sandbox/quarantine/${id}/approve`, { method: 'POST' });
}

export async function deleteQuarantine(id: string): Promise<void> {
  await request(`/sandbox/quarantine/${id}`, { method: 'DELETE' });
}

export interface ThreatIntelligenceSummary {
  patternCount: number;
  categories: string[];
  stages: string[];
  patterns: {
    id: string;
    name: string;
    category: string;
    description: string;
    killChainStage: string;
    intentWeight: number;
    version: string;
    indicatorCount: number;
  }[];
}

export async function fetchThreatIntelligence(): Promise<ThreatIntelligenceSummary> {
  try {
    return await request<ThreatIntelligenceSummary>('/sandbox/threats');
  } catch {
    return { patternCount: 0, categories: [], stages: [], patterns: [] };
  }
}

export async function fetchSandboxPolicy(): Promise<{ policy: ExternalizationPolicy }> {
  try {
    return await request<{ policy: ExternalizationPolicy }>('/sandbox/policy');
  } catch {
    return { policy: { enabled: false } as ExternalizationPolicy };
  }
}

// ─── Editor Search & Replace API ────────────────────────────────

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface SearchResult {
  matches: SearchMatch[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
}

export async function searchFiles(params: {
  query: string;
  cwd?: string;
  glob?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  maxResults?: number;
}): Promise<SearchResult> {
  return request('/editor/search', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export interface ReplaceResult {
  files: { file: string; replacements: number }[];
  totalReplacements: number;
}

export async function replaceInFiles(params: {
  cwd?: string;
  search: string;
  replace: string;
  files: string[];
  regex?: boolean;
  caseSensitive?: boolean;
}): Promise<ReplaceResult> {
  return request('/editor/replace', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ─── Editor Annotations API (Training Integration) ─────────────

export interface Annotation {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  label: 'good' | 'bad' | 'instruction' | 'response';
  note?: string;
  personalityId?: string;
  createdAt: string;
}

export async function fetchAnnotations(params?: {
  filePath?: string;
  personalityId?: string;
}): Promise<{ annotations: Annotation[] }> {
  const qs = new URLSearchParams();
  if (params?.filePath) qs.set('filePath', params.filePath);
  if (params?.personalityId) qs.set('personalityId', params.personalityId);
  const q = qs.toString();
  return request(`/editor/annotations${q ? `?${q}` : ''}`);
}

export async function createAnnotation(
  data: Omit<Annotation, 'id' | 'createdAt'>
): Promise<{ annotation: Annotation }> {
  return request('/editor/annotations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  await request(`/editor/annotations/${id}`, { method: 'DELETE' });
}

export async function exportAnnotationsAsDataset(params?: {
  personalityId?: string;
  format?: 'jsonl' | 'csv';
}): Promise<string> {
  const qs = new URLSearchParams();
  if (params?.personalityId) qs.set('personalityId', params.personalityId);
  if (params?.format) qs.set('format', params.format);
  const q = qs.toString();
  return request(`/editor/annotations/export${q ? `?${q}` : ''}`);
}

// ─── Inline AI Completion API ───────────────────────────────────

export async function fetchInlineCompletion(params: {
  prefix: string;
  suffix: string;
  language: string;
  personalityId?: string;
}): Promise<{ completion: string }> {
  return request('/ai/inline-complete', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ── Photisnadi ────────────────────────────────────────────────────────

export async function fetchPhotisnadiWidget(): Promise<any> {
  return request('/integrations/photisnadi/widget');
}

export async function fetchPhotisnadiHealth(): Promise<{ ok: boolean }> {
  return request('/integrations/photisnadi/health');
}

// ── Key Rotation ─────────────────────────────────────────────────────

export interface RotationStatus {
  name: string;
  category: string;
  source: string;
  status: 'ok' | 'expiring_soon' | 'expired' | 'rotation_due';
  autoRotate: boolean;
  lastRotatedAt: number | null;
  expiresAt: number | null;
  rotationIntervalDays: number | null;
  daysUntilExpiry: number | null;
  createdAt: number;
}

export async function fetchKeyRotationStatus(): Promise<{ statuses: RotationStatus[] }> {
  return request('/admin/key-rotation');
}

export async function rotateKey(
  name: string
): Promise<{ rotated: boolean; status: RotationStatus | null }> {
  return request(`/admin/key-rotation/${encodeURIComponent(name)}/rotate`, {
    method: 'POST',
  });
}

// ── Voice Profiles ────────────────────────────────────────────────────

export interface VoiceProfile {
  id: string;
  name: string;
  provider: string;
  voiceId: string;
  settings?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export async function fetchVoiceProfiles(): Promise<{ profiles: VoiceProfile[] }> {
  return request('/voice/profiles');
}

export async function createVoiceProfile(data: {
  name: string;
  provider: string;
  voiceId: string;
  settings?: Record<string, unknown>;
}): Promise<VoiceProfile> {
  return request('/voice/profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateVoiceProfile(
  id: string,
  data: {
    name?: string;
    provider?: string;
    voiceId?: string;
    settings?: Record<string, unknown>;
  }
): Promise<VoiceProfile> {
  return request(`/voice/profiles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteVoiceProfile(id: string): Promise<void> {
  await request(`/voice/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function previewVoiceProfile(
  id: string,
  text: string
): Promise<{ audioBase64: string; format: string; durationMs: number }> {
  return request(`/voice/profiles/${encodeURIComponent(id)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export async function cloneVoice(name: string, audioBase64: string): Promise<VoiceProfile> {
  return request('/voice/profiles/clone', {
    method: 'POST',
    body: JSON.stringify({ name, audioBase64 }),
  });
}

// ─── JFrog Artifactory ──────────────────────────────────────

export interface ArtifactoryConnection {
  key: string;
  baseUrl: string;
}

export interface ArtifactoryRepo {
  key: string;
  type: 'local' | 'remote' | 'virtual' | 'federated';
  packageType: string;
  description?: string;
  url: string;
}

export interface ArtifactoryItem {
  path: string;
  name: string;
  size: number;
  created: string;
  modified: string;
  sha256?: string;
  mimeType?: string;
  downloadUri?: string;
}

export interface ArtifactoryDockerImage {
  name: string;
  tags: string[];
  lastModified?: string;
}

export interface ArtifactoryBuildSummary {
  name: string;
  lastStarted: string;
}

export interface ArtifactoryBuildInfo {
  name: string;
  number: string;
  started: string;
  status?: string;
  modules?: { id: string; artifacts: { name: string; sha256: string }[] }[];
}

export async function fetchArtifactoryConnections(): Promise<ArtifactoryConnection[]> {
  const res = await request<{ connections: ArtifactoryConnection[] }>('/artifactory/connections');
  return res.connections;
}

export async function addArtifactoryConnection(config: {
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
}): Promise<ArtifactoryConnection> {
  return request('/artifactory/connections', { method: 'POST', body: JSON.stringify(config) });
}

export async function removeArtifactoryConnection(key: string): Promise<void> {
  await request(`/artifactory/connections/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

export async function fetchArtifactoryRepos(
  key: string,
  type?: string,
  packageType?: string
): Promise<ArtifactoryRepo[]> {
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (packageType) params.set('packageType', packageType);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await request<{ repos: ArtifactoryRepo[] }>(
    `/artifactory/${encodeURIComponent(key)}/repos${qs}`
  );
  return res.repos;
}

export async function fetchArtifactoryFolderItems(
  key: string,
  repoKey: string,
  path?: string
): Promise<ArtifactoryItem[]> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await request<{ items: ArtifactoryItem[] }>(
    `/artifactory/${encodeURIComponent(key)}/repos/${encodeURIComponent(repoKey)}/browse${qs}`
  );
  return res.items;
}

export async function fetchArtifactorySearch(
  key: string,
  name: string,
  repos?: string
): Promise<ArtifactoryItem[]> {
  const params = new URLSearchParams({ name });
  if (repos) params.set('repos', repos);
  const res = await request<{ items: ArtifactoryItem[] }>(
    `/artifactory/${encodeURIComponent(key)}/search?${params.toString()}`
  );
  return res.items;
}

export async function fetchArtifactoryDockerImages(
  key: string,
  repoKey: string
): Promise<ArtifactoryDockerImage[]> {
  const res = await request<{ images: ArtifactoryDockerImage[] }>(
    `/artifactory/${encodeURIComponent(key)}/docker/${encodeURIComponent(repoKey)}/images`
  );
  return res.images;
}

export async function fetchArtifactoryDockerTags(
  key: string,
  repoKey: string,
  image: string
): Promise<string[]> {
  const res = await request<{ tags: string[] }>(
    `/artifactory/${encodeURIComponent(key)}/docker/${encodeURIComponent(repoKey)}/images/${encodeURIComponent(image)}/tags`
  );
  return res.tags;
}

export async function fetchArtifactoryBuilds(key: string): Promise<ArtifactoryBuildSummary[]> {
  const res = await request<{ builds: ArtifactoryBuildSummary[] }>(
    `/artifactory/${encodeURIComponent(key)}/builds`
  );
  return res.builds;
}

export async function fetchArtifactoryBuild(
  key: string,
  name: string,
  number?: string
): Promise<ArtifactoryBuildInfo> {
  const path = number
    ? `/artifactory/${encodeURIComponent(key)}/builds/${encodeURIComponent(name)}/${encodeURIComponent(number)}`
    : `/artifactory/${encodeURIComponent(key)}/builds/${encodeURIComponent(name)}`;
  return request(path);
}

export async function promoteArtifactoryBuild(
  key: string,
  name: string,
  number: string,
  targetRepo: string,
  status?: string
): Promise<void> {
  await request(
    `/artifactory/${encodeURIComponent(key)}/builds/${encodeURIComponent(name)}/${encodeURIComponent(number)}/promote`,
    { method: 'POST', body: JSON.stringify({ targetRepo, status }) }
  );
}

export async function fetchArtifactoryHealth(key: string): Promise<boolean> {
  const res = await request<{ healthy: boolean }>(`/artifactory/${encodeURIComponent(key)}/health`);
  return res.healthy;
}

// ── Simulation Engine ──────────────────────────────────────────────────

export async function fetchSimTickConfig(personalityId: string): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}`);
}

export async function startSimTick(
  personalityId: string,
  config: { mode: string; tickIntervalMs?: number; timeScale?: number }
): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function pauseSimTick(personalityId: string): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}/pause`, { method: 'POST' });
}

export async function resumeSimTick(personalityId: string): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}/resume`, {
    method: 'POST',
  });
}

export async function advanceSimTick(personalityId: string): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}/advance`, {
    method: 'POST',
  });
}

export async function deleteSimTick(personalityId: string): Promise<any> {
  return request(`/simulation/tick/${encodeURIComponent(personalityId)}`, { method: 'DELETE' });
}

export async function fetchSimMoodState(personalityId: string): Promise<any> {
  return request(`/personalities/${encodeURIComponent(personalityId)}/mood`);
}

export async function fetchSimMoodHistory(personalityId: string, limit = 20): Promise<any> {
  return request(`/personalities/${encodeURIComponent(personalityId)}/mood/history?limit=${limit}`);
}

export async function submitSimMoodEvent(
  personalityId: string,
  event: { eventType: string; valenceDelta: number; arousalDelta: number; source?: string }
): Promise<any> {
  return request(`/personalities/${encodeURIComponent(personalityId)}/mood/event`, {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export async function resetSimMood(personalityId: string): Promise<any> {
  return request(`/personalities/${encodeURIComponent(personalityId)}/mood/reset`, {
    method: 'POST',
  });
}

export async function fetchSimEntities(personalityId: string): Promise<any> {
  return request(`/simulation/spatial/${encodeURIComponent(personalityId)}/entities`);
}

export async function fetchSimZones(personalityId: string): Promise<any> {
  return request(`/simulation/spatial/${encodeURIComponent(personalityId)}/zones`);
}

export async function fetchSimRelationships(personalityId: string): Promise<any> {
  return request(`/simulation/relationships/${encodeURIComponent(personalityId)}`);
}

export async function fetchSimGroups(personalityId: string): Promise<any> {
  return request(`/simulation/groups/${encodeURIComponent(personalityId)}`);
}
