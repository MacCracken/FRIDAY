# Integration Setup Guide

FRIDAY supports multiple platform integrations for receiving and responding to messages.

## Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| CLI      | Stable | Built-in REST API / command-line interface |
| Discord  | Stable | Slash commands, embeds, guild messages |
| Email (IMAP/SMTP) | Stable | Any IMAP/SMTP provider — ProtonMail Bridge, Outlook, Yahoo, Fastmail |
| GitHub   | Stable | Webhooks, issue comments, PR events |
| Gmail    | Stable | OAuth2, polling, label filtering, send/receive |
| Google Chat | Stable | Bot messages, card messages, space integration |
| iMessage | Beta   | macOS only, AppleScript send, chat.db polling |
| Slack    | Stable | Socket mode, slash commands, mentions |
| Telegram | Stable | Long-polling, commands, text messages |
| Webhook  | Stable | Generic inbound/outbound HTTP webhooks |

## CLI

### Overview
The CLI integration represents the built-in command-line / REST API interface as a dashboard-visible connection. It requires no external credentials — once connected, it shows as "online" to confirm the local API surface is active.

### Setup

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "cli",
    "displayName": "FRIDAY CLI",
    "enabled": true,
    "config": {}
  }'
```

### How It Works
- **Inbound**: Messages arrive via the REST API or task executor directly
- **Outbound**: `sendMessage()` is a no-op; CLI consumers read responses via API responses
- Rate limit: 100 messages/second

## Telegram

### Setup
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Copy the bot token
3. Create an integration via the dashboard or API:

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "displayName": "My FRIDAY Bot",
    "enabled": true,
    "config": {
      "botToken": "123456:ABC-DEF..."
    }
  }'
```

4. Start the integration: `POST /api/v1/integrations/:id/start`

### Commands
- `/start` — Welcome message
- `/help` — Available commands
- `/status` — Agent status

## Discord

### Setup
1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot user and copy the token
3. Enable **Message Content Intent** in Bot settings
4. Invite the bot to your server with `applications.commands` and `bot` scopes
5. Create an integration:

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "discord",
    "displayName": "FRIDAY Discord",
    "enabled": true,
    "config": {
      "botToken": "...",
      "clientId": "...",
      "guildId": "..."
    }
  }'
```

### Slash Commands
- `/ask <question>` — Ask FRIDAY a question
- `/status` — Check agent status
- `/help` — Show available commands

## Slack

### Setup
1. Create a Slack app at [api.slack.com](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an app-level token (`xapp-...`)
3. Add bot token scopes: `chat:write`, `app_mentions:read`, `im:history`
4. Install to workspace and copy the bot token (`xoxb-...`)
5. Create an integration:

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "slack",
    "displayName": "FRIDAY Slack",
    "enabled": true,
    "config": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }'
```

### Slash Commands
Register these in your Slack app settings:
- `/friday <message>` — Send a message to FRIDAY
- `/friday-status` — Check agent status

## GitHub

### Setup
1. Generate a [Personal Access Token](https://github.com/settings/tokens) with `repo` scope
2. Create a webhook in your repository Settings > Webhooks
3. Set the webhook URL to: `https://your-domain/api/v1/webhooks/github/:integrationId`
4. Set Content type to `application/json`
5. Create a webhook secret and note it
6. Select events: Push, Pull requests, Issues, Issue comments

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "github",
    "displayName": "FRIDAY GitHub",
    "enabled": true,
    "config": {
      "personalAccessToken": "ghp_...",
      "webhookSecret": "your-webhook-secret"
    }
  }'
```

### Supported Events
- `push` — Code push notifications
- `pull_request` — PR opened, closed, merged
- `issues` — Issue opened, closed, labeled
- `issue_comment` — Comments on issues and PRs

### Sending Responses
FRIDAY responds to GitHub events by posting comments. The `chatId` format is:
`owner/repo/issues/123` or `owner/repo/pulls/456`

## Gmail

### Overview
Gmail integration uses OAuth2 for secure access to your Gmail account. FRIDAY polls for new messages using the Gmail History API and can send replies via the Gmail REST API.

### Setup
1. Go to **Dashboard > Connections > Email** tab
2. Click **Connect with Google** to start the OAuth flow
3. Grant permissions to read and/or send emails
4. Configure preferences: display name, read/send toggles, label filter
5. Click **Finish Setup**

### Config Options
- `enableRead` — Poll inbox for new messages (default: on)
- `enableSend` — Allow sending replies (default: off)
- `labelFilter` — `all` (entire inbox), `label` (existing Gmail label), or `custom` (auto-created label)
- `labelName` — Label name when using `label` or `custom` filter
- `pollIntervalMs` — Polling interval in milliseconds (default: 30000)

### Prerequisites
Set these in your `.env` file (or Docker environment):
```bash
GMAIL_OAUTH_CLIENT_ID=your-google-client-id
GMAIL_OAUTH_CLIENT_SECRET=your-google-client-secret
# Can reuse GOOGLE_OAUTH_CLIENT_ID/SECRET if same GCP project
```

### API Setup
```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "gmail",
    "displayName": "user@gmail.com",
    "enabled": true,
    "config": {
      "accessToken": "ya29...",
      "refreshToken": "1//...",
      "email": "user@gmail.com",
      "enableRead": true,
      "enableSend": false,
      "labelFilter": "all"
    }
  }'
```

### Rate Limit
- 2 messages/second

---

## Email (IMAP/SMTP)

### Overview
The generic Email integration connects to any standard IMAP/SMTP mail server. This works with ProtonMail Bridge, Outlook, Yahoo Mail, Fastmail, self-hosted mail servers, and any provider that supports IMAP for reading and SMTP for sending.

FRIDAY uses IMAP IDLE for real-time new mail notifications with a fallback polling interval. Outbound messages are sent via SMTP using nodemailer.

### Setup via Dashboard
1. Go to **Dashboard > Connections > Email** tab
2. Click **Connect** on the **Email (IMAP/SMTP)** card
3. Select a provider preset (ProtonMail Bridge, Outlook, Yahoo) or use Custom
4. Fill in IMAP/SMTP host and port, username, and password
5. Configure TLS, self-signed certs, read/send toggles
6. Click **Connect**

### Setup via API
```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "email",
    "displayName": "My ProtonMail",
    "enabled": true,
    "config": {
      "imapHost": "127.0.0.1",
      "imapPort": 1143,
      "smtpHost": "127.0.0.1",
      "smtpPort": 1025,
      "username": "user@proton.me",
      "password": "your-bridge-password",
      "enableRead": true,
      "enableSend": true,
      "tls": false,
      "rejectUnauthorized": false
    }
  }'
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `imapHost` | string | *(required)* | IMAP server hostname |
| `imapPort` | number | 993 (TLS) / 143 | IMAP server port |
| `smtpHost` | string | *(required)* | SMTP server hostname |
| `smtpPort` | number | 465 (TLS) / 587 | SMTP server port |
| `username` | string | *(required)* | Login username (usually email address) |
| `password` | string | *(required)* | Login password or app-specific password |
| `fromAddress` | string | *(username)* | Sender address for outbound mail |
| `enableRead` | boolean | `true` | Poll IMAP for new messages |
| `enableSend` | boolean | `false` | Allow sending via SMTP |
| `mailbox` | string | `INBOX` | IMAP mailbox to monitor |
| `pollIntervalMs` | number | `30000` | Fallback polling interval (ms) |
| `tls` | boolean | `true` | Use TLS encryption |
| `rejectUnauthorized` | boolean | `true` | Reject self-signed TLS certificates |

### Provider Presets

#### ProtonMail Bridge

[ProtonMail Bridge](https://proton.me/mail/bridge) is a desktop application that runs a local IMAP/SMTP server, allowing any standard email client (or FRIDAY) to connect to your ProtonMail account.

**Install ProtonMail Bridge:**

1. Download from [proton.me/mail/bridge](https://proton.me/mail/bridge)
   - **Linux**: Available as `.deb`, `.rpm`, or via Flatpak/Snap
     ```bash
     # Debian/Ubuntu
     sudo apt install protonmail-bridge

     # Arch (AUR)
     yay -S protonmail-bridge

     # Flatpak
     flatpak install flathub me.proton.Mail.Bridge
     ```
   - **macOS**: Download `.dmg` from the website or `brew install --cask protonmail-bridge`
   - **Windows**: Download `.exe` installer from the website

2. Launch Bridge and sign in with your Proton account
3. Bridge will display your **IMAP/SMTP credentials** (username and a generated password — this is *not* your Proton login password)
4. Note the local server addresses:
   - **IMAP**: `127.0.0.1:1143`
   - **SMTP**: `127.0.0.1:1025`

**Configure in FRIDAY:**

| Setting | Value |
|---------|-------|
| IMAP Host | `127.0.0.1` |
| IMAP Port | `1143` |
| SMTP Host | `127.0.0.1` |
| SMTP Port | `1025` |
| Username | *(shown in Bridge)* |
| Password | *(generated by Bridge — not your Proton password)* |
| TLS | Off |
| Allow Self-Signed | On |

> **Docker note**: If FRIDAY runs in Docker and Bridge runs on the host, use `host.docker.internal` instead of `127.0.0.1` for the IMAP/SMTP host. The `docker-compose.yml` includes `extra_hosts: host.docker.internal:host-gateway` for Linux compatibility.

**Headless / server usage**: ProtonMail Bridge also supports a CLI mode for headless servers:
```bash
protonmail-bridge --cli
# Then: login, info (to see credentials)
```

#### Outlook / Office 365

| Setting | Value |
|---------|-------|
| IMAP Host | `outlook.office365.com` |
| IMAP Port | `993` |
| SMTP Host | `smtp.office365.com` |
| SMTP Port | `587` |
| TLS | On |
| Allow Self-Signed | Off |

> You may need to generate an **app password** if your account has MFA enabled. Go to [Microsoft Account Security](https://account.microsoft.com/security) > Additional security options > App passwords.

#### Yahoo Mail

| Setting | Value |
|---------|-------|
| IMAP Host | `imap.mail.yahoo.com` |
| IMAP Port | `993` |
| SMTP Host | `smtp.mail.yahoo.com` |
| SMTP Port | `465` |
| TLS | On |
| Allow Self-Signed | Off |

> Yahoo requires an **app password**. Go to Yahoo Account Security > Generate app password.

#### Fastmail

| Setting | Value |
|---------|-------|
| IMAP Host | `imap.fastmail.com` |
| IMAP Port | `993` |
| SMTP Host | `smtp.fastmail.com` |
| SMTP Port | `465` |
| TLS | On |
| Allow Self-Signed | Off |

> Use an **app password** from Fastmail Settings > Privacy & Security > Integrations > App Passwords.

### How It Works
- **Inbound**: Connects via IMAP, uses IDLE for real-time new mail notifications, with a configurable fallback poll interval. Messages from your own address are automatically filtered out.
- **Outbound**: Sends via SMTP with support for threading headers (`In-Reply-To`, `References`).
- **Thread grouping**: Messages are grouped into conversations using `In-Reply-To` and `References` email headers.
- **chatId**: Derived from the email thread's `In-Reply-To` header for consistent thread grouping. When sending, `chatId` is the recipient email address.

### Rate Limit
- 2 messages/second

---

## Google Chat

### Setup
1. Create a Google Cloud project and enable the **Google Chat API**
2. Create a **Chat app** with bot identity
3. Configure authentication and get a **Bot Token**
4. Add the bot to a Google Chat space
5. Create an integration:

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "googlechat",
    "displayName": "FRIDAY Google Chat",
    "enabled": true,
    "config": {
      "botToken": "ya29...",
      "spaceId": "spaces/..."
    }
  }'
```

### Config Options
- `botToken` (required) — Google Chat API bot token
- `spaceId` (optional) — Default space to post messages to

### Features
- Text messages to spaces
- Card messages with interactive buttons
- Thread replies

## Webhook

### Overview
The generic webhook integration provides a flexible HTTP-based bridge for connecting external services. Outbound messages are POSTed to a configurable URL; inbound messages are received via a dedicated webhook endpoint with optional HMAC-SHA256 signature verification.

### Setup

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "webhook",
    "displayName": "CI/CD Webhook",
    "enabled": true,
    "config": {
      "webhookUrl": "https://your-service.com/hook",
      "secret": "your-hmac-secret"
    }
  }'
```

### Config Options
- `webhookUrl` (optional) — URL to POST outbound messages to
- `secret` (optional) — HMAC-SHA256 shared secret for signing/verifying payloads

### Inbound Webhooks
External services can POST to:
```
POST /api/v1/webhooks/custom/:integrationId
```

**Request body** (JSON):
```json
{
  "senderId": "external-system",
  "senderName": "CI Pipeline",
  "chatId": "channel-1",
  "text": "Build #42 passed",
  "metadata": { "source": "github-actions" }
}
```

**Signature verification**: If a `secret` is configured, include an `X-Webhook-Signature` header with the HMAC-SHA256 signature: `sha256=<hex digest>`.

### Outbound Messages
When FRIDAY sends a message via this integration, it POSTs to the configured `webhookUrl`:
```json
{
  "chatId": "channel-1",
  "text": "Response from FRIDAY",
  "metadata": {},
  "timestamp": 1707840000000
}
```

### Rate Limit
- 30 messages/second

## iMessage (macOS)

### Requirements
- macOS with Messages.app
- Full Disk Access permission granted to the FRIDAY process (needed to read `~/Library/Messages/chat.db`)
- `osascript` available in PATH

### Setup

```bash
curl -X POST http://localhost:18789/api/v1/integrations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "imessage",
    "displayName": "FRIDAY iMessage",
    "enabled": true,
    "config": {
      "pollIntervalMs": 5000
    }
  }'
```

### Config Options
- `pollIntervalMs` (optional, default: 5000) — How often to check for new messages
- `chatDb` (optional) — Custom path to the Messages database (defaults to `~/Library/Messages/chat.db`)

### How It Works
- **Inbound**: Polls `chat.db` for new messages at the configured interval
- **Outbound**: Uses AppleScript (`osascript`) to send messages via Messages.app
- **chatId**: The recipient's phone number or Apple ID email address

### Limitations
- macOS only — will not work on Linux or Windows
- Requires Full Disk Access for the process
- Rate limited to 5 messages/second to avoid overwhelming Messages.app

## API Reference

### List Platforms
```
GET /api/v1/integrations/platforms
```

### CRUD Operations
```
GET    /api/v1/integrations
POST   /api/v1/integrations
GET    /api/v1/integrations/:id
PUT    /api/v1/integrations/:id
DELETE /api/v1/integrations/:id
```

### Lifecycle
```
POST /api/v1/integrations/:id/start
POST /api/v1/integrations/:id/stop
```

### Messages
```
GET  /api/v1/integrations/:id/messages
POST /api/v1/integrations/:id/messages
```

### Webhooks
```
POST /api/v1/webhooks/github/:id
POST /api/v1/webhooks/custom/:id
```

---

## MCP Service (`@friday/mcp`)

### Overview
The MCP service package (`@friday/mcp`) is a standalone MCP (Model Context Protocol) server that exposes FRIDAY's internal capabilities as MCP tools, resources, and prompts. It supports Claude Desktop via stdio, browser-based clients via SSE, and API access via Streamable HTTP.

### Prerequisites
- A running FRIDAY core instance
- `SECUREYEOMAN_TOKEN_SECRET` set in your `.env` file (shared with core)

### Step 1: Configure Environment

The MCP service self-mints a service JWT on startup using the shared `SECUREYEOMAN_TOKEN_SECRET`. No manual token is needed.

Add to your `.env` file (if not already set):

```bash
MCP_ENABLED=true
# SECUREYEOMAN_TOKEN_SECRET is already set for core — MCP uses it automatically
```

### Step 2: Start the MCP Service

**Local development:**

```bash
npm run dev:mcp
```

**Docker Compose:**

```bash
# Start core + MCP
docker compose --profile mcp up

# Or start everything (core + dashboard + MCP)
docker compose --profile full up
```

> In Docker, `MCP_CORE_URL` is automatically set to `http://core:18789` via the compose file. Do not override it in `.env` when using Docker.

**Claude Desktop (stdio):**

Add to your Claude Desktop MCP config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "friday": {
      "command": "node",
      "args": ["/path/to/friday/packages/mcp/dist/cli.js", "--transport", "stdio"],
      "env": {
        "MCP_CORE_URL": "http://127.0.0.1:18789",
        "SECUREYEOMAN_TOKEN_SECRET": "<your-token-secret>"
      }
    }
  }
}
```

### Step 3: Verify

```bash
# Dashboard endpoint (returns server status)
curl http://localhost:3001/dashboard

# Check auto-registration with core
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:18789/api/v1/mcp/servers
```

The MCP service should appear in core's MCP server list and on the dashboard MCP Servers page.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_ENABLED` | `true` | Master kill switch — set to `false` to prevent startup |
| `MCP_PORT` | `3001` | HTTP server port |
| `MCP_HOST` | `127.0.0.1` | Bind address |
| `MCP_TRANSPORT` | `streamable-http` | Transport: `stdio`, `sse`, `streamable-http` |
| `MCP_AUTO_REGISTER` | `true` | Auto-register with core on startup |
| `MCP_CORE_URL` | `http://127.0.0.1:18789` | Core gateway URL |
| `SECUREYEOMAN_TOKEN_SECRET` | *(required)* | Shared JWT secret — MCP self-mints a service token |
| `MCP_EXPOSE_FILESYSTEM` | `false` | Enable filesystem tools (admin-only) |
| `MCP_ALLOWED_PATHS` | *(empty)* | Comma-separated allowed fs paths |
| `MCP_RATE_LIMIT_PER_TOOL` | `30` | Max tool calls/second/tool |
| `MCP_LOG_LEVEL` | `info` | Log level |

### Available Tools

| Category | Tools | Description |
|----------|-------|-------------|
| **Brain** | `knowledge_search`, `knowledge_get`, `knowledge_store`, `memory_recall` | Search and manage FRIDAY's knowledge base and memories |
| **Tasks** | `task_create`, `task_list`, `task_get`, `task_cancel` | Create and manage agent tasks |
| **System** | `system_health`, `system_metrics`, `system_config` | Monitor system health and configuration |
| **Integrations** | `integration_list`, `integration_send`, `integration_status` | Manage platform integrations |
| **Soul** | `personality_get`, `personality_switch`, `skill_list`, `skill_execute` | Interact with personality and skills |
| **Audit** | `audit_query`, `audit_verify`, `audit_stats` | Query and verify the audit chain |
| **Filesystem** | `fs_read`, `fs_write`, `fs_list`, `fs_search` | File operations (opt-in, admin-only, path-restricted) |

### Available Resources

| URI | Description |
|-----|-------------|
| `friday://knowledge/all` | All knowledge entries |
| `friday://knowledge/{id}` | Single knowledge entry by ID |
| `friday://personality/active` | Active personality profile |
| `friday://personality/{id}` | Specific personality by ID |
| `friday://config/current` | Current system configuration (secrets redacted) |
| `friday://audit/recent` | Recent audit log entries |
| `friday://audit/stats` | Audit statistics |

### Available Prompts

| Prompt | Description |
|--------|-------------|
| `friday:compose-prompt` | Compose a system prompt from personality and skills |
| `friday:plan-task` | Plan a multi-step agent task |
| `friday:analyze-code` | Analyze code for quality and issues |
| `friday:review-security` | Review code or config for security concerns |

### Security

- All tool calls are authenticated by delegating JWT validation to core's `POST /api/v1/auth/verify`
- RBAC permissions are enforced per-tool using the same permission model as core API endpoints
- Every tool call is logged to the audit chain
- Tool outputs are passed through a secret-redactor that strips tokens, keys, and passwords
- Filesystem tools are disabled by default and require `admin` role + explicit path allowlist
- Input validation detects SQL injection, command injection, XSS, and template injection attempts
- Rate limiting is applied per-tool (default: 30 calls/second)

### Troubleshooting

**MCP service can't connect to core:**
- Verify core is running: `curl http://localhost:18789/health`
- Check `MCP_CORE_URL` matches core's actual address
- In Docker, use `http://core:18789` (not `localhost`)

**Authentication failures:**
- Ensure `SECUREYEOMAN_TOKEN_SECRET` matches the value used by core
- The MCP service self-mints a service JWT on startup — no manual token management needed

**Auto-registration not working:**
- Set `MCP_AUTO_REGISTER=true` (default)
- Check core logs for errors on `POST /api/v1/mcp/servers`

**Filesystem tools not available:**
- Set `MCP_EXPOSE_FILESYSTEM=true` and `MCP_ALLOWED_PATHS=/path/one,/path/two`
- Requires `admin` role on the authenticating token
