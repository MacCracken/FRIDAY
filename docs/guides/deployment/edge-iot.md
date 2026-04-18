# Edge/IoT Binary

Deploy SecureYeoman to edge and IoT devices with `secureyeoman-edge` — a static Rust binary (`sy-edge`, ~8 MB) with zero runtime dependencies. Runs on any Linux target including the 10 MB AGNOS edge container.

---

## Installation

### Install script (recommended)

```bash
curl -fsSL https://get.secureyeoman.dev | bash -s -- --edge
```

This downloads the correct binary for your architecture (currently linux-x64) and places it in `/usr/local/bin/`.

### Build from source

```bash
git clone https://github.com/maccracken/secureyeoman.git
cd secureyeoman
./scripts/build-binary.sh --edge
# Outputs: dist/secureyeoman-<date>-edge-linux-x64
```

Cross-compilation for arm64/armv7/riscv64 will return in a follow-up; the native-arch Rust build is statically linked.

---

## Configuration

Configuration is handled through environment variables and CLI flags. CLI flags take precedence.

| Env Var | CLI Flag | Default | Description |
|---------|----------|---------|-------------|
| `SECUREYEOMAN_EDGE_PORT` | `--port` | `18891` | Listen port |
| `SECUREYEOMAN_EDGE_HOST` | `--host` | `0.0.0.0` | Bind address |
| `SECUREYEOMAN_EDGE_LOG_LEVEL` | `--log-level` | `info` | Log level (debug/info/warn/error) |
| `SECUREYEOMAN_EDGE_PARENT_URL` | `--parent-url` | — | Parent instance URL |
| `SECUREYEOMAN_EDGE_API_TOKEN` | — | — | Bearer token for auth (required) |
| `SECUREYEOMAN_EDGE_REGISTRATION_TOKEN` | `--registration-token` | — | Token for A2A registration |

LLM and messaging providers auto-configure from standard env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_HOST`, `SLACK_WEBHOOK_URL`, `DISCORD_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`, etc.).

---

## Quick Start

```bash
export SECUREYEOMAN_EDGE_API_TOKEN="your-secret-token"

# Start the edge node
secureyeoman-edge start --port 18891 --parent-url https://hub.example.com

# In another terminal, verify it's running
curl -H "Authorization: Bearer your-secret-token" http://localhost:18891/health
```

---

## A2A Registration

Edge nodes participate in SecureYeoman's Agent-to-Agent network as peers with heartbeat and trust levels.

### Register with a parent instance

```bash
secureyeoman-edge register \
  --parent-url https://hub.example.com \
  --registration-token "token-from-parent"
```

On first connection, the edge node pins the parent's TLS certificate using TOFU (Trust On First Use). The SHA-256 hash is stored in `parent-cert-pin.hex` and enforced on all subsequent requests.

### Trust levels

Peers progress through trust levels: `unknown` -> `discovered` -> `registered` -> `verified`. Only `registered` and `verified` peers can delegate tasks.

### mDNS discovery

Edge nodes advertise themselves on the local network via `_secureyeoman._tcp`. Other nodes on the same LAN auto-discover and register as peers:

```bash
# Discovery runs automatically on start; no configuration needed
secureyeoman-edge start  # broadcasts and listens for mDNS
```

---

## Key Features

### Sandboxed Command Execution

Execute commands with allowlist/blocklist controls, timeout enforcement, and workspace root restriction.

```bash
curl -X POST http://localhost:18891/sandbox/exec \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "command": "df -h",
    "timeout": 5000,
    "workspaceRoot": "/opt/edge-data"
  }'
```

Symlinks are resolved to prevent escaping the workspace. Output is truncated at 64 KB.

### Interval Scheduler

Schedule recurring tasks of three types: `command`, `webhook`, and `llm`. Minimum interval is 10 seconds.

```bash
curl -X POST http://localhost:18891/scheduler/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "command",
    "command": "uptime",
    "intervalSeconds": 60,
    "name": "uptime-check"
  }'
```

### Outbound Messaging

Send notifications to Slack, Discord, Telegram, or generic webhooks. Targets auto-configure from env vars. The `GET /messaging/targets` endpoint returns redacted targets (URLs and tokens are never exposed).

### Multi-Provider LLM

Route LLM requests through OpenAI, Anthropic, Ollama, or OpenRouter. SSRF protection blocks requests to private IPs (except Ollama on localhost).

```bash
curl -X POST http://localhost:18891/llm/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "ollama",
    "model": "llama3",
    "messages": [{"role": "user", "content": "Summarize system health"}]
  }'
```

### Persistent Memory

Namespaced key-value store with TTL support, backed by a JSON file. Atomic writes via temp-file-and-rename. Limits: 1 MB per value, 10K entries.

```bash
# Write
curl -X PUT http://localhost:18891/memory/sensors/temperature \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": "22.5", "ttl": 3600}'

# Read
curl -H "Authorization: Bearer $TOKEN" http://localhost:18891/memory/sensors/temperature
```

### System Metrics

CPU, memory, and disk metrics are collected every 10 seconds into a ring buffer (1 hour of history). Available as JSON or Prometheus text format at `/metrics`.

### Capability Detection

The node auto-detects CPU, GPU (NVIDIA/AMD/Intel), memory, architecture, and OS. A deterministic node ID is derived from hostname + architecture. Add custom tags for fleet filtering.

---

## Fleet Management

The dashboard provides a fleet overview panel at **Infrastructure -> Fleet**.

- **Overview cards:** total nodes, online, offline, GPU-equipped
- **Sortable table:** status, hostname, architecture, memory, GPU, tags, last seen
- **Auto-refresh:** every 30 seconds via TanStack Query

The parent instance aggregates metrics and capabilities from all registered edge nodes.

---

## OTA Updates

Edge nodes can check for and apply updates from the parent instance:

```bash
curl -X POST http://localhost:18891/update-check \
  -H "Authorization: Bearer $TOKEN"
```

The update process downloads the new binary, verifies its SHA-256 checksum, and performs an atomic binary swap. The node does **not** auto-restart — leave that to your process supervisor (systemd, Docker, etc.).

---

## Security Considerations

- **Auth is mandatory.** Set `SECUREYEOMAN_EDGE_API_TOKEN` before starting. All endpoints except `/health` require a valid bearer token, compared in constant time.
- **Rate limiting** is enabled by default: 100 requests/second per IP with burst up to 200. Stale buckets are cleaned every 5 minutes.
- **TOFU certificate pinning** prevents MITM after first connection to the parent. Delete `parent-cert-pin.hex` to re-pin if you rotate certificates.
- **Sandbox restrictions:** Commands must pass the allowlist and must not match the blocklist. Symlinks are resolved before checking workspace boundaries.
- **SSRF protection:** LLM provider URLs are validated to block private IP ranges (RFC 1918, link-local). Ollama on localhost is explicitly allowed.
- **Secret redaction:** Messaging target URLs and tokens are never returned in API responses.
- **Error sanitization:** Internal error details are stripped from HTTP responses to prevent information leakage.

---

## Legacy TypeScript Edge Runtime

A TypeScript `EdgeRuntime` still lives at `packages/core/src/edge/` from the Node-based era, but it is **not** the shipping edge for 0.5.0+ — the Rust `sy-edge` binary (this page's subject) replaces it. The TS runtime is retained only for the few TS packages that still import it during the migration and will be removed once the last caller is ported.
