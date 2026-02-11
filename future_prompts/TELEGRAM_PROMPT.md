# Telegram Integration Implementation Prompt

> Implement P4-003: Telegram platform adapter for F.R.I.D.A.Y.
> This builds on P4-001 (plugin architecture) and P4-002 (message abstraction) which are already complete.

---

## Context

The integration framework is already in place:
- `Integration` interface at `packages/core/src/integrations/types.ts` defines `init()`, `start()`, `stop()`, `sendMessage()`, `isHealthy()`
- `PlatformAdapter` interface at the same location defines `normalizeInbound()`, `formatOutbound()`
- `IntegrationManager` handles lifecycle (register factory, start/stop, health tracking)
- `IntegrationStorage` persists configs + messages in SQLite
- `MessageRouter` bridges inbound messages to `TaskExecutor` and sends responses back
- Shared types at `packages/shared/src/types/integration.ts`: `UnifiedMessage`, `MessageAttachment`, `Platform`, etc.
- REST API routes at `packages/core/src/integrations/integration-routes.ts`
- Dashboard `ConnectionManager` at `packages/dashboard/src/components/ConnectionManager.tsx` shows platform cards + live integration list

---

## Part 1: Telegram Adapter (`packages/core/src/integrations/telegram/`)

### 1.1 Create `packages/core/src/integrations/telegram/adapter.ts`

Implement the `Integration` interface for Telegram:

```typescript
export class TelegramIntegration implements Integration {
  readonly platform = 'telegram' as const;
  // ...
}
```

**Requirements:**
- Use the `grammy` package (https://grammy.dev/) for Telegram Bot API
- Constructor takes no args — config is passed via `init(config, deps)`
- `init()`: Extract `botToken` from `config.config`, create `Bot` instance, register message handlers
- `start()`: Call `bot.start()` with long-polling (NOT webhooks — keep it simple for MVP)
- `stop()`: Call `bot.stop()`
- `sendMessage(chatId, text, metadata)`: Call `bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' })`, return the platform message ID as string
- `isHealthy()`: Return whether the bot is currently polling
- Wire `bot.on('message:text')` to call `deps.onMessage()` with a normalized `UnifiedMessage`
- Wire `bot.command('start')` to send a welcome message
- Wire `bot.command('help')` to send available commands
- Wire `bot.command('status')` to send agent health info

### 1.2 Create `packages/core/src/integrations/telegram/index.ts`

Barrel export:
```typescript
export { TelegramIntegration } from './adapter.js';
```

### 1.3 Register the factory in SecureYeoman

In `packages/core/src/secureyeoman.ts`, after `IntegrationManager` is created (step 6.5), register:

```typescript
import { TelegramIntegration } from './integrations/telegram/index.js';

// In initialize(), after IntegrationManager is created:
this.integrationManager.registerPlatform('telegram', () => new TelegramIntegration());
```

### 1.4 Add `grammy` dependency

```bash
cd packages/core && npm install grammy
```

---

## Part 2: Telegram-specific message normalization

### 2.1 Create `packages/core/src/integrations/telegram/adapter.ts` message handler

In the `init()` method, set up message handling:

```typescript
this.bot.on('message:text', async (ctx) => {
  const msg = ctx.message;
  const unified: UnifiedMessage = {
    id: `tg_${msg.message_id}`,
    integrationId: this.config!.id,
    platform: 'telegram',
    direction: 'inbound',
    senderId: String(msg.from?.id ?? ''),
    senderName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' '),
    chatId: String(msg.chat.id),
    text: msg.text ?? '',
    attachments: [],
    replyToMessageId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
    platformMessageId: String(msg.message_id),
    metadata: {
      chatType: msg.chat.type,
      isBot: msg.from?.is_bot,
    },
    timestamp: msg.date * 1000,
  };
  await this.deps!.onMessage(unified);
});
```

### 2.2 Handle photo/document attachments (stretch goal)

If the message has `msg.photo`, `msg.document`, `msg.voice`, or `msg.video`:
- Extract file_id
- Get file URL via `bot.api.getFile(file_id)`
- Create a `MessageAttachment` with type, url, mimeType, fileName

---

## Part 3: Dashboard connection flow

### 3.1 Update `ConnectionManager.tsx`

The `ConnectionManager` already shows platform cards and fetches from `/api/v1/integrations/platforms`.
Once the Telegram factory is registered, `telegram` will appear as "Available" instead of "Coming Soon".

Add a "Connect" button on available platforms that opens a simple form:
- **Bot Token** input (password field)
- **Display Name** input (e.g., "My Telegram Bot")
- Submit calls `POST /api/v1/integrations` with `{ platform: 'telegram', displayName, enabled: true, config: { botToken } }`
- Then calls `POST /api/v1/integrations/:id/start` to activate

### 3.2 Add start/stop controls on IntegrationCard

For configured integrations, add:
- Start button (calls `POST /api/v1/integrations/:id/start`)
- Stop button (calls `POST /api/v1/integrations/:id/stop`)
- Delete button (calls `DELETE /api/v1/integrations/:id`)

---

## Part 4: Testing

### 4.1 Unit tests (`packages/core/src/integrations/telegram/telegram.test.ts`)

- Test that `TelegramIntegration` implements `Integration`
- Mock `grammy.Bot` to test `init()`, `start()`, `stop()` lifecycle
- Test message normalization (text message → UnifiedMessage)
- Test `sendMessage()` calls the correct API method
- Test error handling (invalid token, network failure)

### 4.2 Integration tests

- Test that registering telegram in IntegrationManager makes it available
- Test creating a telegram integration config
- Test that starting with an invalid token produces an error status

---

## Part 5: Documentation updates

### 5.1 Update `docs/api.md`

Already has integration endpoints documented. No changes needed unless new Telegram-specific endpoints are added.

### 5.2 Update `TODO.md`

Mark P4-003 tasks as complete.

### 5.3 Update `docs/configuration.md`

Add a note about Telegram configuration:
```yaml
# Telegram config is stored at runtime in the integrations database,
# not in secureyeoman.yaml. Use the dashboard or API to configure.
```

---

## Key Design Decisions

1. **Long-polling, not webhooks**: Webhooks require a public URL + TLS cert. Long-polling works everywhere, including localhost. Can add webhook support later.
2. **grammy over node-telegram-bot-api**: grammy is actively maintained, has better TypeScript support, and supports middleware patterns.
3. **Config stored in SQLite, not YAML**: Bot tokens change at runtime and are per-instance secrets. The integration config table is the right place.
4. **Markdown formatting**: Use Telegram's MarkdownV2 parse mode for responses. Escape special characters.

---

## Files to create/modify

| File | Action |
|------|--------|
| `packages/core/src/integrations/telegram/adapter.ts` | Create |
| `packages/core/src/integrations/telegram/index.ts` | Create |
| `packages/core/src/secureyeoman.ts` | Modify (register telegram factory) |
| `packages/core/src/integrations/telegram/telegram.test.ts` | Create |
| `packages/dashboard/src/components/ConnectionManager.tsx` | Modify (add connect form + controls) |
| `packages/dashboard/src/api/client.ts` | Modify (add start/stop/create integration functions) |
| `docs/api.md` | Verify (already updated) |
| `TODO.md` | Update P4-003 status |

---

## Acceptance Criteria

- [ ] `TelegramIntegration` class implements the `Integration` interface
- [ ] Bot connects to Telegram using long-polling
- [ ] Inbound text messages are normalized to `UnifiedMessage` and routed through `MessageRouter`
- [ ] Outbound messages are sent via `bot.api.sendMessage()` with Markdown formatting
- [ ] `/start`, `/help`, `/status` commands respond correctly
- [ ] Dashboard shows Telegram as "Available" when factory is registered
- [ ] Can create, start, stop, and delete a Telegram integration via the dashboard
- [ ] Error states (invalid token, network issues) are handled gracefully
- [ ] All existing 589 tests continue to pass
- [ ] New Telegram tests pass (~10-15 tests)
