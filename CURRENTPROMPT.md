│ Dashboard Routing, Login & Live Data + Documentation                    │
│                                                                         │
│ Context                                                                 │
│                                                                         │
│ The dashboard is a working single-page React app with tab-based         │
│ navigation, but it has three gaps:                                      │
│ 1. No routing — uses useState<Tab> instead of URL routes, so            │
│ deep-linking and browser back/forward don't work                        │
│ 2. No login page — auth is network-level only; the backend has full JWT │
│  auth (login with password → accessToken + refreshToken) but the        │
│ dashboard never sends credentials                                       │
│ 3. Mock/fallback data — API calls silently swallow 401s and return      │
│ empty objects, so components appear to work but show zeros              │
│                                                                         │
│ We're tackling all three in order: routing + login → wire live data →   │
│ documentation.                                                          │
│                                                                         │
│ ---                                                                     │
│ Part 1: Dashboard Routing + Login                                       │
│                                                                         │
│ 1a. Add React Router (lightweight, no TanStack Router)                  │
│                                                                         │
│ The TODO mentions TanStack Router but the project doesn't use it yet    │
│ and it adds complexity. Use react-router-dom v7 instead — it's already  │
│ a well-understood pattern and the dashboard is small.                   │
│                                                                         │
│ Files:                                                                  │
│ - packages/dashboard/package.json — add react-router-dom dependency     │
│ - packages/dashboard/src/main.tsx — wrap App in <BrowserRouter>         │
│ - packages/dashboard/src/App.tsx — replace tab state with <Routes> +    │
│ <Route> + <NavLink>                                                     │
│                                                                         │
│ Routes:                                                                 │
│ ┌──────────────┬───────────────────┬─────────────────────────────────── │
│ ┐                                                                       │
│ │     Path     │     Component     │            Description             │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /login       │ LoginPage         │ Password form                      │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /            │ OverviewPage      │ Current overview tab content       │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /tasks       │ TaskHistory       │ Task history (existing component)  │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /security    │ SecurityEvents    │ Security events (existing)         │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /personality │ PersonalityEditor │ Personality editor (existing)      │
│ │                                                                       │
│ ├──────────────┼───────────────────┼─────────────────────────────────── │
│ ┤                                                                       │
│ │ /skills      │ SkillsManager     │ Skills manager (existing)          │
│ │                                                                       │
│ └──────────────┴───────────────────┴─────────────────────────────────── │
│ ┘                                                                       │
│ Navigation: Replace the tab <button> elements with <NavLink>            │
│ components. The existing CSS class logic (border-primary when active)   │
│ maps directly to NavLink's className callback which receives { isActive │
│  }.                                                                     │
│                                                                         │
│ 1b. Auth Context + Login Page                                           │
│                                                                         │
│ New files:                                                              │
│ - packages/dashboard/src/hooks/useAuth.ts — Auth context provider       │
│ - packages/dashboard/src/pages/LoginPage.tsx — Login form               │
│                                                                         │
│ Auth flow:                                                              │
│ 1. AuthProvider wraps the app, stores accessToken + refreshToken in     │
│ state (and localStorage for persistence across refreshes)               │
│ 2. On mount, check localStorage for existing token. If found, use it;   │
│ if API returns 401, clear and redirect to /login                        │
│ 3. LoginPage — single password field (backend uses admin password, no   │
│ username), calls POST /api/v1/auth/login with { password }, receives {  │
│ accessToken, refreshToken, expiresIn, tokenType: 'Bearer' }             │
│ 4. Store tokens, redirect to /                                          │
│ 5. useAuth() hook exposes { token, login, logout, isAuthenticated }     │
│                                                                         │
│ API client changes (api/client.ts):                                     │
│ - The request() function needs to include Authorization: Bearer <token> │
│  header                                                                 │
│ - Add a setAuthToken(token) function that the auth context calls        │
│ - On 401 response, attempt token refresh via POST /api/v1/auth/refresh  │
│ with { refreshToken }; if refresh fails, clear auth and redirect to     │
│ /login                                                                  │
│ - Keep fetchHealth() unauthenticated (it's a public route)              │
│                                                                         │
│ Route protection:                                                       │
│ - App.tsx checks isAuthenticated — if not, redirect all routes to       │
│ /login                                                                  │
│ - Simple: wrap <Routes> in a guard, no complex per-route auth needed    │
│ (all dashboard routes need same auth level)                             │
│                                                                         │
│ 1c. Logout                                                              │
│                                                                         │
│ - Add logout button to header (replace or augment the refresh button    │
│ area)                                                                   │
│ - Calls POST /api/v1/auth/logout with Bearer token, then clears local   │
│ state + localStorage, redirects to /login                               │
│                                                                         │
│ Files to create                                                         │
│                                                                         │
│ - packages/dashboard/src/hooks/useAuth.tsx — AuthProvider + useAuth     │
│ hook                                                                    │
│ - packages/dashboard/src/pages/LoginPage.tsx — Login page component     │
│                                                                         │
│ Files to modify                                                         │
│                                                                         │
│ - packages/dashboard/package.json — add react-router-dom                │
│ - packages/dashboard/src/main.tsx — BrowserRouter + AuthProvider        │
│ wrapping                                                                │
│ - packages/dashboard/src/App.tsx — Routes/NavLink instead of tabs, auth │
│  guard, logout button                                                   │
│ - packages/dashboard/src/api/client.ts — Bearer token injection, token  │
│ refresh, auth redirect                                                  │
│                                                                         │
│ ---                                                                     │
│ Part 2: Wire Dashboard to Live Data                                     │
│                                                                         │
│ Once auth works, the API client will send proper Bearer tokens and get  │
│ real responses instead of 401s falling through to empty defaults.       │
│                                                                         │
│ Changes needed                                                          │
│                                                                         │
│ api/client.ts — The existing catch blocks that return empty data ({     │
│ tasks: [], total: 0 }, empty metrics, etc.) should still serve as       │
│ fallbacks for network errors, but now that auth is working, the happy   │
│ path will return real data. No structural changes needed beyond Part    │
│ 1's auth token injection.                                               │
│                                                                         │
│ Components already wired correctly:                                     │
│ - TaskHistory.tsx — calls fetchTasks() via useQuery, renders real task  │
│ data ✅                                                                 │
│ - SecurityEvents.tsx — calls fetchSecurityEvents() via useQuery ✅      │
│ - PersonalityEditor.tsx — calls soul API endpoints ✅                   │
│ - SkillsManager.tsx — calls soul API endpoints ✅                       │
│ - ResourceMonitor.tsx — receives metrics prop from App ✅               │
│ - MetricsGraph.tsx — receives metrics prop from App ✅                  │
│                                                                         │
│ Key insight: The components are already coded to consume live API data. │
│  The reason they show empty/mock data today is that all API calls fail  │
│ with 401 (no auth token) and the catch blocks return fallback objects.  │
│ Once Part 1 adds auth tokens, data flows automatically.                 │
│                                                                         │
│ WebSocket auth (optional enhancement):                                  │
│ - Currently the WebSocket at /ws/metrics doesn't require auth tokens    │
│ - The gateway's WebSocket upgrade handler doesn't check auth            │
│ - This can remain as-is for now (local-network-only restriction still   │
│ applies)                                                                │
│                                                                         │
│ Verification                                                            │
│                                                                         │
│ - Log in → overview page shows real metrics (non-zero task count,       │
│ memory usage, audit entries)                                            │
│ - Tasks tab shows actual persisted tasks from TaskStorage               │
│ - Security tab shows real audit chain events                            │
│ - Personality/Skills tabs show the onboarded personality and any        │
│ created skills                                                          │
│                                                                         │
│ ---                                                                     │
│ Part 3: Documentation (P5-006)                                          │
│                                                                         │
│ Files to create                                                         │
│                                                                         │
│ - docs/configuration.md — Config reference (all YAML fields, env vars,  │
│ CLI flags)                                                              │
│ - docs/api.md — API reference (all REST endpoints with request/response │
│  examples)                                                              │
│ - docs/installation.md — Installation guide (from source, Docker, npm)  │
│                                                                         │
│ Content outline                                                         │
│                                                                         │
│ docs/installation.md:                                                   │
│ - Prerequisites (Node 20+, npm)                                         │
│ - From source: clone → npm install → set env vars → run CLI             │
│ - Docker: docker compose up (reference existing README Docker section)  │
│ - Environment variables reference table                                 │
│                                                                         │
│ docs/configuration.md:                                                  │
│ - YAML config file location and format                                  │
│ - All config sections: gateway, security, ai, sandbox, soul, logging    │
│ - Environment variable overrides                                        │
│ - CLI flags (--port, --host, --config, --log-level, --help, --version)  │
│                                                                         │
│ docs/api.md:                                                            │
│ - Authentication: login flow, Bearer token usage, API keys              │
│ - All REST endpoints grouped by domain (auth, metrics, tasks, audit,    │
│ security, soul)                                                         │
│ - Request/response examples for key endpoints                           │
│ - WebSocket protocol (connect, subscribe, message format)               │
│ - Error format: { error: string }                                       │
│                                                                         │
│ Files to modify                                                         │
│                                                                         │
│ - README.md — Add links to new docs in Documentation section            │
│ - TODO.md — Mark P5-006 as partially complete                           │
│                                                                         │
│ ---                                                                     │
│ Implementation Order                                                    │
│                                                                         │
│ 1. npm install react-router-dom in dashboard package                    │
│ 2. Create useAuth.tsx (AuthProvider, context, token management)         │
│ 3. Create LoginPage.tsx                                                 │
│ 4. Update api/client.ts (auth token injection + refresh)                │
│ 5. Update main.tsx (BrowserRouter + AuthProvider)                       │
│ 6. Update App.tsx (Routes + NavLink + auth guard + logout)              │
│ 7. Verify live data flows through existing components                   │
│ 8. Create docs/installation.md                                          │
│ 9. Create docs/configuration.md                                         │
│ 10. Create docs/api.md                                                  │
│ 11. Update README.md and TODO.md                                        │
│                                                                         │
│ Key files to reference                                                  │
│                                                                         │
│ - packages/core/src/gateway/auth-routes.ts — Login endpoint: POST       │
│ /api/v1/auth/login expects { password: string }, returns { accessToken, │
│  refreshToken, expiresIn, tokenType }                                   │
│ - packages/core/src/gateway/auth-middleware.ts — Public routes:         │
│ /health, /api/v1/auth/login. Token-only: /api/v1/auth/refresh,          │
│ /api/v1/auth/logout. All other routes need Bearer or API key.           │
│ - packages/core/src/security/auth.ts — LoginResult { accessToken,       │
│ refreshToken, expiresIn, tokenType: 'Bearer' }, AuthUser { userId,      │
│ role, permissions, authMethod }                                         │
│ - packages/dashboard/src/api/client.ts — Current API client, needs auth │
│  header injection                                                       │
│ - packages/dashboard/src/App.tsx — Current tab-based SPA, needs routing │
│  conversion                                                             │
│                                                                         │
│ Verification                                                            │
│                                                                         │
│ 1. Start backend: npx tsx packages/core/src/cli.ts                      │
│ 2. Start dashboard: npm run dev:dashboard                               │
│ 3. Navigate to http://localhost:3000 → should redirect to /login        │
│ 4. Enter admin password → should redirect to / with real metrics        │
│ 5. Click Tasks/Security/Personality/Skills tabs → URL changes, data     │
│ loads                                                                   │
│ 6. Browser back/forward works                                           │
│ 7. Refresh page → stays logged in (localStorage token)                  │
│ 8. Click logout → redirects to /login, API calls stop working           │
│ 9. All 565 existing tests still pass (npm run test -- --run)
