# Getting Started Guide

> Quick start guide for installing and running F.R.I.D.A.Y.

## Prerequisites

- Node.js 20 LTS or later
- pnpm (recommended) or npm
- Git
- API key for at least one AI provider (Anthropic, OpenAI, Google Gemini, or Ollama)

---

## Installation

### Option 1: Quick Install (Recommended)

```bash
# Clone the repository
git clone https://github.com/MacCracken/FRIDAY.git
cd friday

# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Start the system
pnpm dev
```

### Option 2: Docker

```bash
# Clone the repository
git clone https://github.com/MacCracken/FRIDAY.git
cd friday

# Create environment file
cp .env.example .env
# Edit .env with your configuration

# Run with Docker Compose
docker compose up
```

### Option 3: npm (if not using pnpm)

```bash
# Clone the repository
git clone https://github.com/MacCracken/FRIDAY.git
cd friday

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env with your configuration

# Start the system
npm run dev
```

---

## Configuration

### Environment Variables

Create a `.env` file with the following required variables:

```bash
# Required Security Keys (generate these yourself)
SECUREYEOMAN_SIGNING_KEY="your-signing-key-at-least-32-characters-long"
SECUREYEOMAN_TOKEN_SECRET="your-token-secret-at-least-32-characters-long"
SECUREYEOMAN_ENCRYPTION_KEY="your-encryption-key-at-least-32-characters-long"
SECUREYEOMAN_ADMIN_PASSWORD="your-admin-password-at-least-32-characters-long"

# Required: At least one AI provider
ANTHROPIC_API_KEY="sk-ant-..."
# OR
OPENAI_API_KEY="sk-..."
# OR
GOOGLE_GENERATIVE_AI_API_KEY="..."
# OR (for local Ollama)
OLLAMA_BASE_URL="http://localhost:11434"
```

### Optional Environment Variables

```bash
# Server Configuration
PORT=18789
HOST=127.0.0.1
LOG_LEVEL=info

# Dashboard
DASHBOARD_PORT=3000
DASHBOARD_HOST=127.0.0.1

# Database
DATABASE_PATH="./data/friday.db"

# Metrics
PROMETHEUS_PORT=9090
METRICS_ENABLED=true

# Development
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

metrics:
  enabled: true
  export:
    prometheus:
      enabled: true
      port: 9090
    websocket:
      enabled: true
      port: 18790
```

---

## Quick Start

### 1. Start the System

```bash
# Start core system and dashboard
pnpm dev

# Or start core only
pnpm dev:core

# Or start dashboard only (requires core running)
pnpm dev:dashboard
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
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600
}
```

### API Test

```bash
# Get metrics
curl http://localhost:18789/api/v1/metrics \
  -H "Authorization: Bearer <your-jwt-token>"
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

## Next Steps

### 1. Configure AI Providers

Set up multiple AI providers for redundancy:

```bash
# Add OpenAI
export OPENAI_API_KEY="sk-..."

# Add Gemini
export GOOGLE_GENERATIVE_AI_API_KEY="..."

# Configure provider priority in config.yaml
model:
  provider: anthropic
  fallback_providers: [openai, gemini, ollama]
```

### 2. Set Up Integrations

Configure messaging platforms:

```bash
# Telegram Bot
export TELEGRAM_BOT_TOKEN="..."

# Discord Bot
export DISCORD_BOT_TOKEN="..."
```

### 3. Customize Your Agent

Edit personality and skills in the dashboard or via API:

```bash
# Update agent name
curl -X PUT http://localhost:18789/api/v1/soul/agent-name \
  -H "Authorization: Bearer <token>" \
  -d '{"name": "MyAssistant"}'
```

### 4. Explore the Dashboard

- **Metrics View**: Real-time system performance
- **Task History**: Browse and search past tasks
- **Security Events**: Monitor security alerts
- **Soul Manager**: Edit personality and skills
- **Connections**: Configure platform integrations

---

## Troubleshooting

### Common Issues

#### Port Already in Use

```bash
# Check what's using the port
lsof -i :18789
lsof -i :3000

# Kill the process or change the port
export PORT=18790
export DASHBOARD_PORT=3001
```

#### Permission Denied

```bash
# Check file permissions
ls -la ~/.secureyeoman/

# Fix permissions if needed
chmod 700 ~/.secureyeoman/
chmod 600 ~/.secureyeoman/config.yaml
```

#### AI Provider Connection Failed

```bash
# Test API key
curl -H "x-api-key: $ANTHROPIC_API_KEY" \
  https://api.anthropic.com/v1/messages

# Check network connectivity
ping api.anthropic.com
```

#### Database Locked

```bash
# Check if another instance is running
ps aux | grep secureyeoman

# Remove lock file if needed
rm ~/.secureyeoman/data/friday.db-wal
```

### Getting Help

- **Documentation**: [Development Roadmap](../development/roadmap.md)
- **Architecture**: [Architecture Overview](../development/architecture.md)
- **Security**: [Security Model](../security/security-model.md)

### Debug Mode

Enable debug logging:

```bash
export LOG_LEVEL=debug
pnpm dev
```

Check logs for detailed error information.

---

## Production Deployment

Key considerations for production:

- Use environment variables instead of `.env` file
- Enable TLS via `--tls` flag or config
- Set up proper firewall rules
- Configure backup and monitoring
- Use process manager like PM2 or systemd
- See `docs/configuration.md` for full configuration reference

---

## Related Documentation

- [Configuration Reference](../configuration.md)
- [API Reference](../api/)
- [Security Model](../security/security-model.md)

---

Welcome to F.R.I.D.A.Y.! Your secure digital assistant is ready to help. 🚀