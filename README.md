# F.R.I.D.A.Y.

> **F**ully
> **R**esponsive
> **I**ntegrated
> **D**igital
> **A**ssistant
> **Y**eoman

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Status: In Development](https://img.shields.io/badge/Status-In%20Development-blue.svg)]()

---

## Mission Statement

To provide a decentralized, local-first intelligence that prioritizes user privacy without sacrificing the "always-on" utility of a modern digital assistant. **F.R.I.D.A.Y.** isn't just a tool; it's your personal digital Yeoman.

## About FRIDAY

**FRIDAY** is a personal assistant designed with a focus on being **safe and secure**. Much like its namesake, this system is built to be a loyal and tireless "Yeoman" -- a dependable guardian of your digital workflow and personal data.

### Why the "Yeoman" Designation?

In engineering and historical contexts, a **Yeoman** represents:

* **Dependability:** Performing essential work with precision.
* **Security:** Acting as a trusted protector of a specific domain.
* **Loyalty:** A system that works exclusively for the user's best interest.

---

## SecureYeoman Module

**SecureYeoman** is the security-hardened autonomous agent core of F.R.I.D.A.Y., inspired by [OpenClaw](https://github.com/openclaw/openclaw) but built from the ground up with enterprise-grade security and comprehensive observability.

### Key Features

| Feature | Description | Status |
|---------|-------------|--------|
| **Enterprise Security** | RBAC, JWT/API key auth, encryption at rest, sandboxed execution, rate limiting | Done |
| **Soul System** | User-editable personality, learnable skills, AI prompt composition | Done |
| **Self-Logging** | Every task logged with cryptographic integrity verification | Done |
| **Task Persistence** | SQLite-backed task history with filtering, stats, and metrics | Done |
| **Performance Metrics** | Real-time token usage, task duration, resource consumption | Done |
| **GUI Dashboard** | Metrics graph, task history, security events, personality editor, skills manager | Done |
| **Audit Trail** | Immutable, cryptographically signed logs with SQLite storage | Done |
| **Secret Management** | System keyring integration, automatic rotation, expiry tracking | Done |
| **Multi-Provider AI** | Anthropic, OpenAI, Gemini, Ollama with unified client | Done |
| **CLI** | `secureyeoman` command with arg parsing, graceful shutdown | Done |

### Quick Links

- [SecureYeoman System Prompt](SECUREYEOMAN.md) - Full specification and architecture
- [Development TODO](TODO.md) - Roadmap, next steps, and technical specifications

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│             F.R.I.D.A.Yeoman Dashboard                  │
│            (React + TanStack + ReactFlow)               │
└─────────────────────────┬───────────────────────────────┘
                          │ WebSocket + REST
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  SecureYeoman Gateway                      │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │   Security  │ │   Metrics   │ │    Audit    │       │
│  │    Layer    │ │  Collector  │ │    Chain    │       │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘       │
│         └───────────────┼───────────────┘               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Sandboxed Agent Engine               │  │
│  │       (Anthropic, OpenAI, Gemini, Ollama)        │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Getting Started

### Prerequisites

- Node.js 20 LTS or later
- pnpm (recommended) or npm
- API key for at least one provider: Anthropic, OpenAI, Google Gemini, or Ollama (local)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/friday.git
cd friday

# Install dependencies
pnpm install

# Set required environment variables
export SECUREYEOMAN_SIGNING_KEY="your-signing-key-at-least-32-chars"
export SECUREYEOMAN_TOKEN_SECRET="your-token-secret-at-least-32-chars"
export SECUREYEOMAN_ENCRYPTION_KEY="your-encryption-key-at-least-32-chars"
export SECUREYEOMAN_ADMIN_PASSWORD="your-admin-password-at-least-32-chars"

# Optional: Set AI provider API key
export ANTHROPIC_API_KEY="sk-ant-..."
# or OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY

# Start the server
npx tsx packages/core/src/cli.ts

# Or with options
npx tsx packages/core/src/cli.ts --port 3001 --log-level debug
```

### Running Tests

```bash
cd packages/core
npx vitest run    # 538 tests across 30 files
```

### Documentation

- [SecureYeoman Specification](SECUREYEOMAN.md) - Complete system architecture and prompt
- [Development Roadmap](TODO.md) - Task list and technical considerations

---

## Project Structure

```
friday/
├── README.md                   # This file
├── SECUREYEOMAN.md             # SecureYeoman agent specification
├── TODO.md                     # Development roadmap
├── LICENSE                     # MIT License
├── tsconfig.json               # Root TypeScript config (strict mode)
├── eslint.config.js            # ESLint 9.x flat config
├── packages/
│   ├── shared/                 # Shared types, Zod schemas
│   │   └── src/types/          # Task, Security, Metrics, AI, Config, Soul types
│   ├── core/                   # Agent engine (538 tests)
│   │   └── src/
│   │       ├── ai/             # Multi-provider AI client (Anthropic, OpenAI, Gemini, Ollama)
│   │       ├── cli.ts          # CLI entry point (secureyeoman command)
│   │       ├── config/         # YAML + env config loader with Zod validation
│   │       ├── gateway/        # Fastify REST + WebSocket server + auth middleware
│   │       ├── logging/        # Structured logger + cryptographic audit chain + SQLite storage
│   │       ├── sandbox/        # Cross-platform sandbox (NoopSandbox, LinuxSandbox)
│   │       ├── security/       # RBAC, JWT auth, rate limiter, input validator, secret store,
│   │       │                   # keyring integration, secret rotation
│   │       ├── soul/           # Personality + skills system (storage, manager, routes)
│   │       ├── task/           # Task queue executor + SQLite task storage
│   │       └── utils/          # UUIDv7, SHA-256, HMAC crypto utilities
│   └── dashboard/              # React + Vite + Tailwind dashboard
│       └── src/
│           ├── components/     # MetricsGraph, TaskHistory, SecurityEvents, ResourceMonitor,
│           │                   # OnboardingWizard, PersonalityEditor, SkillsManager
│           ├── hooks/          # useWebSocket
│           └── api/            # API client (REST + Soul API)
└── site/                       # Project website
```

---

## Contributing

We welcome contributions! This is an open-source project and we appreciate any help.

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style
- Write tests for new features
- Update documentation as needed
- Ensure all security checks pass

---

## Security

Security is our top priority. If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public issue
2. Email security concerns to the maintainers
3. Allow time for a fix before public disclosure

See [SECUREYEOMAN.md](SECUREYEOMAN.md) for our security architecture.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Inspired by [OpenClaw](https://github.com/openclaw/openclaw) - The open-source AI agent
- Monitoring concepts from [CrabWalk](https://github.com/luccast/crabwalk) - Real-time agent monitor
- Built with [Anthropic Claude](https://www.anthropic.com/) - AI assistant

---

## Community

- [GitHub Issues](https://github.com/your-org/friday/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/your-org/friday/discussions) - Questions and community chat

---

*F.R.I.D.A.Y. - Your trusted digital Yeoman.*
