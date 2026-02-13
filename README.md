# F.R.I.D.A.Y.

> **F**ully **R**esponsive **I**ntegrated **D**igitally **A**daptable **Y**eoman

[![Version](https://img.shields.io/badge/Version-1.3.0-blue.svg)](https://github.com/MacCracken/FRIDAY/releases/tag/v1.3.0)
[![CI](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml/badge.svg)](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Tests: 1000+](https://img.shields.io/badge/Tests-1000%2B-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

> A secure, local-first AI assistant with enterprise-grade protection and comprehensive observability.

---

## Quick Start

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
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
- **Learns and Adapts**: Editable personality and learnable skills system

---

## Key Features

| Category | Features |
|----------|----------|
| **Security** | RBAC, JWT/API key auth, AES-256-GCM encryption, sandboxed execution, rate limiting |
| **Observability** | Cryptographic audit trails, Prometheus metrics, Grafana dashboards, log rotation |
| **AI Integration** | Anthropic Claude, OpenAI GPT, Google Gemini, Ollama (local), OpenCode Zen, fallback chains |
| **User Experience** | React dashboard, personality editor, skills manager, WebSocket real-time updates |
| **Agent Architecture** | Soul (identity/archetypes), Spirit (passions/inspirations/pains), Brain (memory/knowledge), Body (heartbeat/vital signs) |
| **Integrations** | Telegram, Discord, Slack, GitHub — plugin architecture with message routing |
| **MCP Protocol** | Connect to external MCP servers for tools/resources, expose F.R.I.D.A.Y. skills as MCP tools |
| **Team Collaboration** | Workspaces with isolation, member management, workspace-scoped RBAC |
| **Reports & Analytics** | Audit report generator (JSON/HTML/CSV), cost optimization recommendations |
| **Experimentation** | A/B testing framework with variant routing and statistical analysis |
| **Marketplace** | Skill discovery, search, install, publish with cryptographic signature verification |
| **Development** | TypeScript, 1000+ tests across 59+ files, Docker support, CI/CD pipeline |

---

## Prerequisites

- **Node.js** 20 LTS or later
- **npm** (project uses npm workspaces)
- **AI Provider API Key**: Anthropic, OpenAI, Google Gemini, OpenCode Zen, or Ollama (local)

---

## Installation

### From Source

```bash
git clone https://github.com/MacCracken/FRIDAY.git
cd friday
npm install

# Configure (copy .env.example to .env and edit)
cp .env.example .env

# Start the system
npm run dev
```

### Docker

```bash
docker compose up

# Or manual build
docker build -t friday .
docker run --env-file .env -p 18789:18789 friday
```

### Environment Setup

Required environment variables:

```bash
# Security keys (generate your own)
SECUREYEOMAN_SIGNING_KEY="your-32-char-signing-key"
SECUREYEOMAN_TOKEN_SECRET="your-32-char-token-secret"
SECUREYEOMAN_ENCRYPTION_KEY="your-32-char-encryption-key"
SECUREYEOMAN_ADMIN_PASSWORD="your-32-char-admin-password"

# AI provider (at least one required)
ANTHROPIC_API_KEY="sk-ant-..."
# or OPENAI_API_KEY="sk-..."
# or GOOGLE_GENERATIVE_AI_API_KEY="..."
# or OPENCODE_API_KEY="..."
```

---

## Usage

### 1. Dashboard
- Access: http://localhost:3000
- Features: Real-time monitoring, task management, security events
- Authentication: Use your admin password from setup

### 2. CLI
```bash
npx secureyeoman health
npx secureyeoman task create --type execute --input '{"command": "echo hello"}'
```

### 3. API
```bash
# Get metrics
curl http://localhost:18789/api/v1/metrics \
  -H "Authorization: Bearer <token>"

# Create task
curl -X POST http://localhost:18789/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{"type": "execute", "input": {"command": "echo hello"}}'
```

---

## Development

### Running Tests
```bash
# All tests (1000+ across 59+ files)
npm test

# Coverage
npm test -- --coverage

# Security + chaos tests
npx vitest run tests/security/ tests/chaos/
```

### Project Structure
```
friday/
├── packages/
│   ├── shared/          # Shared TypeScript types and Zod schemas
│   ├── core/            # Agent engine, security, and integrations
│   │   └── src/
│   │       ├── ai/              # Multi-provider AI client
│   │       ├── brain/           # Memory, knowledge, skills
│   │       ├── comms/           # E2E encrypted agent comms
│   │       ├── gateway/         # Fastify API server + auth + Prometheus
│   │       ├── integrations/    # Platform adapters (Telegram, Discord, Slack, GitHub)
│   │       ├── logging/         # Audit chain + storage + file writer + rotation
│   │       ├── security/        # RBAC, encryption, sandbox
│   │       ├── soul/            # Personality + identity
│   │       └── task/            # Task executor + storage
│   └── dashboard/       # React UI (Vite + Tailwind)
├── tests/               # Security, load, and chaos tests
├── deploy/              # Docker, Prometheus, Grafana, Loki configs
├── scripts/             # Utility scripts
├── docs/                # Documentation
└── .github/             # CI/CD workflows
```

---

## Documentation

| Topic | Link |
|-------|------|
| **Getting Started** | [Getting Started Guide](docs/guides/getting-started.md) |
| **Configuration** | [Config Reference](docs/configuration.md) |
| **API Reference** | [REST & WebSocket](docs/api.md) |
| **Deployment** | [Deployment Guide](docs/deployment.md) |
| **Integrations** | [Integration Setup](docs/guides/integrations.md) |
| **Troubleshooting** | [Troubleshooting Guide](docs/troubleshooting.md) |
| **Changelog** | [CHANGELOG.md](CHANGELOG.md) |
| **Development** | [Roadmap](docs/development/roadmap.md) |
| **Contributing** | [Contributing Guide](CONTRIBUTING.md) |
| **Security** | [Security Policy](SECURITY.md) |

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
