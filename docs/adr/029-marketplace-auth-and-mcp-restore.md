# ADR 029: Marketplace Auth Fix & MCP Tool Restore Robustness

## Status

Accepted

## Context

Two reliability issues were identified in v1.4.1:

1. **Marketplace dashboard showed empty** — The `MarketplacePage` component used raw `fetch()` with `localStorage.getItem('friday_token')` for authentication, but the application stores auth tokens under `localStorage.getItem('accessToken')`. This caused every marketplace API call to send `Bearer null`, receive a 401, and silently render "Marketplace is empty."

2. **MCP tool toggle unreliable** — When an MCP server was disabled and re-enabled, `discoverTools()` read the server record from SQLite and checked `server.enabled` before restoring tools. While the route updated the DB before calling `discoverTools()`, the coupling between the DB write and the enabled-guard check created a fragile dependency. Any future code path that called `discoverTools()` before the DB update would silently fail.

## Decision

### Marketplace: Use shared API client

- Removed the inline `API_HEADERS()` helper and raw `fetch()` calls from `MarketplacePage.tsx`.
- Added `fetchMarketplaceSkills()`, `installMarketplaceSkill()`, and `uninstallMarketplaceSkill()` to the shared `api/client.ts` module, using the existing `request()` function which handles auth tokens correctly (including automatic refresh on 401).
- Also fixed the `downloads` → `downloadCount` field name mismatch between the component interface and the API response.

### MCP: Dedicated `restoreTools()` method

- Added `McpClientManager.restoreTools(serverId)` that loads tools from SQLite **without** checking `server.enabled`. The caller (the toggle route) is responsible for ensuring the server should be enabled.
- The PATCH toggle route now calls `restoreTools()` on re-enable instead of `discoverTools()`, eliminating the enabled-guard dependency.
- `discoverTools()` retains its enabled check for use in `refreshAll()` and other discovery contexts.
- The PATCH response now includes the restored tools for immediate dashboard consumption.

### Marketplace types

- `MarketplaceSkillSchema.tools` changed from `z.array(z.record(z.string(), z.unknown()))` to `z.array(ToolSchema)` to match the `SkillCreate.tools` type.
- `MarketplaceManager.install()` now wraps the skill data in `SkillCreateSchema.parse()` to apply Zod defaults for required fields (`status`, `actions`, `triggerPatterns`, etc.).

## Consequences

- Marketplace page now works correctly with authentication — skills are visible on first load.
- MCP tool restoration is decoupled from the `server.enabled` database state, making it more robust.
- All marketplace API calls benefit from the shared client's token refresh, error handling, and base URL resolution.
- New test covers the full toggle cycle (disable in DB + clear, then re-enable + restore).
