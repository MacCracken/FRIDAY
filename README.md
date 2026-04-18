# SECUREYEOMAN

[![Version](https://img.shields.io/badge/Version-0.5.0-blue.svg)](https://github.com/MacCracken/secureyeoman/releases/tag/0.5.0)
[![CI](https://github.com/MacCracken/secureyeoman/actions/workflows/ci.yml/badge.svg)](https://github.com/MacCracken/secureyeoman/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Commercial License](https://img.shields.io/badge/License-Commercial-green.svg)](LICENSE.commercial)
[![Security: Enterprise-Grade](https://img.shields.io/badge/Security-Enterprise--Grade-green.svg)]()
[![Tests: ~22,000](https://img.shields.io/badge/Tests-~22%2C000-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)

> **Your AI. Your Rules. Your Infrastructure.**
>
> Most AI assistants serve their platform. SecureYeoman serves you — self-hosted, enterprise-hardened, and answerable only to you.
>
> Keep it local. Go hybrid. Connect any provider. Your data only moves when you say so.

Ships with the default Agent Personality **F.R.I.D.A.Y.** — **F**riendly, **R**eliable, **I**ntelligent, **D**igitally **A**daptable **Y**eoman.

---

## Quick Start

**Option A — Single binary (fastest):**
```bash
curl -fsSL https://secureyeoman.ai/install | bash
secureyeoman init
```

**Option B — Docker (pre-built image):**
```bash
docker pull ghcr.io/maccracken/secureyeoman:latest
```

**Option C — Docker Compose (build from source):**
```bash
git clone https://github.com/MacCracken/secureyeoman.git
cd secureyeoman
cp .env.example .env   # edit with your API key + security keys
docker compose up -d
```

**Option D — From source:**
```bash
git clone https://github.com/MacCracken/secureyeoman.git
cd secureyeoman
cp .env.example .env
npm install && npm run dev
```

**Option E — Edge/IoT binary (Rust `sy-edge`, ~8 MB):**
```bash
curl -fsSL https://secureyeoman.ai/install | bash -s -- --edge
secureyeoman-edge start --parent http://your-server:18789
```

Then open http://localhost:18789 and complete the onboarding wizard.

See the [Getting Started Guide](docs/guides/getting-started/getting-started.md) for full setup including Kubernetes Helm deployment.

---

## What is SECUREYEOMAN?

A **sovereign AI agent platform** that runs entirely on your infrastructure. Multi-model intelligence, enterprise-grade security, and a full training pipeline — without sending a single byte of data off-premises.

- **Self-hosted, not SaaS** — single binary, Docker, or Kubernetes. Your data stays on your machines.
- **Governed by design** — RBAC, audit trails, cryptographic integrity, sandboxed execution, OPA/CEL governance.
- **Multi-agent orchestration** — swarms, teams, DAG workflows, A2A protocol, and a 490-tool MCP server.
- **Full ML lifecycle** — distillation, LoRA fine-tuning, LLM-as-Judge evaluation, DPO, conversation analytics.

---

## Key Capabilities

| Area | Highlights |
|------|-----------|
| **Security** | JWT/OIDC/SAML auth, RBAC, AES-256-GCM encryption, mTLS, sandboxing (Landlock/seccomp/V8 isolate/gVisor/WASM, 5 built-in profiles), prompt security, content guardrails, DLP (PII detection, classification, watermarking), secrets management (Vault/OpenBao), WebAuthn/FIDO2, break-glass emergency access, chaos engineering |
| **AI Models** | 13 providers (Anthropic, OpenAI, Gemini, Ollama, DeepSeek, Mistral, Grok + more), multi-account cost tracking, automatic fallback, local-first routing |
| **Agents** | Sub-agent delegation, swarms (3 strategies, 5 templates), teams, Council of AIs, A2A protocol, cross-instance federation, Agent Replay & Debugging |
| **Workflows** | DAG orchestration (23 step types), visual ReactFlow builder, human approval gates, 22 built-in templates |
| **Training** | Dataset export, distillation, LoRA fine-tuning, pre-training from scratch, LLM-as-Judge eval, DPO/RLHF, federated learning, conversation analytics, A/B experiments, autoresearch (HP tuning, chaos escalation, circuit breaker autotuning) |
| **Dashboard** | React + Vite + Tailwind (45 themes), mission control, real-time CRDT editing, conversation branching, canvas workspace, inline AI completion, fleet panel |
| **Integrations** | 38 platforms (Slack, Discord, GitHub, Gmail, Teams, WhatsApp + more), 5 code forge adapters (Delta, GitHub, GitLab, Bitbucket, Gitea), artifact registries (GHCR, GitLab, JFrog Artifactory), 22 CI/CD tools, security toolkits (Kali, network, Docker) |
| **MCP** | 490 tools, 9 resources, 4 prompts; streamable HTTP, SSE, and stdio transports |
| **Enterprise** | Multi-tenancy (PostgreSQL RLS), multi-region HA, DLP, supply chain security (SBOM, SLSA, signed releases), OpenTelemetry, Prometheus/Grafana, SCIM 2.0 provisioning, access review campaigns, per-tenant quotas, compliance SoA generator |
| **Simulation** | Tick-driven engine (realtime/accelerated/turn-based), emotion & mood model (Russell's circumplex), spatial & proximity engine (3D zones, proximity triggers), autoresearch experiment runner |
| **Knowledge** | Document ingestion (PDF, HTML, MD, URL, GitHub Wiki), RAG with hybrid FTS+vector search, cognitive memory (ACT-R, Hebbian learning) |
| **Deployment** | Single binary (~19 MB `sy-core`, Rust), Docker, Kubernetes Helm chart, Edge/IoT binary (Rust `sy-edge`, ~8 MB); Linux x64 (arm64/armv7/riscv64 cross-compile deferred) |

See the [Feature Reference](docs/features.md) for the complete breakdown.

---

## Required Environment Variables

```bash
SECUREYEOMAN_SIGNING_KEY="your-32-char-signing-key"
SECUREYEOMAN_TOKEN_SECRET="your-32-char-token-secret"
SECUREYEOMAN_ENCRYPTION_KEY="your-32-char-encryption-key"
SECUREYEOMAN_ADMIN_PASSWORD="your-32-char-admin-password"

ANTHROPIC_API_KEY="sk-ant-..."   # or OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, etc.
```

See [.env.example](.env.example) and the [Configuration Reference](docs/configuration.md) for all options.

---

## Usage

**Dashboard** — http://localhost:18789 for chat, tasks, security events, personality editor, and settings.

**CLI (56 commands):**
```bash
secureyeoman start                              # start the server
secureyeoman health                             # check server health
secureyeoman status --profile                   # server status + memory profiling
secureyeoman model switch anthropic claude-sonnet-4-6
secureyeoman tui                                # full-screen terminal dashboard
secureyeoman workflow list                      # manage DAG workflows
secureyeoman dlp scan report.pdf                # DLP content scanning
secureyeoman audit reports --json               # memory audit reports
secureyeoman knowledge ingest-url https://...   # RAG document ingestion
secureyeoman chaos run <id>                     # chaos engineering
secureyeoman guardrail filters                  # guardrail pipeline
secureyeoman replay list                        # agent trace debugging
secureyeoman observe costs                      # observability & costs
secureyeoman skill list                         # marketplace skills
secureyeoman help                               # all 56 commands
```

**MCP Integration** — Connect to any MCP-compatible client (Claude Desktop, etc.):

```json
{
  "mcpServers": {
    "secureyeoman": {
      "command": "node",
      "args": ["packages/mcp/dist/cli.js"],
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

> [!WARNING]
> **Never use OAuth tokens, session cookies, or credentials from Claude.ai, ChatGPT, or any other
> AI provider's consumer product.** Always use official API keys from developer consoles.

---

## Documentation

| | |
|---|---|
| **[Getting Started](docs/guides/getting-started/getting-started.md)** | Installation, configuration, first steps |
| **[CLI Reference](docs/guides/getting-started/cli-reference.md)** | All 56 commands with examples |
| **[Configuration Reference](docs/configuration.md)** | All YAML fields and environment variables |
| **[Feature Reference](docs/features.md)** | Complete feature breakdown |
| **[REST API](docs/api/rest-api.md)** | REST API reference |
| **[WebSocket API](docs/api/websocket-api.md)** | Real-time WebSocket protocol |
| **[OpenAPI Spec](docs/openapi.yaml)** | OpenAPI 3.1 specification |
| **[Deployment](docs/deployment.md)** | Binary, Docker, Kubernetes |
| **[Security Model](docs/guides/security/security-model.md)** | Threat model and security controls |
| **[White Paper](docs/white-paper.md)** | Architectural sovereignty & agentic governance |
| **[Architecture](docs/development/architecture.md)** | System architecture overview |
| **[ADRs](docs/adr/)** | 39 Architecture Decision Records |
| **[Roadmap](docs/development/roadmap.md)** | Development roadmap |
| **[Changelog](CHANGELOG.md)** | Release history |

**Guides** — See [`docs/guides/`](docs/guides/) for 68 topic guides including [CLI Reference](docs/guides/getting-started/cli-reference.md), [AI Providers](docs/guides/ai-and-llm/ai-providers.md), [Integrations](docs/guides/integrations/integrations.md), [Knowledge & Memory](docs/guides/ai-and-llm/knowledge-memory.md), [Workflows](docs/guides/platform-features/workflows.md), [Swarms](docs/guides/platform-features/swarms.md), [SSO/SAML](docs/guides/security/sso-saml.md), [DLP](docs/guides/security/data-loss-prevention.md), [Federated Learning](docs/guides/ai-and-llm/federated-learning.md), [Chaos Engineering](docs/guides/enterprise/chaos-engineering.md), [Multi-Region HA](docs/guides/enterprise/multi-region-ha.md), [Observability](docs/guides/enterprise/observability.md), [Security Testing](docs/guides/security/security-testing.md), and more.

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing, code style, and contribution process.

---

## Getting Help

| Channel | Use it for |
|---------|------------|
| [GitHub Discussions](https://github.com/MacCracken/secureyeoman/discussions) | Questions, ideas, show-and-tell |
| [Troubleshooting Guide](docs/troubleshooting.md) | Common problems and fixes |
| [GitHub Issues](https://github.com/MacCracken/secureyeoman/issues) | Bug reports (include logs + OS/version) |
| security@secureyeoman.ai | Security vulnerabilities — **do not** open a public issue |

See [SECURITY.md](SECURITY.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

## Licensing

SecureYeoman uses a dual-license model:

- **AGPL-3.0** — for open-source use, self-hosting, and contributors. Anyone offering the software as a hosted service to third parties must publish their modifications.
- **Commercial license** — for enterprises that cannot accept AGPL terms, or for SaaS providers who need to keep modifications private. See [`LICENSE.commercial`](LICENSE.commercial).

Enterprise features (Adaptive Learning, SSO/SAML, Multi-Tenancy, CI/CD, Advanced Observability) require a commercial license key. See [`docs/guides/enterprise/licensing.md`](docs/guides/enterprise/licensing.md) for details.

---

<div align="center">

**SECUREYEOMAN** — Your AI. Your Rules. Your Infrastructure.

</div>
