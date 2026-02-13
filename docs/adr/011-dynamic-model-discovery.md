# ADR 011: Dynamic Model Discovery for All Providers

## Status

Accepted

**Date**: 2026-02-12
**Release**: v1.3.1

## Context

Previously only the Gemini provider dynamically fetched its model list from the API (`GeminiProvider.fetchAvailableModels()`). All other providers (Anthropic, OpenAI, Ollama, OpenCode) relied on static hardcoded model lists in `cost-calculator.ts`. This meant new models required code changes to appear in the dashboard's Model widget.

## Decision

Add `fetchAvailableModels()` static methods to each provider (matching Gemini's existing pattern), then wire them into `getAvailableModelsAsync()` so model lists stay current automatically.

### Design Choices

1. **Static methods using raw `fetch`** — These are class-level methods that only need an API key (no SDK instance). Using `fetch` directly keeps them lightweight and consistent with Gemini's approach.

2. **Provider-specific filtering**:
   - Anthropic: Filters to `claude-*` models (skips deprecated/internal models)
   - OpenAI: Filters to models owned by `openai` or `system` (skips fine-tuned/third-party)
   - Ollama: Returns all locally downloaded models (no filtering needed)
   - OpenCode: Returns all models (OpenAI-compatible format)

3. **Graceful degradation** — Every `fetchAvailableModels()` returns `[]` on any error (network failure, auth error, service down). The static model list from `PRICING` serves as fallback.

4. **Parallel fetching** — `getAvailableModelsAsync()` uses `Promise.allSettled` to query all configured providers simultaneously. A slow or failing provider doesn't block others.

5. **Shared 10-minute cache** — One cache entry covers all providers combined, avoiding per-provider cache complexity. `_clearDynamicCache()` resets everything for testing.

## Consequences

### Positive
- New models appear in the dashboard automatically without code changes
- No additional dependencies (uses global `fetch`)
- Existing static pricing table still provides cost data for known models
- Fallback pricing per provider handles unknown models gracefully

### Negative
- First request after cache expiry may be slower (multiple API calls)
- Models without entries in `PRICING` use fallback pricing (may be inaccurate)

## Files Changed

- `packages/core/src/ai/providers/anthropic.ts` — `fetchAvailableModels()`
- `packages/core/src/ai/providers/openai.ts` — `fetchAvailableModels()`
- `packages/core/src/ai/providers/ollama.ts` — `fetchAvailableModels()`
- `packages/core/src/ai/providers/opencode.ts` — `fetchAvailableModels()`
- `packages/core/src/ai/cost-calculator.ts` — multi-provider `getAvailableModelsAsync()`
