# Phase 4 Review & Platform Adapter Plan

> Review the integration framework (P4-001/P4-002), assess readiness for platform adapters, and plan the implementation path for Telegram (P4-003), Discord (P4-004), Slack (P4-005), and GitHub (P4-007).

---

## Framework Review (P4-001 & P4-002)

### What's Built

The integration framework at `packages/core/src/integrations/` provides:

**Interfaces** (`types.ts`):
- `Integration`: `init()`, `start()`, `stop()`, `sendMessage()`, `isHealthy()`
- `PlatformAdapter`: `normalizeInbound()`, `formatOutbound()`
- `IntegrationDeps`: `{ logger, onMessage }` — provided to adapters during `init()`

**Storage** (`storage.ts`):
- SQLite tables: `integrations` (config + status), `integration_messages` (history)
- CRUD operations, status updates, message storage with pagination
- Foreign key cascade on deletion

**Manager** (`manager.ts`):
- Factory registration: `registerPlatform(name, () => new Adapter())`
- Lifecycle: `startIntegration()` calls `init()` then `start()`, `stopIntegration()` calls `stop()`
- Health tracking, running count, auto-start enabled integrations
- `sendMessage()` routes outbound through running adapter

**Router** (`message-router.ts`):
- `handleInbound(UnifiedMessage)`: stores message → creates task → sends response back
- ExecutionContext: userId = `{platform}:{senderId}`, role = `operator`
- Error responses sent back to platform on task failure

**REST API** (`integration-routes.ts`):
- Full CRUD + start/stop + message list/send
- RBAC enforced on all endpoints

**Wiring** (`secureyeoman.ts`):
- Step 5.75: IntegrationStorage initialized
- Step 6.5: IntegrationManager + MessageRouter wired after TaskExecutor

**Tests**: 24 tests covering storage, manager, and router.

### Framework Assessment

**Strengths:**
1. Clean separation of concerns (storage/manager/router/adapter)
2. Factory pattern makes adding platforms straightforward
3. UnifiedMessage schema covers text + attachments + metadata
4. Error handling is graceful (adapter failures → error status, not crashes)
5. Message history persisted for all platforms

**Gaps to Address Before More Adapters:**

1. **No conversation context**: MessageRouter submits each message as an independent task. Multi-turn conversations need context preservation.
   - **Fix**: Add a `ConversationManager` that maintains per-chatId message history and passes recent context to TaskExecutor.

2. **No media handling**: `MessageAttachment` type exists but no download/upload pipeline.
   - **Fix for P4-003**: Download Telegram files via `bot.api.getFile()`, store locally or as base64. Send as attachments in UnifiedMessage.

3. **Synchronous response assumption**: MessageRouter tries to get a response from the submitted task immediately. If the task is async (queued), no response is sent.
   - **Fix**: Add a callback mechanism or polling loop to wait for task completion with a timeout.

4. **No rate limiting per platform**: Platform APIs have their own rate limits (Telegram: 30 msg/s, Discord: 50 req/s).
   - **Fix**: Add per-platform rate limiter in IntegrationManager or as middleware in each adapter.

5. **No reconnection logic**: If an adapter's connection drops, there's no auto-reconnect.
   - **Fix**: Add reconnect with exponential backoff in IntegrationManager. Monitor `isHealthy()` periodically.

---

## Platform Implementation Plan

### P4-003: Telegram (See TELEGRAM_PROMPT.md)

**Status**: Prompt written, ready to implement.
**Complexity**: Low — grammy handles most complexity.
**Timeline**: 1-2 sessions.

### P4-004: Discord

**Package**: `discord.js` v14
**Complexity**: Medium — guild management, slash commands, embeds.

**Key Implementation Points:**
1. Create `packages/core/src/integrations/discord/adapter.ts`
2. Use `Client` with `GatewayIntentBits.Guilds`, `GuildMessages`, `MessageContent`
3. Register slash commands: `/ask <question>`, `/status`, `/help`
4. Handle `messageCreate` event → normalize to UnifiedMessage
5. Send responses as embeds (richer formatting than plain text)
6. Thread support: when replying, create/continue a thread for multi-turn
7. `sendMessage()` maps chatId to channel ID, sends via `channel.send()`

**Config**: `{ botToken, guildId? (optional, for slash command registration) }`

**Differences from Telegram:**
- Discord uses Gateway (WebSocket), not polling — `client.login(token)` handles this
- Slash commands need `REST.put(Routes.applicationCommands())` for registration
- Rich embeds instead of Markdown
- Thread-based conversations (Discord threads map well to conversation context)

### P4-005: Slack

**Package**: `@slack/bolt`
**Complexity**: Medium-High — event subscriptions, interactive messages, modals.

**Key Implementation Points:**
1. Create `packages/core/src/integrations/slack/adapter.ts`
2. Use Bolt's `App` class with socket mode (no public URL needed, like Telegram polling)
3. Listen for `message` events and `app_mention` events
4. Register slash commands: `/friday <question>`, `/friday-status`
5. Respond with Block Kit messages (Slack's rich formatting)
6. Handle interactive components (buttons, modals) for skill selection
7. `sendMessage()` maps chatId to channel ID, sends via `client.chat.postMessage()`

**Config**: `{ botToken, appToken (for socket mode), signingSecret }`

**Differences:**
- Slack requires both a Bot Token AND an App Token for socket mode
- Block Kit is more complex than Markdown or Discord embeds
- `app_mention` is the primary trigger in channels (not all messages)

### P4-007: GitHub

**Package**: `@octokit/rest` + `@octokit/webhooks`
**Complexity**: High — webhooks, PR review, issue management.

**Key Implementation Points:**
1. Create `packages/core/src/integrations/github/adapter.ts`
2. GitHub is event-driven (webhooks), not conversational — different pattern
3. Register Fastify route for webhook endpoint: `POST /api/v1/integrations/github/webhook`
4. Handle events: `push`, `pull_request`, `issues`, `issue_comment`
5. Normalize webhook payloads to UnifiedMessage (sender = GitHub user, text = event description)
6. `sendMessage()` maps to: create issue comment, PR review, or commit status
7. Implement specific actions:
   - PR review: AI analyzes diff, posts review comments
   - Issue triage: AI labels and assigns based on content
   - Commit analysis: AI summarizes changes

**Config**: `{ personalAccessToken or appId + privateKey, webhookSecret }`

**This is NOT a messaging platform** — it's more of an event-driven integration. Consider whether it should implement `Integration` or a separate `WebhookIntegration` interface.

---

## Recommended Implementation Order

```
P4-003 (Telegram)     → Validates the adapter pattern
    ↓
ConnectionManager     → Dashboard can create/start/stop integrations
    ↓
P4-004 (Discord)      → Second adapter, proves abstraction works
    ↓
P4-005 (Slack)        → Third adapter, socket mode pattern
    ↓
Conversation Context  → Multi-turn support needed for all platforms
    ↓
P4-007 (GitHub)       → Different pattern (webhooks, not chat)
```

### Cross-Cutting Concerns (implement alongside adapters)

1. **Conversation context** — after Telegram, before Discord
2. **Media handling** — implement download pipeline for Telegram, reuse for Discord/Slack
3. **Per-platform rate limiting** — add to IntegrationManager before third adapter
4. **Auto-reconnect** — add to IntegrationManager, test with Telegram disconnect
5. **Platform-specific config validation** — Zod schemas per platform in shared types

---

## Framework Improvements to Make

### Before P4-004 (Discord)

1. **ConversationManager** (`packages/core/src/integrations/conversation.ts`):
   - Maintain per-chatId sliding window of recent messages
   - Pass conversation history to TaskExecutor as context
   - Configurable window size (default: 10 messages, 30 minutes)

2. **Auto-reconnect in IntegrationManager**:
   - Health check interval (every 30s)
   - If `isHealthy()` returns false, call `stop()` then `start()`
   - Exponential backoff on repeated failures (max 5 retries)
   - Set status to 'error' with message after max retries

3. **Per-platform rate limiter**:
   - Add `platformRateLimit` field to Integration interface (optional)
   - IntegrationManager wraps `sendMessage()` with rate limiting
   - Default limits: Telegram 30/s, Discord 50/s, Slack 1/s

### Before P4-007 (GitHub)

4. **WebhookIntegration interface** (extends Integration):
   - Adds `getWebhookRoute()` returning Fastify route config
   - Adds `verifyWebhook(request)` for signature validation
   - IntegrationManager registers webhook routes dynamically

5. **Media download pipeline**:
   - `downloadFile(url, maxSizeMb)` utility in integrations
   - Store downloaded files in `dataDir/media/` with cleanup schedule
   - Create MessageAttachment with local file path

---

## Acceptance Criteria for Phase 4 Overall

- [ ] Telegram adapter connects and exchanges messages
- [ ] Discord adapter handles slash commands and message events
- [ ] Slack adapter works in socket mode with @mentions
- [ ] GitHub adapter processes webhook events (PR, issues)
- [ ] Conversation context preserved across multi-turn chats
- [ ] Auto-reconnect handles transient disconnections
- [ ] Per-platform rate limiting prevents API abuse
- [ ] All adapters registered via factory pattern in SecureYeoman
- [ ] Dashboard ConnectionManager can manage all platforms
- [ ] At least 50 new integration tests
- [ ] All existing tests continue to pass
