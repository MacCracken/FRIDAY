# Installation Guide

> How to install and run F.R.I.D.A.Y. from source, Docker, or npm.

---

## Prerequisites

- **Node.js** 20 LTS or later
- **pnpm** (recommended) or npm
- **Git**
- At least one AI provider API key (Anthropic, OpenAI, Google Gemini, or Ollama running locally)

---

## Option 1: From Source (Recommended)

```bash
# Clone the repository
git clone https://github.com/MacCracken/FRIDAY.git
cd friday

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
```

Edit `.env` with your security keys and AI provider key (see [Environment Variables](#environment-variables) below).

```bash
# Start the system (core + dashboard)
pnpm dev
```

The dashboard will be available at http://localhost:3000 and the API at http://localhost:18789.

---

## Option 2: Docker

```bash
# Clone and configure
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
| `dashboard` | 5173 | Vite dev server for the React dashboard |

The core service runs as a non-root `friday` user with a persistent volume (`friday-data`) for SQLite databases.

### Manual Docker build

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

## Option 3: npm

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
npm install
cp .env.example .env
# Edit .env
npm run dev
```

---

## Environment Variables

### Required Security Keys

All security keys must be at least 32 characters long. Generate your own — do not reuse examples.

```bash
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
# or (for local Ollama — no key needed, just the URL)
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

---

## First Run

1. Start the system: `pnpm dev`
2. Open http://localhost:3000 — you'll be redirected to `/login`
3. Enter the admin password you set in `SECUREYEOMAN_ADMIN_PASSWORD`
4. Complete the onboarding wizard (set agent name and personality)
5. The dashboard shows live metrics, tasks, security events, and more

---

## Verification

```bash
# Health check
curl http://localhost:18789/health

# Login and get a token
curl -X POST http://localhost:18789/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}'

# Fetch metrics with token
curl http://localhost:18789/api/v1/metrics \
  -H "Authorization: Bearer <accessToken>"
```

---

## Running Tests

```bash
pnpm test              # All 589 tests across 32 files
pnpm test -- --run     # Non-watch mode
pnpm test -- --coverage
```

---

## Troubleshooting

### Port already in use

```bash
lsof -i :18789
lsof -i :3000
# Kill the process or change ports via env vars
```

### Database locked

If another instance is running, stop it first. SQLite uses WAL mode and only supports a single writer.

### AI provider connection failed

Verify your API key is valid and you have network access to the provider's API endpoint.

### Debug mode

```bash
LOG_LEVEL=debug pnpm dev
```

---

## Next Steps

- [Configuration Reference](configuration.md) — all YAML config fields and options
- [API Reference](api.md) — REST endpoints and WebSocket protocol
- [Security Model](security/security-model.md) — threat model and security architecture
