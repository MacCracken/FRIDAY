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

soul:
  enabled: true
  learningMode:
    - user_authored              # user_authored | ai_proposed | autonomous
  maxSkills: 50                  # max 200
  maxPromptTokens: 4096          # max 32000
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

### gateway

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | string | `"127.0.0.1"` | Bind address (local-only by default) |
| `port` | number | `18789` | HTTP port (1024–65535) |
| `auth.tokenExpirySeconds` | number | `3600` | JWT access token lifetime |
| `auth.refreshTokenExpirySeconds` | number | `86400` | Refresh token lifetime |

### model

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `provider` | enum | `"anthropic"` | `anthropic`, `openai`, `gemini`, `ollama` |
| `model` | string | varies | Model identifier for the chosen provider |
| `maxTokens` | number | `16384` | Max tokens per response |
| `temperature` | number | `0.7` | Sampling temperature (0.0–2.0) |
| `requestTimeoutMs` | number | `120000` | Request timeout (max 5 min) |
| `maxRetries` | number | `3` | Retry count on transient errors |

### soul

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the personality/skills system |
| `learningMode` | string[] | `["user_authored"]` | Allowed skill sources |
| `maxSkills` | number | `50` | Maximum number of skills (max 200) |
| `maxPromptTokens` | number | `4096` | Token budget for composed system prompt |

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
