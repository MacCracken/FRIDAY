# Getting Started Guide

> How to install, configure, and run F.R.I.D.A.Y.

## Prerequisites

- Node.js 20 LTS or later
- npm (project uses npm workspaces)
- Git
- API key for at least one AI provider (Anthropic, OpenAI, Google Gemini, OpenCode Zen, or Ollama)

---

## Installation

### Option 1: From Source (Recommended)

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
npm install

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Start the system
npm run dev
```

The dashboard will be available at http://localhost:3000 and the API at http://localhost:18789.

### Option 2: Docker

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
cp .env.example .env
# Edit .env with your configuration

# Run with Docker Compose
docker compose up
```

Docker Compose starts two services:

| Service | Port | Description |
|---------|------|-------------|
| `core` | 18789 | Gateway API + agent engine |
| `dashboard` | 3000 | Vite dev server for the React dashboard |

The core service runs as a non-root `friday` user with a persistent volume (`friday-data`) for SQLite databases.

#### Manual Docker build

```bash
docker build -t friday .
docker run -p 18789:18789 \
  -e SECUREYEOMAN_SIGNING_KEY="your-32-char-signing-key" \
  -e SECUREYEOMAN_TOKEN_SECRET="your-32-char-token-secret" \
  -e SECUREYEOMAN_ENCRYPTION_KEY="your-32-char-encryption-key" \
  -e SECUREYEOMAN_ADMIN_PASSWORD="your-32-char-admin-password" \
  -e ANTHROPIC_API_KEY="sk-ant-..." \
  friday
```

---

## Configuration

### Required Environment Variables

All security keys must be at least 32 characters long. Generate your own -- do not reuse examples.

```bash
# Required Security Keys
SECUREYEOMAN_SIGNING_KEY="your-signing-key-at-least-32-characters-long"
SECUREYEOMAN_TOKEN_SECRET="your-token-secret-at-least-32-characters-long"
SECUREYEOMAN_ENCRYPTION_KEY="your-encryption-key-at-least-32-characters-long"
SECUREYEOMAN_ADMIN_PASSWORD="your-admin-password-at-least-32-characters-long"
```

| Variable | Purpose |
|----------|---------|
| `SECUREYEOMAN_SIGNING_KEY` | HMAC-SHA256 signing for the audit chain |
| `SECUREYEOMAN_TOKEN_SECRET` | JWT token signing secret |
| `SECUREYEOMAN_ENCRYPTION_KEY` | AES-256-GCM encryption at rest |
| `SECUREYEOMAN_ADMIN_PASSWORD` | Admin login password for the dashboard and API |

### AI Provider Keys

At least one is required:

```bash
ANTHROPIC_API_KEY="sk-ant-..."
# or
OPENAI_API_KEY="sk-..."
# or
GOOGLE_GENERATIVE_AI_API_KEY="..."
# or
OPENCODE_API_KEY="..."
# or (for local Ollama -- no key needed, just the URL)
OLLAMA_BASE_URL="http://localhost:11434"
```

### Optional Variables

```bash
PORT=18789              # Gateway port
HOST=127.0.0.1          # Gateway bind address
LOG_LEVEL=info          # trace|debug|info|warn|error
DASHBOARD_PORT=3000     # Dashboard dev server port
DASHBOARD_HOST=127.0.0.1
NODE_ENV=development
```

### Configuration File

For advanced configuration, create `~/.secureyeoman/config.yaml`:

```yaml
version: "1.0"
core:
  name: "F.R.I.D.A.Y."
  environment: development
  log_level: info
  workspace: ~/.secureyeoman/workspace

security:
  rbac:
    enabled: true
    default_role: viewer
  encryption:
    enabled: true
    algorithm: aes-256-gcm
  sandbox:
    enabled: true
    technology: auto
  rate_limiting:
    enabled: true

model:
  provider: anthropic
  model: claude-sonnet-4-20250514
  max_tokens: 16384
  temperature: 0.7

soul:
  enabled: true
  learningMode: [user_authored]
  maxSkills: 50
  maxPromptTokens: 4096

dashboard:
  enabled: true
  port: 3000
  host: 127.0.0.1
```

See [Configuration Reference](../configuration.md) for all available fields.

---

## Quick Start

### 1. Start the System

```bash
# Start core system and dashboard
npm run dev

# Or start core only
npm run dev:core

# Or start dashboard only (requires core running)
npm run dev:dashboard
```

### 2. Access the Dashboard

Open your browser and navigate to:
- **Dashboard**: http://localhost:3000
- **API Health**: http://localhost:18789/health

### 3. First Login

1. Open the dashboard at http://localhost:3000
2. Use the admin password you set in `SECUREYEOMAN_ADMIN_PASSWORD`
3. Complete the onboarding wizard to set up your agent personality

### 4. Create Your First Task

```bash
# Using the CLI
npx secureyeoman task create \
  --type execute \
  --input '{"command": "echo Hello F.R.I.D.A.Y.!"}'

# Using the API
curl -X POST http://localhost:18789/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>" \
  -d '{
    "type": "execute",
    "input": {"command": "echo Hello F.R.I.D.A.Y.!"}
  }'
```

### 5. Monitor in Real-Time

- Watch task execution in the dashboard
- View metrics and resource usage
- Check security events in the audit log

---

## Verification

### Health Check

```bash
curl http://localhost:18789/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-02-11T00:00:00.000Z",
  "version": "1.2.0",
  "uptime": 3600
}
```

### API Test

```bash
# Login and get a token
curl -X POST http://localhost:18789/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}'

# Fetch metrics with token
curl http://localhost:18789/api/v1/metrics \
  -H "Authorization: Bearer <accessToken>"
```

### WebSocket Connection

```javascript
// Test WebSocket connection in browser console
const ws = new WebSocket('ws://localhost:18789/ws/metrics');
ws.onmessage = (event) => console.log(JSON.parse(event.data));
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: { channels: ['metrics'] }
  }));
};
```

---

## Running Tests

```bash
npm test              # All 963 tests across 59 files
npm test -- --run     # Non-watch mode
npm test -- --coverage

# Security + chaos tests
npx vitest run tests/security/ tests/chaos/
```

---

## Next Steps

### Configure AI Providers

Set up multiple AI providers for redundancy:

```bash
# Add OpenAI
export OPENAI_API_KEY="sk-..."

# Add Gemini
export GOOGLE_GENERATIVE_AI_API_KEY="..."
```

### Set Up Integrations

Configure messaging platforms via the dashboard or API. See [Integration Setup Guide](integrations.md).

### Customize Your Agent

Edit personality and skills in the dashboard Soul Manager page.

### Explore the Dashboard

- **Metrics View**: Real-time system performance
- **Task History**: Browse and search past tasks
- **Security Events**: Monitor security alerts
- **Soul Manager**: Edit personality and skills
- **Connections**: Configure platform integrations

---

## v1.2 Features

F.R.I.D.A.Y. v1.2 adds powerful new capabilities for teams and advanced workflows:

### MCP Protocol Support
Connect to external tools via the Model Context Protocol (MCP). F.R.I.D.A.Y. can:
- **Use external tools** from MCP servers (search engines, code interpreters, databases)
- **Expose its own skills** as MCP tools for other systems to invoke

Configure MCP servers in the dashboard or via the `/api/v1/mcp/` API.

### Audit Reports
Generate comprehensive audit reports with filtering by time range, event type, user, or severity. Export to JSON, HTML, or CSV for compliance and analysis.

### Team Workspaces
Multi-team support with workspace isolation. Each workspace has its own personality, skills, and access control. Perfect for shared F.R.I.D.A.Y. deployments across departments.

### A/B Testing
Compare model performance, prompt templates, or configuration changes. Create experiments with traffic allocation and automatic metric collection (latency, cost, success rate).

### Skill Marketplace
Discover and share skills with the community. Search, install, and publish skills with cryptographic signature verification.

### Cost Optimization
Get AI-powered recommendations to reduce costs based on your usage patterns. Suggests model changes, caching strategies, and configuration tweaks.

---

## Troubleshooting

### Port Already in Use

```bash
lsof -i :18789
lsof -i :3000
# Kill the process or change ports via env vars
```

### Database Locked

If another instance is running, stop it first. SQLite uses WAL mode and only supports a single writer.

### AI Provider Connection Failed

Verify your API key is valid and you have network access to the provider's API endpoint.

### Debug Mode

```bash
LOG_LEVEL=debug npm run dev
```

For more troubleshooting help, see the [Troubleshooting Guide](../troubleshooting.md).

---

## Production Deployment

For production deployment considerations (systemd, Docker, reverse proxy, monitoring), see the [Deployment Guide](../deployment.md).

---

## Related Documentation

- [Configuration Reference](../configuration.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)
- [Deployment Guide](../deployment.md)
- [Troubleshooting Guide](../troubleshooting.md)
