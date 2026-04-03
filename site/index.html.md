# SecureYeoman — Your AI. Your Rules. Your Infrastructure.

Self-hosted, enterprise-hardened, answerable only to you. Your data moves when you say so.

**v0.5.0** | AGPL-3.0 | 490 MCP Tools | 56 CLI Commands | ~22,000 Tests

---

## 13 AI Providers. Zero Secrets Exposed.

Anthropic, OpenAI, Gemini, Ollama, DeepSeek, OpenCode, Mistral, LM Studio, LocalAI, x.ai Grok, Letta, Groq, OpenRouter.

---

## Built for Security. Designed for You.

### Enterprise Security
- RBAC + SSO/OIDC + SAML 2.0 + WebAuthn/FIDO2
- Multi-tenancy with PostgreSQL RLS isolation
- Five sandboxing modes + externalization gate
- TEE-aware provider routing + attestation verification
- DLP — PII classification, egress scanning, watermarking
- Break-glass emergency access + SCIM 2.0 provisioning
- Organizational Intent — hard boundaries & OPA policies
- 7-layer application defense + global rate limiting

### Audit & Compliance
- Cryptographic integrity (HMAC-SHA256)
- Streaming audit export — JSON-Lines, CSV, syslog RFC 5424
- Departmental Risk Register & ATHI threat governance
- Risk Assessment — composite 0-100 score across 5 domains
- Immutable, tamper-evident logs + Prometheus metrics
- Supply chain: SBOM (CycloneDX), SLSA L3, signed releases

### Security Operations
- 37 network evaluation tools
- Twingate zero-trust tunnel (13 tools)
- NVD / CVE vulnerability lookups
- Kali toolkit (nmap, nuclei, sqlmap)

### 490 MCP Tools & 38 Integrations
- 38 platform integrations
- 5 code forge adapters + artifact registries
- 490 tools, 9 resources, 4 prompts
- SSRF protection + encrypted creds

### Multi-Agent & Workflows
- A2A protocol (E2E encrypted)
- Swarms + Teams + Council of AIs
- DAG workflows — 23 step types
- ReactFlow visual builder + L3 approval gates

### Cognitive Memory & Knowledge
- Hybrid FTS + vector (RRF)
- Knowledge Base & RAG (PDF, HTML, Markdown, URL)
- Inline citations & groundedness checking
- Memory audits — compression, reorganization, coherence

### Developer Experience
- 56 CLI commands + full-screen TUI
- Rich lifecycle hooks
- Sandboxed code execution
- Desktop control (consent-gated)

### Flexible Deployment
- Single binary + Docker + K8s Helm
- Edge/IoT binary (Go, 7.2 MB) for constrained devices
- Local / LAN / Public TLS modes
- Multi-user workspaces + SSO
- Voice I/O — 14 TTS + 10 STT providers
- Fleet dashboard with node overview + GPU detection

### Ecosystem & Skills
- Portable .skill.json import / export
- Marketplace + Community origins with unified schema
- Trust Tier install pipeline (sandboxed execution)
- Companion apps: Shruti DAW, Rasa image editor, Tazama video editor, Mneme knowledge base

### Train & Evaluate
- Distillation (priority / curriculum / counterfactual)
- LoRA fine-tuning + LLM-as-Judge auto-eval
- Experiment registry & model versioning
- A/B testing + conversation branching & replay
- Conversation analytics (sentiment, entities)

### Simulation Engine
- Tick driver — realtime / accelerated / turn-based
- Emotion & mood model (Russell's circumplex)
- 3D spatial & proximity engine (6 trigger types)
- Autoresearch: HP tuning, chaos escalation, CB autotuning

---

## Security by Design, Not Afterthought

The OpenClaw security crisis (2026): 13+ CVEs (20+ GHSAs) including CVSS 8.8 RCE, 1,184+ malicious marketplace skills (12% of ClawHub), 42,000+ exposed instances, Gartner ban.

**SecureYeoman: 0 CVEs (2026)**

### Competitive Comparison

| Feature | SecureYeoman | OpenClaw | NemoClaw | Ironclaw | PicoClaw |
|---|---|---|---|---|---|
| RBAC / SSO / SAML / WebAuthn | Yes | No | No | No | No |
| Sandboxing | 6 modes + Firecracker | Basic | OpenShell | TEE + WASM | Basic |
| Privacy Router | DLP + GPU | No | Gretel DP | No | No |
| Secrets / Vault | SecretsManager | No | No | TEE vault | No |
| MCP Tools | 490 | Limited | Inherits OC | Via path | No |
| CVEs (2026) | 0 | 13+ | Inherits OC | 0 | Pre-prod |
| DAG Workflows | 23 step types | No | No | No | No |
| Integrations | 38 | 23+ | No | ~2 | 11+ |
| Training Pipeline | Full | No | No | No | No |
| Air-Gap / Offline | Full | Yes | Needs GPU | Cloud req | Yes |
| Deployment Tiers | 4 (Prime/Lite/Agent/Edge) | 1 | 1 | 1 | 1 |

---

## The Business Case for Sovereign AI

- **CISO** — Zero CVEs. Not because we're lucky — because we're paranoid.
- **COO** — No cloud dependency means no cloud surprises. Your schedule, your uptime.
- **CFO / Legal** — Every compliance framework needs controls. We ship them, not slide decks.
- **CTO** — One binary. 490 tools. Six fewer vendor contracts.
- **CEO / Board** — Your competitors are patching. You're shipping.

[Read the White Paper](whitepaper.html) — three security pillars, compliance readiness, multi-agent governance.

---

## Getting Started

### Single Binary
```bash
curl -fsSL https://secureyeoman.ai/install | bash
secureyeoman init
secureyeoman start
open http://localhost:18789
```

### Docker
```bash
docker run -d --name secureyeoman \
    -p 18789:18789 \
    -e SECUREYEOMAN_ADMIN_PASSWORD=change-me-32chars \
    -v sy-data:/home/secureyeoman/.secureyeoman \
    ghcr.io/maccracken/secureyeoman:latest
```

### Kubernetes
```bash
helm repo add secureyeoman https://maccracken.github.io/secureyeoman
helm install secureyeoman secureyeoman/secureyeoman \
    --namespace secureyeoman --create-namespace \
    --set adminPassword=change-me-32chars
```

---

Copyright 2026 SecureYeoman — AGPL-3.0
