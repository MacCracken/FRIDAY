# Production Hardening Implementation Prompt (Phase 5)

> Implement remaining Phase 5 items: Prometheus metrics, log aggregation, OpenAPI spec, troubleshooting guide, and production deployment improvements.

---

## Context

Already completed:
- P5-004: Docker packaging (multi-stage Dockerfile, docker-compose, non-root user, healthcheck)
- P5-005: CI/CD pipeline (lint → typecheck → test → build → security audit → docker build)
- P5-006 partial: docs/installation.md, docs/configuration.md, docs/api.md written
- Structured logging via Pino (JSON format)
- Audit chain with cryptographic integrity
- Rate limiting with metrics counters
- 589 tests with 80% coverage thresholds

Not yet implemented:
- P5-007: Prometheus metrics endpoint
- P5-008: Log aggregation configuration
- OpenAPI/Swagger spec
- Troubleshooting guide
- Release process

Current infrastructure:
- Gateway: Fastify on port 18789, local-network-only, bodyLimit 1MB
- WebSocket: /ws/metrics with 1s broadcast interval
- Database: SQLite with WAL mode (audit.db, auth.db, tasks.db, soul.db, integrations.db, rbac.db)
- CLI: `packages/core/src/cli.ts` with --port, --host, --config, --log-level flags
- CI: `.github/workflows/ci.yml` with Node 20+22 matrix

---

## Part 1: Prometheus Metrics Endpoint (P5-007)

### 1.1 Create `packages/core/src/gateway/prometheus.ts`

Expose Prometheus-format metrics at `GET /metrics` (separate from `/api/v1/metrics`):

```typescript
import type { SecureYeoman } from '../secureyeoman.js';

export function formatPrometheusMetrics(metrics: MetricsSnapshot): string {
  const lines: string[] = [];

  // Helper
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

  // Per-status counters
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

### 1.2 Register Prometheus route

In `packages/core/src/gateway/server.ts`, add:

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

Note: This is unauthenticated (standard for Prometheus scraping). If security is needed, check a bearer token or restrict to specific IPs.

### 1.3 Config expansion

Add to `packages/shared/src/types/config.ts`:
```typescript
metrics: {
  prometheus: {
    enabled: boolean;  // default: false
    path: string;      // default: '/metrics'
  }
}
```

### 1.4 Grafana dashboard template

Create `deploy/grafana/friday-dashboard.json`:
- CPU/Memory usage over time
- Task throughput and success rate
- Token usage and cost tracking
- Security event counts
- Auth failure rate
- Queue depth alarm

### 1.5 Alert rules

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

## Part 2: Log Aggregation (P5-008)

### 2.1 Structured JSON output

Pino already outputs structured JSON. Ensure consistent fields:
```json
{
  "level": 30,
  "time": 1706745600000,
  "msg": "Request completed",
  "component": "gateway",
  "method": "GET",
  "url": "/api/v1/metrics",
  "statusCode": 200,
  "responseTime": 12
}
```

### 2.2 Log shipping configuration

Create `deploy/logging/` directory with example configs:

**`deploy/logging/docker-compose-loki.yml`:**
```yaml
services:
  loki:
    image: grafana/loki:2.9.0
    ports: ["3100:3100"]
    volumes: ["loki-data:/loki"]

  promtail:
    image: grafana/promtail:2.9.0
    volumes:
      - /var/log:/var/log
      - ./promtail-config.yml:/etc/promtail/config.yml

  grafana:
    image: grafana/grafana:10.0.0
    ports: ["3001:3000"]
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"

volumes:
  loki-data:
```

**`deploy/logging/promtail-config.yml`:**
```yaml
server:
  http_listen_port: 9080
positions:
  filename: /tmp/positions.yaml
clients:
  - url: http://loki:3100/loki/api/v1/push
scrape_configs:
  - job_name: friday
    docker_sd_configs:
      - host: unix:///var/run/docker.sock
    relabel_configs:
      - source_labels: ['__meta_docker_container_name']
        regex: '.*friday.*'
        action: keep
    pipeline_stages:
      - json:
          expressions:
            level: level
            component: component
            msg: msg
      - labels:
          level:
          component:
```

### 2.3 File rotation for bare metal

Create `deploy/logging/logrotate-friday`:
```
/var/log/friday/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 friday friday
    postrotate
        kill -USR1 $(cat /var/run/friday.pid) 2>/dev/null || true
    endscript
}
```

---

## Part 3: OpenAPI Specification (P5-006)

### 3.1 Generate OpenAPI spec

Create `docs/openapi.yaml` based on the existing API documentation and actual route registrations:

The spec should cover all endpoints from `docs/api.md`:
- Auth: login, refresh, logout, API keys
- Tasks: list, get
- Metrics: get
- Security: events
- Audit: query, verify
- Sandbox: status
- Soul: onboarding, personality CRUD, skills CRUD, prompt preview, config
- Integrations: platforms, CRUD, start/stop, messages

### 3.2 Serve spec via Swagger UI

Add optional Swagger UI route:
```typescript
// In server.ts (optional, dev-only)
if (config.core.environment === 'development') {
  app.get('/api/docs', async (request, reply) => {
    reply.type('text/html');
    return `<!DOCTYPE html>
      <html><head><title>F.R.I.D.A.Y. API</title>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css">
      </head><body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
      <script>SwaggerUIBundle({ url: '/api/openapi.yaml', dom_id: '#swagger-ui' })</script>
      </body></html>`;
  });
  app.get('/api/openapi.yaml', async (request, reply) => {
    reply.type('application/yaml');
    return fs.readFileSync(path.join(__dirname, '../../docs/openapi.yaml'), 'utf-8');
  });
}
```

---

## Part 4: Troubleshooting Guide

### 4.1 Create `docs/troubleshooting.md`

Cover common issues:

1. **Port already in use** — how to find and kill the process
2. **Database locked** — WAL mode, single writer, check for orphan processes
3. **AI provider connection failed** — verify API key, check network, test with curl
4. **Auth failures** — rate limit (5/15min), clear rate limit, verify password
5. **Dashboard not loading** — Vite proxy config, CORS, check both ports (3000, 18789)
6. **WebSocket disconnects** — check reverse proxy config, timeout settings
7. **Audit chain integrity failure** — what it means, how to investigate, recovery steps
8. **Sandbox violations** — how to read violation logs, adjust allowedPaths
9. **Out of memory** — adjust maxMemoryMb in sandbox config, check for leaks
10. **Docker issues** — volume permissions, environment variables, health check failures

---

## Part 5: Production Deployment Guide

### 5.1 Create `docs/deployment.md`

Cover deployment scenarios:

1. **Bare metal (systemd)**
   - Service file for `secureyeoman`
   - Log rotation setup
   - Automatic restart on failure

2. **Docker Compose (recommended)**
   - Production docker-compose override
   - Volume management
   - Secret management (Docker secrets or .env)

3. **Reverse proxy (nginx/Caddy)**
   - TLS termination
   - WebSocket proxy configuration
   - Rate limiting at proxy level

4. **Monitoring stack**
   - Prometheus + Grafana setup
   - Loki for logs
   - Alert manager configuration

5. **Backup strategy**
   - SQLite database backup (copy WAL-mode databases safely)
   - Configuration backup
   - Restore procedure

---

## Part 6: Release Process

### 6.1 Create release script

Create `scripts/release.sh`:
```bash
#!/bin/bash
VERSION=$1
if [ -z "$VERSION" ]; then echo "Usage: ./scripts/release.sh <version>"; exit 1; fi

# Update version in all package.json files
npm version "$VERSION" --workspaces --no-git-tag-version
npm version "$VERSION" --no-git-tag-version

# Build all packages
npm run build

# Run all tests
npm test

# Create git tag
git add -A
git commit -m "Release v$VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo "Release v$VERSION prepared. Run 'git push --follow-tags' to publish."
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/core/src/gateway/prometheus.ts` | Create |
| `packages/core/src/gateway/server.ts` | Modify (add /metrics route) |
| `deploy/grafana/friday-dashboard.json` | Create |
| `deploy/prometheus/alert-rules.yml` | Create |
| `deploy/logging/docker-compose-loki.yml` | Create |
| `deploy/logging/promtail-config.yml` | Create |
| `deploy/logging/logrotate-friday` | Create |
| `docs/openapi.yaml` | Create |
| `docs/troubleshooting.md` | Create |
| `docs/deployment.md` | Create |
| `scripts/release.sh` | Create |
| `TODO.md` | Update P5-006, P5-007, P5-008 |

---

## Acceptance Criteria

- [ ] `GET /metrics` returns Prometheus text format with all system metrics
- [ ] Grafana dashboard template imports and shows real data
- [ ] Alert rules fire on configured thresholds
- [ ] Log aggregation configs work with Docker + Loki stack
- [ ] OpenAPI spec covers all endpoints and validates against actual API
- [ ] Swagger UI available in development mode
- [ ] Troubleshooting guide covers 10+ common issues
- [ ] Deployment guide covers bare metal, Docker, and reverse proxy
- [ ] Release script updates versions and creates tags
- [ ] All existing 589 tests continue to pass
