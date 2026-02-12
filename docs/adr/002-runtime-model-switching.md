# ADR 002: Runtime Model Switching

## Status

Accepted

## Context

The AI model was fixed at startup via environment variables and the YAML config file. Changing the model required editing config and restarting the process. This made it impossible to:

- Quickly test different models during development
- Switch to a cheaper model for low-priority tasks
- Fall back manually when a provider has issues

## Decision

Add a `switchModel(provider, model)` method to `SecureYeoman` that:

- Validates the provider is one of: `anthropic`, `openai`, `gemini`, `ollama`
- Creates a new `AIClient` instance with the updated provider and model, inheriting existing `maxTokens`, `temperature`, and other settings from the current config
- Replaces the `this.aiClient` reference so all subsequent requests use the new model
- Updates the in-memory config (via `this.config.model`) so `getConfig()` reflects the change
- Records an audit event for traceability

### API

- `GET /api/v1/model/info` returns the current model config and a list of all available models grouped by provider (with pricing from the cost calculator)
- `POST /api/v1/model/switch` accepts `{ provider, model }` and recreates the AI client

## Consequences

- **Not persisted**: The switch only affects the running process. Restarting reverts to the config file settings. This is intentional — persistent config changes should go through the config file.
- **In-flight requests**: Requests that started before the switch will complete with the old model. Only new requests use the new model.
- **API key requirement**: Switching to a different provider requires that the corresponding API key environment variable is already set (e.g., `OPENAI_API_KEY` for OpenAI). If the key is missing, the `AIClient` constructor will throw.
- **Audit trail**: Every switch is recorded in the audit chain for security review.
