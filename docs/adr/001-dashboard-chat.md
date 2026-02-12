# ADR 001: Dashboard Chat

## Status

Accepted

## Context

Users could only interact with the active personality through external integrations (Telegram, Discord, Slack, etc.) or agent-to-agent comms. There was no way to have a direct conversation from the dashboard itself, making it difficult to test personalities, debug prompt composition, or quickly interact with the system without configuring an external platform.

## Decision

Add an in-dashboard Chat tab that:

- Uses `SoulManager.composeSoulPrompt()` to build the system prompt with full personality, traits, brain context, and skills
- Sends messages through `AIClient.chat()` directly (same path as integrations)
- Manages conversation history client-side only (session state, not persisted)
- Passes the full message history to the backend on each request so the AI has conversation context
- Includes a Model Info widget for viewing/switching the underlying AI model at runtime

### API

- `POST /api/v1/chat` accepts `{ message, history? }` and returns `{ role, content, model, provider, tokensUsed }`

## Consequences

- **Stateless**: No chat persistence. Refreshing the page clears the conversation. This is intentional to avoid scope creep and privacy concerns.
- **History in request**: Full message history is sent with each request, which means large conversations will consume more tokens. This is acceptable for a dashboard testing tool.
- **Leverages existing infrastructure**: No new AI provider code, no new storage, no new auth — just wiring existing components together.
- **Token cost**: Dashboard chat uses the same AI client and token limits as integrations.
