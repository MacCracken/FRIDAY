# Configuration Guide

> Complete configuration reference for F.R.I.D.A.Y.

## Table of Contents

1. [Configuration Overview](#configuration-overview)
2. [Environment Variables](#environment-variables)
3. [Configuration File](#configuration-file)
4. [Security Configuration](#security-configuration)
5. [AI Provider Configuration](#ai-provider-configuration)
6. [Database Configuration](#database-configuration)
7. [Network Configuration](#network-configuration)
8. [Logging Configuration](#logging-configuration)
9. [Examples](#examples)

---

## Configuration Overview

F.R.I.D.A.Y. supports multiple configuration methods:

1. **Environment Variables** - Priority 1 (overrides all)
2. **Configuration File** - `~/.secureyeoman/config.yaml` (YAML format)
3. **Default Values** - Built-in fallbacks

### Configuration Precedence

```
Environment Variables > Config File > Defaults
```

---

## Environment Variables

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SECUREYEOMAN_SIGNING_KEY` | HMAC signing key for audit chain | `your-32-char-signing-key` |
| `SECUREYEOMAN_TOKEN_SECRET` | JWT token signing secret | `your-32-char-token-secret` |
| `SECUREYEOMAN_ENCRYPTION_KEY` | Encryption key for sensitive data | `your-32-char-encryption-key` |
| `SECUREYEOMAN_ADMIN_PASSWORD` | Default admin password | `your-32-char-admin-password` |

### AI Provider Variables (at least one required)

| Variable | Description | Example |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | `sk-ant-...` |
| `OPENAI_API_KEY` | OpenAI GPT API key | `sk-...` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key | `AI...` |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment: `development`, `staging`, `production` |
| `PORT` | `18789` | Gateway server port |
| `HOST` | `127.0.0.1` | Gateway server host |
| `DASHBOARD_PORT` | `3000` | Dashboard port |
| `DASHBOARD_HOST` | `127.0.0.1` | Dashboard host |
| `LOG_LEVEL` | `info` | Logging level: `trace`, `debug`, `info`, `warn`, `error` |
| `DATABASE_PATH` | `./data/friday.db` | SQLite database path |
| `WORKSPACE_PATH` | `~/.secureyeoman/workspace` | Agent workspace directory |

### Security Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMITING_ENABLED` | `true` | Enable rate limiting |
| `SANDBOX_ENABLED` | `true` | Enable sandboxing |
| `ENCRYPTION_ENABLED` | `true` | Enable encryption at rest |
| `RBAC_ENABLED` | `true` | Enable role-based access control |

### Metrics Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_ENABLED` | `true` | Enable metrics collection |
| `PROMETHEUS_PORT` | `9090` | Prometheus metrics port |
| `WEBSOCKET_METRICS_PORT` | `18790` | WebSocket metrics port |

---

## Configuration File

Create `~/.secureyeoman/config.yaml` for advanced configuration:

```yaml
version: "1.0"

# Core Settings
core:
  name: "F.R.I.D.A.Y."
  environment: development
  log_level: info
  workspace: ~/.secureyeoman/workspace
  
# Server Configuration
server:
  port: 18789
  host: 127.0.0.1
  
# Dashboard Configuration
dashboard:
  enabled: true
  port: 3000
  host: 127.0.0.1
  
# Database Configuration
database:
  type: sqlite
  path: ~/.secureyeoman/data/friday.db
  backup_enabled: true
  backup_interval: 24h
  retention_days: 30
```

---

## Security Configuration

### Authentication & Authorization

```yaml
security:
  # Role-Based Access Control
  rbac:
    enabled: true
    default_role: viewer
    role_cache_ttl: 300s
    
  # Authentication Settings
  auth:
    jwt:
      algorithm: HS256
      access_token_ttl: 3600s
      refresh_token_ttl: 86400s
      issuer: "friday"
      
    api_keys:
      length: 32
      prefix: "sk-"
      rate_limit: true
      
  # Encryption Settings
  encryption:
    enabled: true
    algorithm: aes-256-gcm
    key_derivation:
      algorithm: scrypt
      params:
        n: 16384
        r: 8
        p: 1
        
  # Rate Limiting
  rate_limiting:
    enabled: true
    storage: memory
    default_rules:
      - name: api_requests
        window: 60s
        max_requests: 100
        key: ip_address
      - name: auth_attempts
        window: 900s
        max_requests: 5
        key: ip_address
        block_duration: 1800s
```

### Sandbox Configuration

```yaml
sandbox:
  enabled: true
  technology: auto  # auto, seccomp, landlock, none
  
  # Resource Limits
  limits:
    memory:
      soft_limit: 512MB
      hard_limit: 1GB
      
    cpu:
      max_percent: 50
      nice_level: 10
      
    disk:
      max_write_per_task: 100MB
      temp_dir_quota: 500MB
      
    network:
      max_connections: 10
      bandwidth_limit: 10Mbps
      
    time:
      task_timeout: 300s
      idle_timeout: 60s
      
  # Filesystem Access
  filesystem:
    allowed_read_paths:
      - ~/.secureyeoman/workspace/**
      - ~/.secureyeoman/config/**
      - /tmp/secureyeoman/**
      
    allowed_write_paths:
      - ~/.secureyeoman/workspace/**
      - /tmp/secureyeoman/**
      
    allowed_execute_paths:
      - /tmp/secureyeoman/sandbox/**
```

---

## AI Provider Configuration

### Multi-Provider Setup

```yaml
model:
  # Primary Provider
  provider: anthropic
  model: claude-sonnet-4-20250514
  api_key_env: ANTHROPIC_API_KEY
  
  # Fallback Providers
  fallback_providers:
    - provider: openai
      model: gpt-4o
      api_key_env: OPENAI_API_KEY
      
    - provider: gemini
      model: gemini-2.0-flash
      api_key_env: GOOGLE_GENERATIVE_AI_API_KEY
      
    - provider: ollama
      model: llama3.1:8b
      base_url: http://localhost:11434
      
  # Model Settings
  settings:
    max_tokens: 16384
    temperature: 0.7
    top_p: 0.9
    
  # Retry Configuration
  retry:
    max_attempts: 3
    base_delay: 1s
    max_delay: 30s
    jitter: true
    
  # Cost Tracking
  cost_tracking:
    enabled: true
    daily_limit_usd: 50.0
    alert_threshold: 0.8
```

### Provider-Specific Settings

#### Anthropic Claude
```yaml
anthropic:
  api_key_env: ANTHROPIC_API_KEY
  base_url: https://api.anthropic.com
  max_requests_per_minute: 1000
  max_tokens_per_minute: 400000
  
  # Model-specific settings
  models:
    claude-sonnet-4-20250514:
      max_tokens: 200000
      input_cost_per_1k: 0.015
      output_cost_per_1k: 0.075
```

#### OpenAI GPT
```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com
  organization: org-...
  
  models:
    gpt-4o:
      max_tokens: 128000
      input_cost_per_1k: 0.005
      output_cost_per_1k: 0.015
```

#### Google Gemini
```yaml
gemini:
  api_key_env: GOOGLE_GENERATIVE_AI_API_KEY
  base_url: https://generativelanguage.googleapis.com
  
  models:
    gemini-2.0-flash:
      max_tokens: 1048576
      input_cost_per_1k: 0.000125
      output_cost_per_1k: 0.000375
```

#### Ollama (Local)
```yaml
ollama:
  base_url: http://localhost:11434
  timeout: 120s
  max_concurrent_requests: 3
  
  models:
    llama3.1:8b:
      context_length: 128000
    codellama:7b:
      context_length: 16384
```

---

## Database Configuration

### SQLite Configuration
```yaml
database:
  type: sqlite
  path: ~/.secureyeoman/data/friday.db
  
  # SQLite Settings
  sqlite:
    journal_mode: WAL
    synchronous: NORMAL
    cache_size: 64MB
    temp_store: memory
    
  # Backup Settings
  backup:
    enabled: true
    interval: 24h
    retention: 30d
    compression: gzip
    
  # Migration Settings
  migration:
    auto_migrate: true
    backup_before: true
    
  # Performance Settings
  performance:
    connection_pool_size: 10
    query_timeout: 30s
    max_connections: 100
```

### PostgreSQL Configuration (Optional)
```yaml
database:
  type: postgresql
  host: localhost
  port: 5432
  database: friday
  username: friday_user
  password_env: FRIDAY_DB_PASSWORD
  ssl_mode: require
  
  # Connection Pool
  pool:
    min: 5
    max: 20
    idle_timeout: 30s
    
  # Performance
  performance:
    statement_timeout: 30s
    query_timeout: 60s
    max_connections: 100
```

---

## Network Configuration

### Gateway Server
```yaml
gateway:
  # Server Settings
  host: 127.0.0.1
  port: 18789
  
  # TLS/SSL
  tls:
    enabled: false  # Set to true for production
    cert_path: ~/.secureyeoman/certs/server.crt
    key_path: ~/.secureyeoman/certs/server.key
    ca_path: ~/.secureyeoman/certs/ca.crt
    
  # Request Settings
  request:
    body_limit: 10MB
    timeout: 30s
    keep_alive_timeout: 65s
    
  # CORS
  cors:
    enabled: true
    origins: ["http://localhost:3000"]
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    headers: ["Content-Type", "Authorization", "X-API-Key"]
```

### WebSocket Server
```yaml
websocket:
  enabled: true
  port: 18790
  path: /ws
  
  # Connection Settings
  connection:
    max_connections: 100
    heartbeat_interval: 30s
    timeout: 300s
    
  # Message Settings
  message:
    max_size: 1MB
    rate_limit: 100/minute
    
  # Compression
  compression:
    enabled: true
    level: 6
```

### Network Security
```yaml
network_security:
  # Domain Whitelist
  allowlist:
    enabled: true
    domains:
      - api.anthropic.com
      - api.openai.com
      - generativelanguage.googleapis.com
      - *.githubusercontent.com
      
  # IP Filtering
  ip_filtering:
    enabled: false
    allowed_ips: []
    blocked_ips: []
    
  # DNS Settings
  dns:
    resolver: system  # system, cloudflare, google
    dnssec: required
    doh: preferred
```

---

## Logging Configuration

### Log Levels and Outputs
```yaml
logging:
  level: info
  format: json
  
  # Output Destinations
  outputs:
    - type: file
      path: ~/.secureyeoman/logs/friday.log
      rotation: daily
      compression: gzip
      retention: 30d
      
    - type: console
      format: pretty
      colorize: true
      
    - type: file
      path: ~/.secureyeoman/logs/audit.log
      level: security
      rotation: hourly
      retention: 365d
      
  # Log Fields
  fields:
    timestamp: true
    level: true
    message: true
    request_id: true
    user_id: true
    ip_address: true
    user_agent: true
    duration: true
```

### Audit Logging
```yaml
audit:
  enabled: true
  
  # Chain Verification
  chain_verification:
    enabled: true
    interval: hourly
    
  # Storage Settings
  storage:
    type: sqlite
    path: ~/.secureyeoman/data/audit.db
    backup: true
    
  # Retention
  retention:
    default: 7 years
    security_events: 7 years
    performance_logs: 90 days
    
  # Integrity
  integrity:
    signature_algorithm: HMAC-SHA256
    hash_algorithm: SHA-256
    verify_on_read: true
```

---

## Soul System Configuration

### Personality and Skills
```yaml
soul:
  enabled: true
  
  # Learning Modes
  learning_mode: [user_authored]  # user_authored, ai_proposed, autonomous
  
  # Personality Settings
  personality:
    max_personalities: 10
    max_traits: 20
    max_system_prompt_tokens: 4000
    
  # Skills Settings
  skills:
    max_skills: 50
    max_skill_prompt_tokens: 1000
    approval_required: ai_proposed
    
  # Prompt Composition
  prompt_composition:
    max_total_tokens: 4096
    priority_by_usage: true
    include_timestamp: false
```

---

## Examples

### Development Configuration
```yaml
# ~/.secureyeoman/config.yaml
version: "1.0"
core:
  environment: development
  log_level: debug
  
security:
  rbac:
    enabled: true
  sandbox:
    enabled: false  # Disabled for easier debugging
  
model:
  provider: anthropic
  settings:
    temperature: 0.9
    max_tokens: 4096
    
dashboard:
  enabled: true
  port: 3000
```

### Production Configuration
```yaml
# ~/.secureyeoman/config.yaml
version: "1.0"
core:
  environment: production
  log_level: warn
  
security:
  rbac:
    enabled: true
  sandbox:
    enabled: true
  encryption:
    enabled: true
  rate_limiting:
    enabled: true
    
gateway:
  tls:
    enabled: true
    cert_path: /etc/ssl/certs/friday.crt
    key_path: /etc/ssl/private/friday.key
    
database:
  type: postgresql
  backup:
    enabled: true
    interval: 6h
    
logging:
  level: warn
  outputs:
    - type: file
      path: /var/log/friday/friday.log
      rotation: hourly
```

### Local Development with Ollama
```yaml
# ~/.secureyeoman/config.yaml
version: "1.0"
core:
  environment: development
  
model:
  provider: ollama
  base_url: http://localhost:11434
  model: llama3.1:8b
  
sandbox:
  enabled: true
  limits:
    memory:
      soft_limit: 2GB
      hard_limit: 4GB
```

---

## Configuration Validation

F.R.I.D.A.Y. validates configuration on startup:

### Validation Checks
1. **Required Variables** - All required environment variables present
2. **AI Provider** - At least one provider configured
3. **Security Keys** - Minimum length requirements met
4. **File Paths** - Writable directories exist
5. **Network Ports** - Ports are available
6. **Database** - Database connection successful

### Validation Errors

Common validation errors and solutions:

| Error | Solution |
|--------|----------|
| `SECUREYEOMAN_SIGNING_KEY required` | Generate and set a 32+ character key |
| `No AI provider configured` | Set at least one provider API key |
| `Port 18789 already in use` | Change PORT or stop conflicting service |
| `Cannot write to workspace` | Create directory or fix permissions |
| `Database connection failed` | Check DATABASE_PATH and permissions |

---

## Environment-Specific Configurations

### Development (NODE_ENV=development)
- Debug logging enabled
- Hot reload for dashboard
- Relaxed security settings (optional)
- Source maps enabled

### Staging (NODE_ENV=staging)
- Production-like configuration
- Detailed logging
- Enhanced monitoring
- Staging database

### Production (NODE_ENV=production)
- Optimized performance
- Minimal logging
- Maximum security
- TLS/SSL required

---

## Related Documentation

- [Getting Started Guide](getting-started.md)
- [Security Model](../security/security-model.md)
- [API Reference](../api/)
- [Deployment Guide](deployment.md)

---

*Configuration options evolve as F.R.I.D.A.Y. develops. Check for updates in newer versions.*