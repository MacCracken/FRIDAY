# F.R.I.D.A.Y.

> **F**ully **R**esponsive **I**ntegrated **D**igitally **A**daptable **Y**eoman

[![Version](https://img.shields.io/badge/Version-1.5.0-blue.svg)](https://github.com/MacCracken/FRIDAY/releases/tag/v1.5.0)
[![CI](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml/badge.svg)](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Tests: 1700+](https://img.shields.io/badge/Tests-1700%2B-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

> A secure, local-first AI assistant with enterprise-grade protection and comprehensive observability.

---

## Quick Start

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
cp .env.example .env   # edit with your API key + security keys
npm install && npm run dev
```

Then open http://localhost:3000 and complete the onboarding wizard.

---

## What is F.R.I.D.A.Y.?

F.R.I.D.A.Y. is a **secure autonomous agent system** built around the **SecureYeoman** core. Unlike traditional AI assistants, F.R.I.D.A.Y.:

- **Prioritizes Security**: Enterprise-grade RBAC, encryption, sandboxing, and audit trails
- **Respects Privacy**: Local-first architecture with data that never leaves your system
- **Provides Observability**: Every action is logged with cryptographic integrity verification
- **Offers Flexibility**: Multi-provider AI support (Anthropic, OpenAI, Gemini, Ollama, OpenCode Zen)
- **Learns and Adapts**: Editable personality, learnable skills, and a marketplace for sharing them

---

## Key Features

| Category | Features |
|----------|----------|
| **Security** | RBAC (Admin/Operator/Auditor/Viewer), JWT + API key auth, mTLS, AES-256-GCM encryption at rest, sandboxed execution (Landlock/macOS sandbox), rate limiting (per-user, per-IP, global), HTTP security headers (HSTS, CSP, X-Frame-Options), CORS policy enforcement |
| **Observability** | Cryptographic audit trails (HMAC-SHA256 chain), Prometheus metrics, Grafana dashboards, structured JSONL log rotation, audit retention enforcement, audit export |
| **AI Integration** | Anthropic Claude, OpenAI GPT, Google Gemini, Ollama (local), OpenCode Zen; automatic fallback chains on rate limits/outages; dynamic model discovery |
| **Dashboard** | React + Vite + Tailwind; real-time WebSocket updates (channel-based RBAC); metrics graphs, task history, security events, personality editor, skills manager, code editor (Monaco), notification & retention settings |
| **Agent Architecture** | Soul (identity/archetypes/personality), Spirit (passions/inspirations/pains), Brain (memory/knowledge/skills with decay & pruning), Body (heartbeat/vital signs/screen capture) |
| **Integrations** | Telegram, Discord, Slack, GitHub, Google Chat, CLI, Generic Webhook — plugin architecture with unified message routing |
| **MCP Protocol** | Standalone `@friday/mcp` service (22+ tools, 7 resources, 4 prompts); auto-registers with core; streamable HTTP, SSE, and stdio transports; connect external MCP servers with persistent tool discovery |
| **Marketplace** | Skill discovery, search, install/uninstall (syncs with Brain skills), publish with cryptographic signature verification |
| **Team Collaboration** | Workspaces with isolation, member management, workspace-scoped RBAC |
| **Reports & Analytics** | Audit report generator (JSON/HTML/CSV), cost optimization recommendations, A/B testing framework |
| **Voice** | Push-to-talk (Ctrl+Shift+V), browser-native speech recognition & synthesis, voice overlay |
| **Development** | TypeScript strict mode, 1700+ tests across 115+ files, Docker multi-stage builds, CI/CD pipeline (lint/typecheck/test/build/security audit) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Dashboard (React)                    │
│  Metrics | Tasks | Security | Personality | Code | Chat  │
└───────────────────────┬──────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼──────────────────────────────────┐
│                  Gateway (Fastify)                         │
│  Auth Middleware → RBAC → Rate Limiting → Security Headers│
├──────────────────────────────────────────────────────────┤
│                  SecureYeoman Core                         │
│  ┌─────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌─────┐ ┌────────┐ │
│  │ Soul│ │Spirit│ │Brain │ │ Body │ │Task │ │Logging │ │
│  └─────┘ └──────┘ └──────┘ └──────┘ └─────┘ └────────┘ │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Security │ │Integration│ │    AI    │ │    MCP    │  │
│  │RBAC/Crypt│ │  Manager  │ │ Provider │ │Client/Srv │  │
│  └──────────┘ └───────────┘ └──────────┘ └───────────┘  │
└──────────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
    │ SQLite  │   │ Platforms │  │  MCP    │
    │  (WAL)  │   │ TG/DC/SL/ │  │ Service │
    │         │   │ GH/GC/WH  │  │(22+tools│
    └─────────┘   └───────────┘  └─────────┘
```

---

## Prerequisites

- **Node.js** 20 LTS or later
- **npm** (project uses npm workspaces)
- **AI Provider API Key**: At least one of Anthropic, OpenAI, Google Gemini, OpenCode Zen, or Ollama (local)

---

## Installation

### From Source

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
npm install

# Configure
cp .env.example .env
# Edit .env with your API key and security keys (minimum 32 characters each)

# Start (core + dashboard)
npm run dev
```

### Docker

```bash
# Core + Dashboard
docker compose up -d

# With MCP service
docker compose --profile mcp up -d

# Or manual build
docker build -t friday .
docker run --env-file .env -p 18789:18789 friday
```

### Environment Variables

Required:

```bash
# Security keys (generate your own, minimum 32 characters each)
SECUREYEOMAN_SIGNING_KEY="your-32-char-signing-key"
SECUREYEOMAN_TOKEN_SECRET="your-32-char-token-secret"
SECUREYEOMAN_ENCRYPTION_KEY="your-32-char-encryption-key"
SECUREYEOMAN_ADMIN_PASSWORD="your-32-char-admin-password"

# AI provider (at least one required)
ANTHROPIC_API_KEY="sk-ant-..."
# or OPENAI_API_KEY="sk-..."
# or GOOGLE_GENERATIVE_AI_API_KEY="..."
# or OPENCODE_API_KEY="..."
# or OLLAMA_BASE_URL="http://localhost:11434"
```

Optional:

```bash
# Server
FRIDAY_PORT=18789          # API port (default: 18789)
FRIDAY_HOST="0.0.0.0"     # Bind address
FRIDAY_LOG_LEVEL="info"   # trace|debug|info|warn|error

# MCP Service
MCP_ENABLED=true           # Enable standalone MCP service
MCP_PORT=3001              # MCP port (default: 3001)
MCP_TRANSPORT="streamable-http"  # streamable-http|sse|stdio
MCP_EXPOSE_FILESYSTEM=false      # Opt-in sandboxed file operations

# Redis (enables distributed rate limiting)
REDIS_URL="redis://localhost:6379"
```

See [.env.example](.env.example) for all options.

---

## Usage

### Dashboard

Access http://localhost:3000 after starting the system. The dashboard provides:

- **Metrics**: Real-time system metrics with interactive graphs
- **Tasks**: Task history with create/edit/delete, filtering, and live updates
- **Security**: Security event log with severity filtering
- **Connections**: Integration management (connect/start/stop platforms)
- **Personality**: Identity editor, archetype selector, skill builder
- **Code**: Monaco editor with personality-scoped AI chat sidebar
- **Settings**: Notification preferences, log retention policy, API key management, audit export

### API

```bash
# Health check
curl http://localhost:18789/health

# Authenticate
TOKEN=$(curl -s -X POST http://localhost:18789/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-admin-password"}' | jq -r '.accessToken')

# Get metrics
curl http://localhost:18789/api/v1/metrics \
  -H "Authorization: Bearer $TOKEN"

# Create a task
curl -X POST http://localhost:18789/api/v1/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "execute", "input": {"command": "echo hello"}}'

# Query audit log
curl http://localhost:18789/api/v1/audit?limit=50 \
  -H "Authorization: Bearer $TOKEN"
```

### MCP Integration

Connect F.R.I.D.A.Y. to any MCP-compatible client (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "friday": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "MCP_CORE_URL": "http://127.0.0.1:18789",
        "SECUREYEOMAN_TOKEN_SECRET": "your-token-secret"
      }
    }
  }
}
```

Or connect via HTTP: `http://localhost:3001/mcp` (when running with `--profile mcp`).

---

## Project Structure

```
friday/
├── packages/
│   ├── shared/          # Shared TypeScript types and Zod schemas
│   ├── core/            # Agent engine, security, and integrations
│   │   └── src/
│   │       ├── ai/              # Multi-provider AI client + fallback chains
│   │       ├── brain/           # Memory, knowledge, skills (with decay/pruning)
│   │       ├── body/            # Vital signs (heartbeat, capture, health)
│   │       ├── comms/           # E2E encrypted agent comms (X25519 + AES-256-GCM)
│   │       ├── gateway/         # Fastify API server, auth, RBAC, security headers
│   │       ├── integrations/    # Platform adapters (Telegram, Discord, Slack, GitHub, Google Chat, CLI, Webhook)
│   │       ├── logging/         # Audit chain + storage + file writer + rotation
│   │       ├── marketplace/     # Skill marketplace (discovery, install, publish)
│   │       ├── mcp/             # MCP client manager + tool storage
│   │       ├── security/        # RBAC, encryption, sandbox, rate limiting
│   │       ├── soul/            # Personality, identity, archetypes
│   │       ├── spirit/          # Emotional core (passions, inspirations, pains)
│   │       └── task/            # Task executor + SQLite storage
│   ├── dashboard/       # React UI (Vite + Tailwind + TanStack Query)
│   └── mcp/             # Standalone MCP service (22+ tools, 7 resources, 4 prompts)
├── tests/               # Security, load (k6), and chaos tests
├── deploy/              # Docker, Prometheus, Grafana, Loki configs
├── docs/                # Documentation + ADRs (28 decision records)
│   ├── api/             # REST API + WebSocket API + OpenAPI 3.1 spec
│   ├── adr/             # Architecture Decision Records
│   ├── guides/          # Getting started, integrations
│   ├── security/        # Security model documentation
│   └── development/     # Roadmap
├── scripts/             # Utility scripts
└── .github/             # CI/CD workflows
```

---

## Development

### Running Tests

```bash
# All workspace tests
npm test

# Individual packages
npm test --workspace=@friday/core
npm test --workspace=@friday/mcp
npm test --workspace=@friday/dashboard

# With coverage
npm test -- --coverage

# Security + chaos tests
npx vitest run tests/security/ tests/chaos/
```

### Test Coverage

| Package | Tests | Files |
|---------|-------|-------|
| `@friday/core` | 1360+ | 76 |
| `@friday/mcp` | 219 | 27 |
| `@friday/dashboard` | 124 | 12 |
| Security + Chaos + Load | ~76 | 5+ |
| **Total** | **1700+** | **115+** |

### Building

```bash
# All packages
npm run build

# Individual
npm run build --workspace=@friday/core
npm run build --workspace=@friday/dashboard
npm run build --workspace=@friday/mcp
```

---

## Documentation

| Topic | Link |
|-------|------|
| **Getting Started** | [Getting Started Guide](docs/guides/getting-started.md) |
| **Configuration** | [Config Reference](docs/configuration.md) |
| **REST API** | [REST API Reference](docs/api/rest-api.md) |
| **WebSocket API** | [WebSocket API](docs/api/websocket-api.md) |
| **OpenAPI Spec** | [OpenAPI 3.1](docs/openapi.yaml) |
| **Security Model** | [Security Model](docs/security/security-model.md) |
| **Deployment** | [Deployment Guide](docs/deployment.md) |
| **Integrations** | [Integration Setup](docs/guides/integrations.md) |
| **Troubleshooting** | [Troubleshooting Guide](docs/troubleshooting.md) |
| **Architecture Decisions** | [ADRs](docs/adr/) (28 records) |
| **Roadmap** | [Development Roadmap](docs/development/roadmap.md) |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Contributing** | [Contributing Guide](CONTRIBUTING.md) |
| **Security Policy** | [SECURITY.md](SECURITY.md) |

---

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for:

- Development setup
- Code style and testing requirements
- Pull request process
- Community guidelines

---

## Security

Security is our top priority. For security issues:

- **DO NOT** open a public issue
- Email: security@friday.dev
- See our [Security Policy](SECURITY.md)

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

**F.R.I.D.A.Y.** - Your trusted digital Yeoman

</div>
