# F.R.I.D.A.Y.

> **F**ully **R**esponsive **I**ntegrated **D**igital **A**ssistant **Y**eoman

[![CI](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml/badge.svg)](https://github.com/MacCracken/FRIDAY/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Tests: 589](https://img.shields.io/badge/Tests-589%20Passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)
[![Security Audit](https://img.shields.io/badge/Security%20Audit-Passing-brightgreen.svg)]()
[![Coverage](https://img.shields.io/badge/Coverage-Reported-blue.svg)]()

> A secure, local-first AI assistant with enterprise-grade protection and comprehensive observability.

---

## ✨ Quick Start

```bash
# Install and run in 3 commands
git clone https://github.com/your-org/friday.git
cd friday
pnpm install && pnpm dev
```

Then open http://localhost:3000 and complete the onboarding wizard.

---

## 🎯 What is F.R.I.D.A.Y.?

F.R.I.D.A.Y. is a **secure autonomous agent system** built around the **SecureYeoman** core. Unlike traditional AI assistants, F.R.I.D.A.Y.:

- **Prioritizes Security**: Enterprise-grade RBAC, encryption, sandboxing, and audit trails
- **Respects Privacy**: Local-first architecture with data that never leaves your system
- **Provides Observability**: Every action is logged with cryptographic integrity verification
- **Offers Flexibility**: Multi-provider AI support (Anthropic, OpenAI, Gemini, Ollama)
- **Learns and Adapts**: Editable personality and learnable skills system

---

## 🚀 Key Features

| Category | Features |
|----------|----------|
| **Security** | RBAC, JWT/API key auth, AES-256-GCM encryption, sandboxed execution, rate limiting |
| **Observability** | Comprehensive audit trails, real-time metrics, performance monitoring |
| **AI Integration** | Anthropic Claude, OpenAI GPT, Google Gemini, Ollama (local) |
| **User Experience** | React dashboard, personality editor, skills manager, WebSocket real-time updates |
| **Integrations** | Plugin architecture, platform adapters (Telegram, Discord, Slack), message routing |
| **Development** | TypeScript, full test coverage (589 tests), Docker support, CI/CD pipeline |

---

## 📋 Prerequisites

- **Node.js** 20 LTS or later
- **pnpm** (recommended) or npm
- **AI Provider API Key**: Anthropic, OpenAI, Google Gemini, or Ollama (local)

---

## ⚙️ Installation

### Standard Install

```bash
# Clone and install
git clone https://github.com/your-org/friday.git
cd friday
pnpm install

# Configure (copy .env.example to .env and edit)
cp .env.example .env

# Start the system
pnpm dev
```

### Docker Install

```bash
# Quick start with Docker Compose
docker compose up

# Or manual build
docker build -t friday .
docker run -p 18789:18789 -p 3000:3000 friday
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
```

---

## 🎮 Usage

### 1. Dashboard
- Access: http://localhost:3000
- Features: Real-time monitoring, task management, security events
- Authentication: Use your admin password from setup

### 2. CLI
```bash
# Check health
npx secureyeoman health

# Create task
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

## 📊 Development

### Running Tests
```bash
# All tests
pnpm test          # 589 tests across 32 files

# Coverage
pnpm test -- --coverage

# Specific package
pnpm test --workspace=@friday/core
```

### Project Structure
```
friday/
├── packages/
│   ├── shared/          # Shared TypeScript types and Zod schemas
│   ├── core/            # Agent engine, security, and integrations
│   │   └── src/
│   │       ├── ai/              # Multi-provider AI client
│   │       ├── gateway/         # Fastify API server + auth
│   │       ├── integrations/    # Platform adapter framework
│   │       ├── security/        # RBAC, encryption, sandbox
│   │       ├── soul/            # Personality + skills system
│   │       └── task/            # Task executor + storage
│   └── dashboard/       # React UI (Vite + Tailwind)
├── docs/                # Documentation
└── .github/             # CI/CD workflows
```

---

## 📚 Documentation

| Topic | Link |
|-------|------|
| **Installation** | [Install Guide](docs/installation.md) |
| **Configuration** | [Config Reference](docs/configuration.md) |
| **API Reference** | [REST & WebSocket](docs/api.md) |
| **Development** | [TODO / Roadmap](TODO.md) • [Contributing](CONTRIBUTING.md) |
| **Security** | [Security Policy](SECURITY.md) |

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for:

- Development setup
- Code style and testing requirements
- Pull request process
- Community guidelines

---

## 🛡️ Security

Security is our top priority. For security issues:

- **DO NOT** open a public issue
- Email: security@friday.dev
- See our [Security Policy](SECURITY.md)

Security features include:
- Cryptographic audit trails
- Role-based access control
- Sandboxed execution
- Input validation and sanitization
- Rate limiting and threat detection

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **Issues & Discussions**: [GitHub](https://github.com/your-org/friday)
- **Community**: [GitHub Discussions](https://github.com/your-org/friday/discussions)
- **Security**: [Security Policy](SECURITY.md)

---

<div align="center">

**F.R.I.D.A.Y.** - Your trusted digital Yeoman

</div>
