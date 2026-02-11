# Phase 5: Platform Adapters, Monitoring & Production Hardening

> Complete remaining platform integrations (Discord, Slack, GitHub), add observability (Prometheus, log aggregation), finalize documentation, and prepare deployment tooling.

---

## Context

### Already Completed

**Phase 1-2.5 (Foundation + Security + Infrastructure):**
- Core agent engine with multi-provider AI (Anthropic, OpenAI, Gemini, Ollama)
- Full security layer: RBAC, JWT/API key auth, encryption at rest, sandbox (Linux Landlock + macOS sandbox-exec), rate limiting, input validation, prompt injection defense
- Brain system (memory, knowledge, skills) + Soul system (personality, identity)
- E2E encrypted inter-agent communication
- Model fallback chain on rate limits (429) / provider unavailability (502/503)
- CLI entry point with --port, --host, --config, --log-level, --tls flags

**Phase 3 (Dashboard) — ~98% complete:**
- React + Vite + TypeScript with URL routing, auth, live data
- MetricsGraph (ReactFlow), TaskHistory, SecurityEvents, ResourceMonitor, ConnectionManager
- Soul/Personality UI (onboarding wizard, personality editor, skills manager)
- Responsive mobile layout, theme toggle, session timeout, ErrorBoundary

**Phase 4 (Integrations) — Framework + Telegram complete:**
- P4-001: Plugin architecture (`Integration` interface, `IntegrationManager`, `IntegrationStorage`, factory pattern, REST API with RBAC)
- P4-002: Message abstraction (`UnifiedMessage`, `MessageAttachment`, `PlatformAdapter`, `MessageRouter`, message persistence)
- P4-003: Telegram adapter (grammy, long-polling, `/start`/`help`/`status` commands, 23 tests)

**Phase 5 (Production) — Partial:**
- P5-004: Docker packaging (multi-stage Dockerfile, docker-compose, non-root user, healthcheck)
- P5-005: CI/CD pipeline (lint -> typecheck -> test -> build -> security audit -> docker build, Node 20+22 matrix)
- P5-006 partial: docs/installation.md, docs/configuration.md, docs/api/ written
- Structured logging via Pino (JSON format)
- Audit chain with cryptographic integrity
- Rate limiting with metrics counters

### Current Infrastructure

- **Gateway**: Fastify on port 18789, local-network-only, bodyLimit 1MB
- **WebSocket**: `/ws/metrics` with 1s broadcast interval
- **Database**: SQLite with WAL mode (audit.db, auth.db, tasks.db, soul.db, integrations.db, rbac.db, brain.db, comms.db)
- **CLI**: `packages/core/src/cli.ts` with --port, --host, --config, --log-level, --tls flags
- **CI**: `.github/workflows/ci.yml` with Node 20+22 matrix
- **Tests**: ~746 tests across 39 files with 80% coverage thresholds

---

## Part 1: Integration Framework Improvements

Before adding new platform adapters, harden the integration framework.

### 1.1 ConversationManager (P5-F01)

Create `packages/core/src/integrations/conversation.ts`:
- Maintain per-chatId sliding window of recent messages
- Pass conversation history to TaskExecutor as context
- Configurable window size (default: 10 messages, 30 minutes)
- Clear stale conversations on timer

### 1.2 Auto-Reconnect in IntegrationManager (P5-F02)

Modify `packages/core/src/integrations/manager.ts`:
- Health check interval (every 30s) calling `isHealthy()`
- If unhealthy: `stop()` -> `start()` with exponential backoff (max 5 retries)
- Set status to `error` with message after max retries
- Emit events for dashboard status updates

### 1.3 Per-Platform Rate Limiter (P5-F03)

- Add optional `platformRateLimit` field to `Integration` interface
- IntegrationManager wraps `sendMessage()` with rate limiting
- Default limits: Telegram 30/s, Discord 50/s, Slack 1/s

---

## Part 2: Discord Adapter (P4-004)

**Package**: `discord.js` v14
**Complexity**: Medium

Create `packages/core/src/integrations/discord/adapter.ts`:

1. Use `Client` with `GatewayIntentBits.Guilds`, `GuildMessages`, `MessageContent`
2. Register slash commands: `/ask <question>`, `/status`, `/help`
3. Handle `messageCreate` event -> normalize to UnifiedMessage
4. Send responses as embeds (richer formatting than plain text)
5. Thread support: create/continue threads for multi-turn conversations
6. `sendMessage()` maps chatId to channel ID via `channel.send()`

**Config**: `{ botToken, guildId? }`

**Key Differences from Telegram:**
- Gateway WebSocket (not polling) -- `client.login(token)`
- Slash commands need `REST.put(Routes.applicationCommands())`
- Rich embeds instead of Markdown
- Thread-based conversations map well to conversation context

---

## Part 3: Slack Adapter (P4-005)

**Package**: `@slack/bolt`
**Complexity**: Medium-High

Create `packages/core/src/integrations/slack/adapter.ts`:

1. Use Bolt's `App` class with socket mode (no public URL needed)
2. Listen for `message` and `app_mention` events
3. Register slash commands: `/friday <question>`, `/friday-status`
4. Respond with Block Kit messages (Slack's rich formatting)
5. Handle interactive components (buttons, modals) for skill selection
6. `sendMessage()` maps chatId to channel ID via `client.chat.postMessage()`

**Config**: `{ botToken, appToken, signingSecret }`

**Key Differences:**
- Requires Bot Token AND App Token for socket mode
- Block Kit is more complex than Markdown or Discord embeds
- `app_mention` is the primary trigger in channels

---

## Part 4: GitHub Adapter (P4-007)

**Package**: `@octokit/rest` + `@octokit/webhooks`
**Complexity**: High

Create `packages/core/src/integrations/github/adapter.ts`:

**Note**: GitHub is event-driven (webhooks), not conversational. Requires a `WebhookIntegration` interface extending `Integration` with `getWebhookRoute()` and `verifyWebhook(request)`.

1. Register Fastify route: `POST /api/v1/integrations/github/webhook`
2. Handle events: `push`, `pull_request`, `issues`, `issue_comment`
3. Normalize webhook payloads to UnifiedMessage
4. `sendMessage()` maps to: issue comment, PR review, or commit status
5. Specific actions:
   - PR review: AI analyzes diff, posts review comments
   - Issue triage: AI labels and assigns based on content
   - Commit analysis: AI summarizes changes

**Config**: `{ personalAccessToken or appId + privateKey, webhookSecret }`

### Media Download Pipeline (needed before GitHub)

- `downloadFile(url, maxSizeMb)` utility in integrations
- Store downloaded files in `dataDir/media/` with cleanup schedule
- Create MessageAttachment with local file path

---

## Part 5: Prometheus Metrics Endpoint (P5-007)

### 5.1 Create `packages/core/src/gateway/prometheus.ts`

Expose Prometheus-format metrics at `GET /metrics` (separate from `/api/v1/metrics`):

```typescript
export function formatPrometheusMetrics(metrics: MetricsSnapshot): string {
  const lines: string[] = [];

  const gauge = (name: string, help: string, value: number, labels?: Record<string, string>) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    const labelStr = labels ? `{${Object.entries(labels).map(([k,v]) => `${k}="${v}"`).join(',')}}` : '';
    lines.push(`${name}${labelStr} ${value}`);
  };

  const counter = (name: string, help: string, value: number) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  };

  // Task metrics
  counter('friday_tasks_total', 'Total tasks processed', metrics.tasks.total);
  gauge('friday_tasks_queue_depth', 'Current task queue depth', metrics.tasks.queueDepth);
  gauge('friday_tasks_in_progress', 'Tasks currently running', metrics.tasks.inProgress);
  gauge('friday_tasks_success_rate', 'Task success rate (0-1)', metrics.tasks.successRate);
  gauge('friday_tasks_avg_duration_ms', 'Average task duration in ms', metrics.tasks.avgDurationMs);

  for (const [status, count] of Object.entries(metrics.tasks.byStatus)) {
    gauge('friday_tasks_by_status', 'Tasks by status', count as number, { status });
  }

  // Resource metrics
  gauge('friday_cpu_percent', 'CPU usage percentage', metrics.resources.cpuPercent);
  gauge('friday_memory_used_mb', 'Memory used in MB', metrics.resources.memoryUsedMb);
  gauge('friday_memory_limit_mb', 'Memory limit in MB', metrics.resources.memoryLimitMb);
  counter('friday_tokens_used_today', 'Tokens used today', metrics.resources.tokensUsedToday);
  gauge('friday_cost_usd_today', 'Cost in USD today', metrics.resources.costUsdToday);
  gauge('friday_cost_usd_month', 'Cost in USD this month', metrics.resources.costUsdMonth);
  counter('friday_api_calls_total', 'Total API calls to AI providers', metrics.resources.apiCallsTotal);
  counter('friday_api_errors_total', 'Total AI API errors', metrics.resources.apiErrorsTotal);

  // Security metrics
  counter('friday_auth_attempts_total', 'Total auth attempts', metrics.security.authAttemptsTotal);
  counter('friday_auth_success_total', 'Successful auth attempts', metrics.security.authSuccessTotal);
  counter('friday_auth_failures_total', 'Failed auth attempts', metrics.security.authFailuresTotal);
  gauge('friday_active_sessions', 'Active authenticated sessions', metrics.security.activeSessions);
  counter('friday_blocked_requests_total', 'Blocked requests', metrics.security.blockedRequestsTotal);
  counter('friday_rate_limit_hits_total', 'Rate limit hits', metrics.security.rateLimitHitsTotal);
  counter('friday_injection_attempts_total', 'Injection attempts detected', metrics.security.injectionAttemptsTotal);
  counter('friday_audit_entries_total', 'Total audit log entries', metrics.security.auditEntriesTotal);
  gauge('friday_audit_chain_valid', 'Audit chain integrity (1=valid)', metrics.security.auditChainValid ? 1 : 0);

  return lines.join('\n') + '\n';
}
```

### 5.2 Register Route

In `packages/core/src/gateway/server.ts`:
```typescript
app.get('/metrics', async (request, reply) => {
  if (!config.metrics?.prometheus?.enabled) {
    return reply.code(404).send({ error: 'Prometheus metrics not enabled' });
  }
  const metrics = await secureYeoman.getMetrics();
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return formatPrometheusMetrics(metrics);
});
```

Unauthenticated by default (standard for Prometheus scraping).

### 5.3 Config

Add to `packages/shared/src/types/config.ts`:
```typescript
metrics: {
  prometheus: {
    enabled: boolean;  // default: false
    path: string;      // default: '/metrics'
  }
}
```

### 5.4 Grafana Dashboard

Create `deploy/grafana/friday-dashboard.json` covering:
- CPU/Memory usage over time
- Task throughput and success rate
- Token usage and cost tracking
- Security event counts
- Auth failure rate
- Queue depth

### 5.5 Alert Rules

Create `deploy/prometheus/alert-rules.yml`:
```yaml
groups:
  - name: friday_alerts
    rules:
      - alert: HighErrorRate
        expr: friday_tasks_success_rate < 0.9
        for: 5m
        labels: { severity: warning }
      - alert: HighMemoryUsage
        expr: friday_memory_used_mb / friday_memory_limit_mb > 0.85
        for: 10m
        labels: { severity: warning }
      - alert: AuthBruteForce
        expr: rate(friday_auth_failures_total[5m]) > 1
        for: 2m
        labels: { severity: critical }
      - alert: AuditChainBroken
        expr: friday_audit_chain_valid == 0
        for: 1m
        labels: { severity: critical }
      - alert: HighQueueDepth
        expr: friday_tasks_queue_depth > 50
        for: 5m
        labels: { severity: warning }
```

---

## Part 6: Log Aggregation (P5-008)

Pino already outputs structured JSON. Create `deploy/logging/` with shipping configs:

**`deploy/logging/docker-compose-loki.yml`** -- Loki + Promtail + Grafana stack
**`deploy/logging/promtail-config.yml`** -- Docker service discovery, JSON parsing, label extraction
**`deploy/logging/logrotate-friday`** -- Daily rotation, 30-day retention, compressed archives

---

## Part 7: OpenAPI Specification (P5-006)

Create `docs/openapi.yaml` covering all endpoints from `docs/api/rest-api.md`:
- Auth: login, refresh, logout, API keys
- Tasks: list, get
- Metrics: get
- Security: events
- Audit: query, verify
- Sandbox: status
- Soul: onboarding, personality CRUD, skills CRUD, prompt preview, config
- Brain: memories, knowledge, stats, maintenance
- Comms: identity, peers, messages
- Integrations: platforms, CRUD, start/stop, messages

Optional: Swagger UI at `/api/docs` in development mode.

---

## Part 8: Documentation & Deployment

### 8.1 Troubleshooting Guide (`docs/troubleshooting.md`)

Cover: port conflicts, database locks, AI provider connection failures, auth rate limits, dashboard loading, WebSocket disconnects, audit chain failures, sandbox violations, OOM, Docker issues.

### 8.2 Deployment Guide (`docs/deployment.md`)

Cover: bare metal (systemd), Docker Compose (recommended), reverse proxy (nginx/Caddy), monitoring stack (Prometheus + Grafana + Loki), backup strategy (SQLite WAL-safe copies).

### 8.3 Release Script (`scripts/release.sh`)

Version bump across workspaces -> build -> test -> git tag.

---

## Implementation Order

```
1. Framework improvements (ConversationManager, auto-reconnect, rate limiter)  [P5-F01..F03]
2. Discord adapter (P4-004) -- validates abstraction with second adapter
3. Slack adapter (P4-005) -- socket mode pattern
4. Prometheus metrics + Grafana/alert configs (P5-007)
5. Log aggregation configs (P5-008)
6. GitHub adapter (P4-007) -- webhook pattern, needs WebhookIntegration interface
7. OpenAPI spec (P5-006)
8. Troubleshooting + deployment docs (P5-009)
9. Release script (P5-010)
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/integrations/conversation.ts` | Create |
| `packages/core/src/integrations/conversation.test.ts` | Create |
| `packages/core/src/integrations/discord/adapter.ts` | Create |
| `packages/core/src/integrations/discord/index.ts` | Create |
| `packages/core/src/integrations/discord/discord.test.ts` | Create |
| `packages/core/src/integrations/slack/adapter.ts` | Create |
| `packages/core/src/integrations/slack/index.ts` | Create |
| `packages/core/src/integrations/slack/slack.test.ts` | Create |
| `packages/core/src/integrations/github/adapter.ts` | Create |
| `packages/core/src/integrations/github/index.ts` | Create |
| `packages/core/src/integrations/github/github.test.ts` | Create |
| `packages/core/src/gateway/prometheus.ts` | Create |
| `packages/core/src/gateway/prometheus.test.ts` | Create |
| `packages/core/src/gateway/server.ts` | Modify (add /metrics route) |
| `packages/core/src/integrations/manager.ts` | Modify (auto-reconnect, rate limiting) |
| `packages/core/src/integrations/types.ts` | Modify (platformRateLimit, WebhookIntegration) |
| `packages/shared/src/types/config.ts` | Modify (prometheus config) |
| `deploy/grafana/friday-dashboard.json` | Create |
| `deploy/prometheus/alert-rules.yml` | Create |
| `deploy/logging/docker-compose-loki.yml` | Create |
| `deploy/logging/promtail-config.yml` | Create |
| `deploy/logging/logrotate-friday` | Create |
| `docs/openapi.yaml` | Create |
| `docs/troubleshooting.md` | Create |
| `docs/deployment.md` | Create |
| `scripts/release.sh` | Create |
| `TODO.md` | Update phase structure |

---

## Acceptance Criteria

- [ ] ConversationManager preserves multi-turn context across platforms
- [ ] Auto-reconnect handles transient adapter disconnections
- [ ] Discord adapter handles slash commands and message events
- [ ] Slack adapter works in socket mode with @mentions
- [ ] GitHub adapter processes webhook events (PR, issues)
- [ ] `GET /metrics` returns Prometheus text format with all system metrics
- [ ] Grafana dashboard template imports and shows real data
- [ ] Alert rules fire on configured thresholds
- [ ] Log aggregation configs work with Docker + Loki stack
- [ ] OpenAPI spec covers all endpoints and validates against actual API
- [ ] Troubleshooting guide covers 10+ common issues
- [ ] Deployment guide covers bare metal, Docker, and reverse proxy
- [ ] Release script updates versions and creates tags
- [ ] All adapters registered via factory pattern in SecureYeoman
- [ ] At least 50 new tests for adapters and framework improvements
- [ ] All existing tests continue to pass
