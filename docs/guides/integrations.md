# Integration Setup Guide

FRIDAY supports multiple platform integrations for receiving and responding to messages.

## Supported Platforms

| Platform | Status | Features |
|----------|--------|----------|
| Telegram | Stable | Long-polling, commands, text messages |
| Discord  | Stable | Slash commands, embeds, guild messages |
| Slack    | Stable | Socket mode, slash commands, mentions |
| GitHub   | Stable | Webhooks, issue comments, PR events |
| iMessage | Beta   | macOS only, AppleScript send, chat.db polling |

## Telegram

### Setup
1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Copy the bot token
3. Create an integration via the dashboard or API:

```bash
curl -X POST http://localhost:3000/api/v1/integrations \
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
curl -X POST http://localhost:3000/api/v1/integrations \
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
curl -X POST http://localhost:3000/api/v1/integrations \
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
curl -X POST http://localhost:3000/api/v1/integrations \
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

## iMessage (macOS)

### Requirements
- macOS with Messages.app
- Full Disk Access permission granted to the FRIDAY process (needed to read `~/Library/Messages/chat.db`)
- `osascript` available in PATH

### Setup

```bash
curl -X POST http://localhost:3000/api/v1/integrations \
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
```
