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

// ─── Soul Types ──────────────────────────────────────────────

export interface DefaultModel {
  provider: string;
  model: string;
}

export interface Personality {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  traits: Record<string, string>;
  sex: 'male' | 'female' | 'non-binary' | 'unspecified';
  voice: string;
  preferredLanguage: string;
  defaultModel: DefaultModel | null;
  includeArchetypes: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PersonalityCreate {
  name: string;
  description?: string;
  systemPrompt?: string;
  traits?: Record<string, string>;
  sex?: 'male' | 'female' | 'non-binary' | 'unspecified';
  voice?: string;
  preferredLanguage?: string;
  defaultModel?: DefaultModel | null;
  includeArchetypes?: boolean;
}

// ─── Spirit Types ────────────────────────────────────────────

export interface Passion {
  id: string;
  name: string;
  description: string;
  intensity: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Inspiration {
  id: string;
  source: string;
  description: string;
  impact: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Pain {
  id: string;
  trigger: string;
  description: string;
  severity: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── Brain Types ─────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string;
  topic: string;
  content: string;
  source: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  triggerPatterns: string[];
  enabled: boolean;
  source: 'user' | 'ai_proposed' | 'ai_learned';
  status: 'active' | 'pending_approval' | 'disabled';
  usageCount: number;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillCreate {
  name: string;
  description?: string;
  instructions?: string;
  tools?: Skill['tools'];
  triggerPatterns?: string[];
  enabled?: boolean;
  source?: Skill['source'];
  status?: Skill['status'];
}

export interface HeartbeatTask {
  name: string;
  type: string;
  enabled: boolean;
  intervalMs?: number;
  lastRunAt: number | null;
  config: Record<string, unknown>;
  personalityId?: string | null;
  personalityName?: string | null;
}

export interface OnboardingStatus {
  needed: boolean;
  agentName: string | null;
  personality: Personality | null;
}

export interface PromptPreview {
  prompt: string;
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  charCount: number;
  estimatedTokens: number;
}

// ─── API Key Types ──────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  role: string;
  prefix: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface ApiKeyCreateRequest {
  name: string;
  role: string;
  expiresInDays?: number;
}

export interface ApiKeyCreateResponse extends ApiKey {
  rawKey: string;
}

// ─── Integration / Connection Types ─────────────────────────

export type IntegrationStatus = 'connected' | 'disconnected' | 'error' | 'configuring';

export interface IntegrationInfo {
  id: string;
  platform: string;
  displayName: string;
  status: IntegrationStatus;
  enabled: boolean;
  config: Record<string, unknown>;
  connectedAt?: string;
  lastMessageAt?: string;
  messageCount: number;
  errorMessage?: string;
}

// ─── Chat Types ─────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
  provider?: string;
  tokensUsed?: number;
}

export interface ChatResponse {
  role: 'assistant';
  content: string;
  model: string;
  provider: string;
  tokensUsed?: number;
}

// ─── Code Session Types ─────────────────────────────────────

export interface CodeSession {
  id: string;
  filename: string;
  language: string;
  content: string;
  personalityId: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Model Types ────────────────────────────────────────────

export interface ModelInfo {
  provider: string;
  model: string;
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

export interface ModelCurrentConfig {
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface ModelInfoResponse {
  current: ModelCurrentConfig;
  available: Record<string, ModelInfo[]>;
}

// ─── MCP Types ──────────────────────────────────────────────

export interface McpServerConfig {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

export interface McpResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  serverId: string;
  serverName: string;
}

// ─── Soul Config Types ──────────────────────────────────────

export interface SoulConfig {
  enabled: boolean;
  learningMode: string[];
  maxSkills: number;
  maxPromptTokens: number;
}
