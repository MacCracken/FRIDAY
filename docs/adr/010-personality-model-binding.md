# ADR 010: Personality Switching & Default Model Binding

## Status

Accepted

## Context

FRIDAY supports multiple personalities, but the dashboard chat was locked to the active personality. Users needed to switch the active personality (a global setting) just to have a conversation with a different persona. Additionally, different personalities benefit from different models — a creative writing persona may work best with a larger model, while a quick-answer persona can use a smaller, cheaper one.

## Decision

### Per-Session Personality Switching

The chat route (`POST /api/v1/chat`) now accepts an optional `personalityId` field. When provided, `SoulManager.composeSoulPrompt()` composes the system prompt for that specific personality instead of the globally active one. The dashboard ChatPage provides a custom dropdown that shows each personality with its icon, name, and description.

### Default Model Per Personality

Each personality can optionally declare a `defaultModel` (`{ provider, model }` or `null`). When the user switches personalities in the chat, the system automatically switches to that personality's default model. The user can still manually override the model within the session — once overridden, subsequent personality switches will not auto-switch the model until the session resets or the user switches personality again.

### Implementation

- **Schema**: `Personality` gains a `defaultModel` field (nullable JSON object with `provider` and `model`). The SQLite schema includes a migration for existing databases.
- **Chat Route**: Passes `personalityId` through to `composeSoulPrompt(input, personalityId)`.
- **Dashboard**: ChatPage uses a custom dropdown (not native `<select>`) with Bot icon, name, and description. `ModelWidget` gains an `onModelSwitch` callback to signal manual override.
- **PersonalityEditor**: Includes a model selector populated from `GET /api/v1/model/info` available models.

## Consequences

- Users can chat with any personality without changing the global active personality
- Personalities can specify their preferred model, reducing friction when switching contexts
- Manual model override is preserved within a session to respect user intent
- The `defaultModel` field is nullable and optional — existing personalities are unaffected
- Database migration is backward-compatible (adds column with empty-string default)
