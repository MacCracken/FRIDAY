# ADR 030: Unified Connections View with OAuth Support

## Status

Accepted

## Date

2026-02-14

## Context

The FRIDAY dashboard previously had separate tabs for managing messaging integrations (`/connections`) and MCP servers (`/mcp`). This created a fragmented user experience where users had to navigate between different sections to manage all their connections.

Additionally, there was no support for OAuth-based authentication connections, which is a common requirement for modern integrations.

## Decision

We will implement a unified Connections view that consolidates:

1. **Messaging integrations** (Telegram, Discord, Slack, GitHub, Webhooks, Google Chat)
2. **MCP Servers** (local and external)
3. **OAuth Providers** (Google, GitHub)

### Frontend Changes

- Created `ConnectionsPage.tsx` that merges functionality from `ConnectionManager.tsx` and `McpManager.tsx`
- Implemented tabbed interface with three tabs: Messaging, MCP Servers, OAuth
- Updated sidebar navigation to point to unified `/connections` with sub-routes for each tab
- Added OAuth-specific connection types in platform metadata

### Backend Changes

- Created `oauth-routes.ts` with OAuth 2.0 flow implementation:
  - `GET /api/v1/auth/oauth/{provider}` - Initiate OAuth flow
  - `GET /api/v1/auth/oauth/{provider}/callback` - Handle callback
  - `GET /api/v1/auth/oauth/config` - Get configured providers
  - `POST /api/v1/auth/oauth/disconnect` - Disconnect provider
- Created `OAuthService` class for provider management and token exchange

### Configuration

Added new environment variables:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`

## Consequences

### Positive

- Unified, streamlined user experience for managing all connection types
- Consistent UI patterns across all connection types
- OAuth support enables modern authentication flows
- Simplified navigation with single entry point

### Negative

- Larger component file (ConnectionsPage.tsx)
- Additional complexity in routing

### Neutral

- OAuth connections stored as integrations with `_oauth` suffix
- Existing ConnectionManager and McpManager can be deprecated but kept for backward compatibility during transition

## Alternatives Considered

1. **Keep separate tabs with cross-linking**: Did not provide unified experience
2. **Full page per connection type**: Too many routes, complex navigation
3. **Modal-based OAuth flow**: Less intuitive than dedicated tab

## Implementation Notes

- OAuth implementation uses Authorization Code flow with PKCE consideration for production
- State parameter used for CSRF protection with 10-minute expiry
- Tokens are exchanged server-side; dashboard receives connection confirmation via redirect
- Integration storage reused for OAuth connections (platform = `google_oauth`, `github_oauth`)
