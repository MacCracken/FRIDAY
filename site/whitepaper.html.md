# Architectural Sovereignty & Agentic Governance

**White Paper** | April 2026 | SecureYeoman v0.5.0

Mitigating the Risks of Autonomous AI in Enterprise Environments. How SecureYeoman's three-pillar security model enables governed autonomy — full agent capability without cloud dependency or compliance exposure.

---

## Executive Summary

As autonomous agents move from experimental scripts to enterprise tools, they introduce three critical attack vectors: **Data Exfiltration**, **Unauthorized System Mutation**, and **Credential Exposure**. While "viral" agents prioritize autonomy at the expense of security, SecureYeoman is engineered as a **Governed AI Framework** — delivering the full utility of an autonomous agent within a Zero-Trust architectural boundary. Every tool call is gated, every action is logged, and every secret stays inside your perimeter.

---

## Section 1: The Three Pillars of SecureYeoman

### I. Execution Sovereignty — Sandboxing

Unlike agents that run on the host OS with inherited user permissions, SecureYeoman uses multi-layer isolation that scales with risk level:

- **Kernel-level restriction** — Landlock and seccomp confine the agent to specific file paths and system calls (macOS: sandbox-exec profile applied automatically).
- **WASM / gVisor support** — For high-risk tasks, code executes inside wasmtime or gVisor, preventing container escapes. Toggled via Security Policy flags.
- **Skill Trust Tiers** — Community-imported skills receive a 26-prefix allow-list; write-capable and network-egress tools require operator promotion to a higher tier.
- **ToolOutputScanner** — 20-pattern credential redaction replaces API keys, JWTs, and PEM material with `[REDACTED:<type>]` before any LLM response surfaces.
- **Data Loss Prevention** — Content classification (PII regex + keyword + custom patterns, 4-tier levels), DLP policy engine (block/warn/log), egress scanning with z-score anomaly detection, invisible watermarking (3 algorithms). 22 REST endpoints, 6 MCP tools.
- **Supply Chain Security** — SBOM generation (CycloneDX), SLSA Level 3 provenance (Sigstore), signed releases (cosign), compliance mapping across NIST 800-53, SOC 2, ISO 27001, HIPAA, and EU AI Act.

### II. Hardened Policy Gating — The OPA Layer

Intent is decoupled from execution. Even a compromised LLM cannot bypass the policy layer:

- **Organizational Intent** — Machine-readable governance: Hard Boundaries (e.g., "never access /etc/shadow"), Soft Policies evaluated by OPA sidecar or built-in CEL evaluator.
- **Authorized Tool Gating** — Every tool call is validated before execution. LLM-as-Judge secondary review fires above a configurable autonomy threshold.
- **ResponseGuard** — Six-pattern output scanner (instruction injection, cross-turn influence, self-escalation, role confusion, base64/hex exfiltration) runs on every response.
- **Prompt Security** — Jailbreak scoring, system-prompt trigram leak detection, and AbuseDetector (topic pivots, tool anomaly, blocked-retry cool-down) guard the ingress channel.

### III. Cryptographic Accountability — Audit Trails

Standard logs are insufficient for AI forensics. SecureYeoman implements tamper-evident records for every operation:

- **HMAC-SHA256 Audit Chain** — Each event is hashed with the previous record's hash, producing a verifiable chain. `repair()` and `createSnapshot()` self-heal gaps.
- **Correlation IDs** — UUIDv7 per request via AsyncLocalStorage, present in every audit entry and the `X-Correlation-ID` response header.
- **mTLS everywhere** — All internal service communication secured via Mutual TLS. TLS lifecycle manager auto-generates dev certs and monitors expiry.
- **SecretsManager** — Pluggable backends (env / OS keyring / encrypted file / HashiCorp Vault / OpenBao). Outbound Credential Proxy injects Authorization headers so the model never sees raw keys.

---

## Section 2: Why Enterprise Teams Choose SecureYeoman

| Risk Category | Consumer / Open-Source Agents | SecureYeoman |
|---|---|---|
| Credential Management | Plaintext .env or hardcoded keys | Outbound Credential Proxy + SecretsManager — model never sees raw keys |
| Data Residency | Cloud-based processing (SaaS) | 100% local / sovereign — Ollama, LM Studio, LocalAI, DeepSeek |
| Identity & Access | Single-user / no auth | SSO/OIDC (Okta, Azure AD, Auth0) + SAML 2.0 + 4-level RBAC |
| Action Validation | "Ask for permission" prompts | OPA policy gating + CEL evaluator + Skill Trust Tiers |
| Audit & Forensics | Text log files | HMAC-SHA256 cryptographic chain + JSONL / CSV / syslog export |
| Multi-Tenancy | Single-tenant by design | PostgreSQL RLS-enforced isolation; tenant CRUD API |
| Supply Chain Risk | Unvetted plugin ecosystems (10+ CVEs, 1,184+ malicious skills in leading competitor) | Skill Trust Tiers + ToolOutputScanner + install pipeline with code review gate |

**The TrustClaw problem:** TrustClaw (a security-focused OpenClaw fork) markets "Remote Sandboxing" and "Encrypted Credentials" — but both run on TrustClaw's cloud servers. Your secrets still leave your perimeter. SecureYeoman's Outbound Credential Proxy keeps every key inside your infrastructure at every hop.

**The Manus AI problem:** Manus AI offers 3-minute SaaS onboarding — but Manus holds all conversation data and credentials. One GDPR audit, one HIPAA requirement, or one air-gap mandate eliminates it as an option. SecureYeoman installs in a single command and runs entirely on your infrastructure, permanently.

---

## Section 3: Compliance Readiness

SecureYeoman provides the technical controls necessary to satisfy modern regulatory frameworks:

- **GDPR / CCPA** — No Third-Party Transfer. Local-first processing — no data leaves your deployment boundary.
- **SOC 2 / ISO 27001** — Access Control + Audit. RBAC, HMAC audit chain, SSO/SAML, automated backup & DR.
- **HIPAA** — Air-Gap Deployment. Full self-hosted mode with Ollama local-model routing — no cloud dependency.
- **NIST AI RMF** — Governance & Accountability. Organizational Intent policy file, OPA sidecar, LLM-as-Judge review.
- **EU AI Act** — Human Oversight. L3 autonomy level with human_approval workflow gates; Autonomy Level per workflow.

---

## Section 4: Multi-Agent Governance

As deployments grow from a single agent to autonomous fleets, governance surface area expands. SecureYeoman addresses this with layered controls at every orchestration level:

- **Swarms** — Sequential, parallel, and dynamic topologies; each run audited as a named delegation chain.
- **Council of AIs** — Multi-round group deliberation with facilitator-driven consensus, until_consensus and majority voting strategies.
- **Teams** — A coordinator LLM reads member descriptions and dynamically assigns tasks per run. Coordinator reasoning stored on the run record for post-hoc review.
- **DAG Workflows** — 23 step types, OR-trigger dependencies (`triggerMode: 'any'`), strict schema enforcement, and human approval gates. Autonomy levels (L2 human-on-the-loop / L3 human-in-the-loop) declared per workflow.
- **A2A Protocol** — Agent-to-agent delegation with E2E encryption and mDNS peer discovery. Gated via `allowA2A` security policy toggle.
- **Sub-Agent Controls** — Maximum delegation depth and token budget enforced at the engine level, not by prompt.

---

## Section 5: Observability & Operations

- **Mission Control Dashboard** — 12 customizable drag-and-drop cards: KPI bar, active tasks, security events, audit stream, cost breakdown, agent world map.
- **OpenTelemetry** — Distributed tracing with OTLP export; `X-Trace-Id` response header; ECS-format structured logs.
- **Alert Engine** — Dot-notation metric rules with cooldown, 5 channel types (Slack, PagerDuty, OpsGenie, webhook, ntfy). Evaluated every 5 seconds.
- **API Gateway Mode** — Expose personalities as API endpoints with per-key RPM/TPD rate limits and p50/p95 latency analytics.
- **Prometheus / Grafana** — Metrics endpoint ready; Kubernetes Helm chart includes HPA, PDBs, and NetworkPolicies.
- **Backup & DR** — `pg_dump`/`pg_restore` via 6 REST endpoints; download + restore with confirm guard.

---

## Conclusion: Governed Autonomy — The Third Path

The choice is no longer between AI Productivity and Corporate Security. SecureYeoman offers a third path: full agent capability, inside your perimeter, under your governance. The AI is treated as a high-privilege user — continuously monitored, technically bounded, and cryptographically accountable to you alone.

---

SecureYeoman v0.5.0 | 40 ADRs | AGPL-3.0 + Commercial License
