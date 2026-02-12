# Configuration Reference

> All YAML configuration fields, environment variables, and CLI flags for F.R.I.D.A.Y.

---

## Configuration Loading Order

Settings are resolved in this order (later overrides earlier):

1. Built-in defaults
2. YAML config file
3. Environment variables
4. CLI flags

### Config File Search Paths

If no `--config` flag is given, the system searches these paths in order:

1. `./secureyeoman.yaml`
2. `./secureyeoman.yml`
3. `./config/secureyeoman.yaml`
4. `~/.secureyeoman/config.yaml`
5. `/etc/secureyeoman/config.yaml`

---

## CLI Flags

```
secureyeoman [options]

Options:
  -p, --port <number>      Gateway port (default: 18789)
  -H, --host <string>      Gateway bind address (default: 127.0.0.1)
  -c, --config <path>      Path to YAML config file
  -l, --log-level <level>  Log level: trace|debug|info|warn|error|fatal
      --tls                Enable TLS (auto-generates dev certs if needed)
  -v, --version            Show version number
  -h, --help               Show help
```

Examples:

```bash
secureyeoman                           # Start with defaults
secureyeoman --port 3001               # Custom port
secureyeoman --config friday.yaml      # Custom config file
secureyeoman --log-level debug         # Verbose logging
```

---

## YAML Configuration

### Complete Example

```yaml
version: "1.0"

core:
  name: "SecureYeoman"
  environment: development       # development | staging | production
  logLevel: info                 # trace | debug | info | warn | error
  workspace: ~/.secureyeoman/workspace
  dataDir: ~/.secureyeoman/data

security:
  rbac:
    enabled: true
    defaultRole: viewer          # admin | operator | auditor | viewer

  encryption:
    enabled: true
    algorithm: aes-256-gcm
    keyEnv: SECUREYEOMAN_ENCRYPTION_KEY

  sandbox:
    enabled: true
    technology: auto             # auto | seccomp | landlock | none
    allowedReadPaths: []
    allowedWritePaths: []
    maxMemoryMb: 1024            # max 4096
    maxCpuPercent: 50            # max 100
    maxFileSizeMb: 100           # max 10240
    networkAllowed: true

  rateLimiting:
    enabled: true
    defaultWindowMs: 60000       # max 3600000 (1 hour)
    defaultMaxRequests: 100      # max 10000
    redisUrl: redis://localhost:6379  # optional — enables distributed rate limiting
    redisPrefix: friday:rl       # optional — Redis key prefix (max 64 chars)

  inputValidation:
    maxInputLength: 100000
    maxFileSize: 10485760        # bytes, max 100 MB
    enableInjectionDetection: true

  secretBackend: auto            # auto | keyring | env | file

  rotation:
    enabled: false
    checkIntervalMs: 3600000
    warningDaysBeforeExpiry: 7
    tokenRotationIntervalDays: 30
    signingKeyRotationIntervalDays: 90

logging:
  level: info
  format: json                   # json | pretty

  output:
    - type: file
      path: ./logs/app.log
      rotation: daily            # hourly | daily | weekly
      retention: 30d
      maxSize: 100MB

    - type: stdout
      format: pretty

  audit:
    enabled: true
    chainVerification: hourly    # hourly | daily | never
    signingKeyEnv: SECUREYEOMAN_SIGNING_KEY

metrics:
  enabled: true
  export:
    prometheus:
      enabled: false
      port: 9090
      path: /metrics
    websocket:
      enabled: true
      port: 18790
      updateIntervalMs: 1000
  retention:
    rawDataHours: 24
    aggregatedDataDays: 30

gateway:
  host: 127.0.0.1
  port: 18789
  tls:
    enabled: false
    certPath: /path/to/cert.pem
    keyPath: /path/to/key.pem
    caPath: /path/to/ca.pem
  cors:
    enabled: true
    origins:
      - http://localhost:3000
  auth:
    tokenSecret: SECUREYEOMAN_TOKEN_SECRET
    tokenExpirySeconds: 3600           # max 86400 (1 day)
    refreshTokenExpirySeconds: 86400   # max 604800 (1 week)
    adminPasswordEnv: SECUREYEOMAN_ADMIN_PASSWORD

model:
  provider: anthropic            # anthropic | openai | gemini | ollama
  model: claude-sonnet-4-20250514
  apiKeyEnv: ANTHROPIC_API_KEY
  baseUrl: ""                    # optional override
  maxTokens: 16384               # max 200000
  temperature: 0.7               # 0.0 - 2.0
  maxRequestsPerMinute: 60       # max 1000
  maxTokensPerDay: null          # optional limit
  requestTimeoutMs: 120000       # max 300000 (5 min)
  maxRetries: 3                  # max 10
  retryDelayMs: 1000
  fallbacks:                     # up to 5 fallback models (tried on 429/502/503)
    - provider: openai
      model: gpt-4o
      apiKeyEnv: OPENAI_API_KEY
    - provider: gemini
      model: gemini-2.0-flash
      apiKeyEnv: GOOGLE_GENERATIVE_AI_API_KEY

soul:
  enabled: true
  learningMode:
    - user_authored              # user_authored | ai_proposed | autonomous
  maxSkills: 50                  # max 200
  maxPromptTokens: 4096          # max 32000

heartbeat:
  enabled: true
  intervalMs: 60000              # check every 60 seconds
  checks:
    - name: system_health
      type: system_health
      enabled: true
    - name: memory_status
      type: memory_status
      enabled: true
    - name: log_anomalies
      type: log_anomalies
      enabled: true

externalBrain:
  enabled: false
  provider: obsidian             # obsidian | git_repo | filesystem
  path: ~/Repos/second-brain
  subdir: "30 - Resources/FRIDAY"
  syncIntervalMs: 0              # 0 = manual sync only
  syncMemories: true
  syncKnowledge: true
  includeFrontmatter: true
  tagPrefix: "friday/"
```

---

## Section Details

### core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `"SecureYeoman"` | Display name for the agent |
| `environment` | enum | `"development"` | `development`, `staging`, or `production` |
| `logLevel` | enum | `"info"` | `trace`, `debug`, `info`, `warn`, `error` |
| `workspace` | string | `~/.secureyeoman/workspace` | Working directory for agent operations |
| `dataDir` | string | `~/.secureyeoman/data` | SQLite database directory |

### security.rbac

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable role-based access control |
| `defaultRole` | enum | `"viewer"` | Default role for new users: `admin`, `operator`, `auditor`, `viewer` |

### security.sandbox

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable sandboxed execution |
| `technology` | enum | `"auto"` | `auto`, `seccomp`, `landlock`, `none` |
| `allowedReadPaths` | string[] | `[]` | Filesystem paths allowed for reading |
| `allowedWritePaths` | string[] | `[]` | Filesystem paths allowed for writing |
| `maxMemoryMb` | number | `1024` | Memory limit in MB (max 4096) |
| `maxCpuPercent` | number | `50` | CPU usage limit (max 100) |
| `maxFileSizeMb` | number | `100` | Max file size in MB (max 10240) |
| `networkAllowed` | boolean | `true` | Allow network access from sandbox |

### security.rateLimiting

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable rate limiting |
| `defaultWindowMs` | number | `60000` | Sliding window size in ms |
| `defaultMaxRequests` | number | `100` | Max requests per window |
| `redisUrl` | string | — | Redis URL for distributed rate limiting (optional) |
| `redisPrefix` | string | `"friday:rl"` | Key prefix for Redis entries (max 64 chars) |

### gateway

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `"127.0.0.1"` | Bind address (local-only by default) |
| `port` | number | `18789` | HTTP port (1024–65535) |
| `tls.enabled` | boolean | `false` | Enable TLS/HTTPS |
| `tls.certPath` | string | — | Path to server certificate PEM |
| `tls.keyPath` | string | — | Path to server private key PEM |
| `tls.caPath` | string | — | Path to CA certificate PEM (enables mTLS when set) |
| `auth.tokenExpirySeconds` | number | `3600` | JWT access token lifetime |
| `auth.refreshTokenExpirySeconds` | number | `86400` | Refresh token lifetime |

When `tls.caPath` is provided, the server enables mutual TLS (mTLS): clients must present a certificate signed by the specified CA. The client certificate CN is used as the authenticated user identity with `operator` role.

Use the `--tls` CLI flag for development — it auto-generates a self-signed CA and server certificate in `~/.secureyeoman/dev-certs/`.

### model

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | enum | `"anthropic"` | `anthropic`, `openai`, `gemini`, `ollama` |
| `model` | string | varies | Model identifier for the chosen provider |
| `maxTokens` | number | `16384` | Max tokens per response |
| `temperature` | number | `0.7` | Sampling temperature (0.0–2.0) |
| `requestTimeoutMs` | number | `120000` | Request timeout (max 5 min) |
| `maxRetries` | number | `3` | Retry count on transient errors |
| `fallbacks` | array | `[]` | Ordered list of fallback models (max 5). Tried on rate limit (429) or provider unavailability (502/503). |

### model.fallbacks[]

Each entry in the `fallbacks` array configures an alternative model to try when the primary (or a preceding fallback) returns a rate-limit or unavailability error. Fields not set inherit from the primary `model` config.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | enum | Yes | `anthropic`, `openai`, `gemini`, `ollama` |
| `model` | string | Yes | Model identifier for the provider |
| `apiKeyEnv` | string | Yes | Environment variable holding the API key |
| `baseUrl` | string | No | Provider base URL override |
| `maxTokens` | number | No | Max tokens per response (inherits from primary) |
| `temperature` | number | No | Sampling temperature (inherits from primary) |
| `requestTimeoutMs` | number | No | Request timeout in ms (inherits from primary) |

### soul

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the personality/skills system |
| `learningMode` | string[] | `["user_authored"]` | Allowed skill sources |
| `maxSkills` | number | `50` | Maximum number of skills (max 200) |
| `maxPromptTokens` | number | `4096` | Token budget for composed system prompt |

### heartbeat

Periodic self-check system that monitors system health, memory status, and log anomalies.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the heartbeat system |
| `intervalMs` | number | `60000` | Check interval in milliseconds (min: 5000, max: 3600000) |
| `checks` | array | *(see below)* | List of checks to run each heartbeat |

#### heartbeat.checks[]

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | — | Display name for the check |
| `type` | enum | — | `system_health`, `memory_status`, `log_anomalies`, `integration_health`, `custom` |
| `enabled` | boolean | `true` | Whether this check is active |
| `config` | object | `{}` | Type-specific configuration |

Default checks: `system_health`, `memory_status`, `log_anomalies`.

### externalBrain

Sync Brain memories and knowledge to an external program (e.g. Obsidian vault, git repo).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable external brain sync |
| `provider` | enum | `"obsidian"` | `obsidian`, `git_repo`, or `filesystem` |
| `path` | string | `""` | Absolute path to vault/repo root |
| `subdir` | string | `""` | Subdirectory for FRIDAY notes (e.g. `"30 - Resources/FRIDAY"`) |
| `syncIntervalMs` | number | `0` | Auto-sync interval in ms (0 = manual only) |
| `syncMemories` | boolean | `true` | Export memories as Markdown files |
| `syncKnowledge` | boolean | `true` | Export knowledge as Markdown files |
| `includeFrontmatter` | boolean | `true` | Include YAML frontmatter with metadata |
| `tagPrefix` | string | `"friday/"` | Prefix for Obsidian tags |

Example:
```yaml
externalBrain:
  enabled: true
  provider: obsidian
  path: /home/user/Repos/second-brain
  subdir: "30 - Resources/FRIDAY"
  syncIntervalMs: 300000  # every 5 minutes
  tagPrefix: "friday/"
```

---

### logging

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | enum | `"info"` | `trace`, `debug`, `info`, `warn`, `error` |
| `format` | enum | `"json"` | `json` or `pretty` |

### logging.output[] (file writer)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | enum | — | `file` or `stdout` |
| `path` | string | — | Log file path (for `file` type) |
| `rotation` | enum | `"daily"` | `hourly`, `daily`, or `weekly` |
| `retention` | string | `"30d"` | Retention period |
| `maxSize` | string | `"100MB"` | Max file size before rotation |

### Log Rotation

The `LogRotator` supports size-based and age-based rotation with optional gzip compression:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSizeBytes` | number | `104857600` | Max log file size in bytes (100MB) |
| `maxAgeDays` | number | `30` | Delete rotated files older than this |
| `retentionDays` | number | `90` | Total retention period for rotated files |
| `compressRotated` | boolean | `true` | Gzip compress rotated log files |

### Prometheus Metrics

The `/metrics` endpoint exposes Prometheus-compatible metrics. It is served on the main gateway port and does not require authentication by default.

Configure via the `metrics.export.prometheus` section in the YAML config:

```yaml
metrics:
  export:
    prometheus:
      enabled: true
      path: /metrics
```

See `deploy/prometheus/alert-rules.yml` for pre-built alert rules and `deploy/grafana/friday-dashboard.json` for a Grafana dashboard.

---

## Integration Configuration

Platform integrations (Telegram, Discord, etc.) are configured at runtime, not in the YAML config file. Bot tokens and credentials are stored in the SQLite integrations database and managed via the dashboard UI or REST API.

```
# Create a Telegram integration via API:
POST /api/v1/integrations
{
  "platform": "telegram",
  "displayName": "My Telegram Bot",
  "enabled": true,
  "config": { "botToken": "<your-bot-token>" }
}

# Then start it:
POST /api/v1/integrations/:id/start
```

Or use the dashboard **Connections** page to connect with a form.

---

## Environment Variables

All security-sensitive values are referenced by environment variable name in the config file (never stored directly).

| Variable | Required | Description |
|----------|----------|-------------|
| `SECUREYEOMAN_SIGNING_KEY` | Yes | Audit chain HMAC-SHA256 signing key (32+ chars) |
| `SECUREYEOMAN_TOKEN_SECRET` | Yes | JWT signing secret (32+ chars) |
| `SECUREYEOMAN_ENCRYPTION_KEY` | Yes | AES-256-GCM encryption key (32+ chars) |
| `SECUREYEOMAN_ADMIN_PASSWORD` | Yes | Admin login password (32+ chars) |
| `ANTHROPIC_API_KEY` | One AI key required | Anthropic Claude API key |
| `OPENAI_API_KEY` | One AI key required | OpenAI GPT API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | One AI key required | Google Gemini API key |
| `OLLAMA_BASE_URL` | Optional | Ollama server URL (default: `http://localhost:11434`) |
| `PORT` | No | Gateway port override |
| `HOST` | No | Gateway host override |
| `LOG_LEVEL` | No | Log level override |
| `NODE_ENV` | No | Node environment (`development`, `production`) |
