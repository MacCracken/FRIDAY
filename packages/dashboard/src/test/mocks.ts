import type {
  MetricsSnapshot,
  Task,
  SecurityEvent,
  IntegrationInfo,
  ApiKey,
  SoulConfig,
  ChatResponse,
  ModelInfoResponse,
} from '../types';

// ── Metrics Snapshot ──────────────────────────────────────────────

export function createMetricsSnapshot(
  overrides?: Partial<MetricsSnapshot>
): MetricsSnapshot {
  return {
    timestamp: Date.now(),
    tasks: {
      total: 142,
      byStatus: { completed: 120, failed: 12, running: 5, pending: 3, timeout: 2 },
      byType: { execute: 80, query: 30, file: 20, network: 10, system: 2 },
      successRate: 0.845,
      failureRate: 0.085,
      avgDurationMs: 1230,
      minDurationMs: 12,
      maxDurationMs: 58000,
      p50DurationMs: 850,
      p95DurationMs: 4500,
      p99DurationMs: 12000,
      queueDepth: 3,
      inProgress: 5,
    },
    resources: {
      cpuPercent: 34.5,
      memoryUsedMb: 256,
      memoryLimitMb: 1024,
      memoryPercent: 25,
      diskUsedMb: 512,
      tokensUsedToday: 48500,
      tokensCachedToday: 12300,
      costUsdToday: 1.23,
      costUsdMonth: 28.45,
      apiCallsTotal: 892,
      apiErrorsTotal: 7,
      apiLatencyAvgMs: 245,
    },
    security: {
      authAttemptsTotal: 45,
      authSuccessTotal: 42,
      authFailuresTotal: 3,
      activeSessions: 2,
      permissionChecksTotal: 500,
      permissionDenialsTotal: 5,
      blockedRequestsTotal: 2,
      rateLimitHitsTotal: 8,
      injectionAttemptsTotal: 1,
      eventsBySeverity: { info: 30, warn: 10, error: 4, critical: 1 },
      eventsByType: { auth_failure: 3, rate_limit: 8, injection_attempt: 1 },
      auditEntriesTotal: 1250,
      auditChainValid: true,
    },
    ...overrides,
  };
}

// ── Tasks ─────────────────────────────────────────────────────────

export function createTask(overrides?: Partial<Task>): Task {
  const id = overrides?.id ?? 'task-' + Math.random().toString(36).slice(2, 10);
  return {
    id,
    type: 'execute',
    name: 'Run deployment script',
    description: 'Deploy latest build to staging',
    status: 'completed',
    createdAt: Date.now() - 60000,
    startedAt: Date.now() - 55000,
    completedAt: Date.now() - 50000,
    durationMs: 5000,
    result: { success: true },
    ...overrides,
  };
}

export function createTaskList(count = 5): Task[] {
  const statuses: Task['status'][] = ['completed', 'failed', 'running', 'pending', 'timeout'];
  const types = ['execute', 'query', 'file', 'network', 'system'];
  const names = [
    'Run deployment script',
    'Query user database',
    'Read config file',
    'Fetch API data',
    'System health check',
  ];

  return Array.from({ length: count }, (_, i) => createTask({
    id: `task-${String(i + 1).padStart(8, '0')}`,
    status: statuses[i % statuses.length],
    type: types[i % types.length],
    name: names[i % names.length],
    durationMs: (i + 1) * 1000,
    result: statuses[i % statuses.length] === 'failed'
      ? { success: false, error: { code: 'EXEC_FAILED', message: 'Process exited with code 1' } }
      : { success: true },
  }));
}

// ── Security Events ───────────────────────────────────────────────

export function createSecurityEvent(
  overrides?: Partial<SecurityEvent>
): SecurityEvent {
  return {
    id: 'evt-' + Math.random().toString(36).slice(2, 10),
    type: 'auth_failure',
    severity: 'warn',
    message: 'Failed login attempt from unknown IP',
    userId: 'user-001',
    ipAddress: '192.168.1.42',
    timestamp: Date.now() - 30000,
    acknowledged: false,
    ...overrides,
  };
}

export function createSecurityEventList(): SecurityEvent[] {
  return [
    createSecurityEvent({
      id: 'evt-001',
      type: 'auth_success',
      severity: 'info',
      message: 'Successful login',
      userId: 'admin',
      ipAddress: '10.0.0.1',
    }),
    createSecurityEvent({
      id: 'evt-002',
      type: 'auth_failure',
      severity: 'warn',
      message: 'Failed login attempt',
      userId: 'unknown',
      ipAddress: '192.168.1.100',
    }),
    createSecurityEvent({
      id: 'evt-003',
      type: 'rate_limit_exceeded',
      severity: 'error',
      message: 'Rate limit exceeded for API endpoint',
      ipAddress: '172.16.0.50',
    }),
    createSecurityEvent({
      id: 'evt-004',
      type: 'injection_attempt',
      severity: 'critical',
      message: 'SQL injection attempt detected in query parameter',
      ipAddress: '203.0.113.5',
    }),
  ];
}

// ── Integration Configs ───────────────────────────────────────────

export function createIntegration(
  overrides?: Partial<IntegrationInfo>
): IntegrationInfo {
  return {
    id: 'int-' + Math.random().toString(36).slice(2, 10),
    platform: 'telegram',
    displayName: 'My Telegram Bot',
    status: 'connected',
    enabled: true,
    config: { botToken: '***' },
    connectedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    messageCount: 128,
    ...overrides,
  };
}

export function createIntegrationList(): IntegrationInfo[] {
  return [
    createIntegration({
      id: 'int-telegram-1',
      platform: 'telegram',
      displayName: 'Friday Telegram',
      status: 'connected',
      messageCount: 256,
    }),
    createIntegration({
      id: 'int-discord-1',
      platform: 'discord',
      displayName: 'Dev Discord',
      status: 'disconnected',
      messageCount: 42,
      errorMessage: undefined,
    }),
    createIntegration({
      id: 'int-slack-1',
      platform: 'slack',
      displayName: 'Team Slack',
      status: 'error',
      messageCount: 0,
      errorMessage: 'Invalid bot token',
    }),
  ];
}

// ── API Keys ──────────────────────────────────────────────────────

export function createApiKey(overrides?: Partial<ApiKey>): ApiKey {
  return {
    id: 'key-' + Math.random().toString(36).slice(2, 10),
    name: 'CI Pipeline',
    role: 'operator',
    prefix: 'fri_abc',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Soul Config ───────────────────────────────────────────────────

export function createSoulConfig(overrides?: Partial<SoulConfig>): SoulConfig {
  return {
    enabled: true,
    learningMode: ['observe', 'suggest'],
    maxSkills: 50,
    maxPromptTokens: 4096,
    ...overrides,
  };
}

// ── Chat Response ────────────────────────────────────────────────

export function createChatResponse(overrides?: Partial<ChatResponse>): ChatResponse {
  return {
    role: 'assistant',
    content: 'Hello! I am FRIDAY, your AI assistant.',
    model: 'claude-sonnet-4-20250514',
    provider: 'anthropic',
    tokensUsed: 150,
    ...overrides,
  };
}

// ── Model Info Response ──────────────────────────────────────────

export function createModelInfoResponse(overrides?: Partial<ModelInfoResponse>): ModelInfoResponse {
  return {
    current: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 16384,
      temperature: 0.7,
    },
    available: {
      anthropic: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', inputPer1M: 3, outputPer1M: 15, cachedInputPer1M: 0.3 },
        { provider: 'anthropic', model: 'claude-opus-4-20250514', inputPer1M: 15, outputPer1M: 75, cachedInputPer1M: 1.5 },
      ],
      openai: [
        { provider: 'openai', model: 'gpt-4o', inputPer1M: 2.5, outputPer1M: 10 },
      ],
      ollama: [
        { provider: 'ollama', model: 'local', inputPer1M: 0, outputPer1M: 0 },
      ],
    },
    ...overrides,
  };
}
