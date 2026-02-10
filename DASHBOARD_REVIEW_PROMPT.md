# Dashboard Code Review, Refactor & Gap Completion Prompt

> Review the dashboard for performance issues and code quality, refactor for maintainability, and implement remaining dashboard gaps (theme toggle, advanced filtering, responsive layout).

---

## Context

The dashboard (`packages/dashboard/`) consists of:
- **8 components**: MetricsGraph, TaskHistory, SecurityEvents, ResourceMonitor, OnboardingWizard, PersonalityEditor, SkillsManager, ConnectionManager, SettingsPage
- **2 hooks**: useWebSocket, useAuth
- **1 API client**: api/client.ts (37 API functions, token management)
- **App.tsx**: ~320 lines with routing, header, navigation, health polling, WebSocket, local network check
- **main.tsx**: QueryClient with staleTime 5s, refetchInterval 10s, retry 3
- **Styling**: Tailwind + CSS variables (dark theme defined but not toggleable), custom card/btn/badge classes
- **Dependencies**: React 18.3, react-router-dom 7, @tanstack/react-query 5, reactflow 11, recharts 2, lucide-react

---

## Part 1: Code Review — Issues to Fix

### 1.1 Performance Issues

**App.tsx is too large (~320 lines) and re-renders everything:**
- Health check polling (5s), WebSocket state, onboarding query, and agent name query all live in the root component
- Any state change (health, WS message, etc.) re-renders the entire nav + route tree
- **Fix**: Extract `DashboardHeader`, `DashboardNav`, and `StatusIndicator` into separate components. Memoize with `React.memo()` where appropriate.

**MetricsGraph rebuilds nodes on every metrics change:**
- `useMemo` is used for nodes/edges but depends on `metricsData` which changes every 10s
- ReactFlow re-renders all nodes even if only one value changed
- **Fix**: Use `useCallback` for node data updates. Consider `ReactFlowProvider` with `useNodesState`/`useEdgesState` for incremental updates instead of rebuilding the array.

**ResourceMonitor generates mock history on every render:**
- The memory history chart uses inline-generated mock data
- `useMemo` dependency includes `metricsData` so it regenerates each time
- **Fix**: Accumulate real history in a `useRef` array, appending new data points from each metrics update. Cap at 30 data points.

**Global refetchInterval 10s on ALL queries:**
- `main.tsx` sets `refetchInterval: 10000` globally — this means soul config, personalities, skills, API keys, onboarding status all poll every 10s even when not visible
- **Fix**: Remove global `refetchInterval`. Set it only on queries that need polling:
  - `fetchMetrics`: 5000ms (real-time)
  - `fetchIntegrations`: 10000ms
  - `fetchTasks`: 5000ms
  - `fetchSecurityEvents`: 10000ms
  - `fetchHealth`: 5000ms
  - Everything else: no auto-refetch (use `staleTime: 30000`)

### 1.2 Structural Issues

**No error boundaries:**
- A crash in MetricsGraph (ReactFlow) or any component takes down the entire dashboard
- **Fix**: Create `ErrorBoundary` component wrapping each route content area

**Repeated mutation patterns:**
- PersonalityEditor, SkillsManager, and SettingsPage all have nearly identical CRUD mutation patterns
- **Fix**: Create a `useCrudMutation` hook:
  ```typescript
  function useCrudMutation<T>(queryKey: string[], mutationFn: () => Promise<T>) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    });
  }
  ```

**Inline form state management repeated:**
- Each editor component (Personality, Skills, Settings) manages its own `editing`/`form`/`setForm` state identically
- **Fix**: Create `useEditForm<T>` hook that encapsulates the editing pattern

**No loading skeletons:**
- Components show nothing or stale data while loading
- **Fix**: Add a simple `Skeleton` component (pulsing gray box) for cards during initial load

### 1.3 Accessibility Issues

- Missing ARIA labels on icon-only buttons (logout, refresh, start, stop, delete)
- Missing `aria-live` regions for real-time updates
- Tab navigation doesn't work well on the NavLink bar
- **Fix**: Add `aria-label` to all icon buttons, `role="status"` on live indicators

---

## Part 2: Refactor

### 2.1 Extract components from App.tsx

Split `App.tsx` into:

**`components/DashboardLayout.tsx`:**
```tsx
export function DashboardLayout() {
  // Contains: header, nav, Outlet (react-router)
  // Owns: health query, WS connection, agent name
}
```

**`components/StatusBar.tsx`:**
```tsx
export function StatusBar({ health, wsConnected }: StatusBarProps) {
  // Connection indicators, refresh button, logout
}
```

**`components/NavigationTabs.tsx`:**
```tsx
export const NavigationTabs = React.memo(function NavigationTabs() {
  // 7 NavLink tabs, memoized to prevent re-render on parent state changes
});
```

**Simplified `App.tsx`:**
```tsx
export default function App() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        isAuthenticated ? <DashboardLayout /> : <Navigate to="/login" />
      } />
    </Routes>
  );
}
```

### 2.2 Create shared components

**`components/common/ErrorBoundary.tsx`:**
- Catches render errors, shows fallback UI with retry button
- Logs errors to console (optionally to audit API)

**`components/common/Skeleton.tsx`:**
- Simple pulsing placeholder: `<div className="animate-pulse bg-muted rounded h-4 w-full" />`
- Variants: `SkeletonCard`, `SkeletonTable`, `SkeletonText`

**`components/common/ConfirmDialog.tsx`:**
- Replace `window.confirm()` with a modal dialog
- Accept title, message, onConfirm, onCancel

### 2.3 Optimize React Query configuration

In `main.tsx`:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s default stale time
      retry: 2,
      refetchOnWindowFocus: false,  // Prevent refetch storm on alt-tab
    },
  },
});
```

Then set per-query intervals where needed:
```typescript
// In components that need polling:
useQuery({ queryKey: ['metrics'], queryFn: fetchMetrics, refetchInterval: 5000 });
useQuery({ queryKey: ['tasks'], queryFn: fetchTasks, refetchInterval: 5000 });
// In components that don't need polling:
useQuery({ queryKey: ['personalities'], queryFn: fetchPersonalities }); // Just uses staleTime
```

---

## Part 3: Dashboard Gaps

### 3.1 Theme Toggle (dark/light mode)

The CSS already defines `.dark` class with full variable set.

**Create `hooks/useTheme.ts`:**
```typescript
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return localStorage.getItem('theme') as 'light' | 'dark' || 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme(t => t === 'dark' ? 'light' : 'dark'), []);

  return { theme, toggle };
}
```

**Add toggle button to StatusBar:**
```tsx
<button onClick={toggle} aria-label="Toggle theme" className="btn-ghost p-1.5">
  {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
</button>
```

**Update `<body>` default**: Add `class="dark"` to `index.html` or apply in `main.tsx`.

### 3.2 Advanced Task Filtering

Update `TaskHistory.tsx`:

**Add filters:**
- Date range picker (two `<input type="date">` fields for `from` and `to`)
- Task type filter dropdown (`execute`, `query`, `file`, `network`, `system`)
- Text search (debounced, filters by task name/description)

**Wire to API:**
```typescript
const { data } = useQuery({
  queryKey: ['tasks', statusFilter, typeFilter, dateRange, page],
  queryFn: () => fetchTasks({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    type: typeFilter !== 'all' ? typeFilter : undefined,
    limit: 10,
    offset: (page - 1) * 10,
  }),
  refetchInterval: 5000,
});
```

### 3.3 Responsive Mobile Layout

**Breakpoint strategy:**
- `< 768px` (mobile): Single column, collapsible nav, stacked cards
- `768px–1024px` (tablet): 2-column grid
- `> 1024px` (desktop): Current 3-column grid layout

**Navigation:**
- On mobile, replace tab bar with a hamburger menu
- Use `useState` for menu open/close
- Close menu on route change

**Cards:**
- Change grid from `grid-cols-3` to `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`
- Stack metric cards vertically on mobile
- Make ReactFlow graph full-width with reduced height on mobile

**Tables:**
- Make TaskHistory table horizontally scrollable on mobile: `<div className="overflow-x-auto">`
- Alternatively, switch to card layout on mobile

### 3.4 Session Timeout Warning

**Create `hooks/useSessionTimeout.ts`:**
```typescript
export function useSessionTimeout(expiresIn: number = 3600) {
  const [showWarning, setShowWarning] = useState(false);
  const { logout } = useAuth();

  useEffect(() => {
    // Warn 5 minutes before expiry
    const warnTimer = setTimeout(() => setShowWarning(true), (expiresIn - 300) * 1000);
    const logoutTimer = setTimeout(() => logout(), expiresIn * 1000);

    return () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
    };
  }, [expiresIn, logout]);

  return { showWarning, dismiss: () => setShowWarning(false) };
}
```

Show a banner when `showWarning === true`:
```tsx
{showWarning && (
  <div className="bg-warning/10 border-b border-warning text-warning text-sm px-4 py-2 flex justify-between">
    <span>Your session expires soon. Save your work.</span>
    <button onClick={dismiss} className="text-xs underline">Dismiss</button>
  </div>
)}
```

---

## Part 4: Testing

### 4.1 Verify all changes

After refactoring:
1. `cd packages/dashboard && npx tsc --noEmit` — TypeScript compiles cleanly
2. `pnpm test` — all 589 existing tests pass
3. Manual verification: all 7 routes render correctly
4. Theme toggle works (persists across refresh)
5. Mobile layout renders correctly (test with browser dev tools responsive mode)

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/dashboard/src/App.tsx` | Major refactor (slim down) |
| `packages/dashboard/src/components/DashboardLayout.tsx` | Create |
| `packages/dashboard/src/components/StatusBar.tsx` | Create |
| `packages/dashboard/src/components/NavigationTabs.tsx` | Create |
| `packages/dashboard/src/components/common/ErrorBoundary.tsx` | Create |
| `packages/dashboard/src/components/common/Skeleton.tsx` | Create |
| `packages/dashboard/src/components/common/ConfirmDialog.tsx` | Create |
| `packages/dashboard/src/hooks/useTheme.ts` | Create |
| `packages/dashboard/src/hooks/useSessionTimeout.ts` | Create |
| `packages/dashboard/src/main.tsx` | Modify (query config) |
| `packages/dashboard/src/components/MetricsGraph.tsx` | Optimize |
| `packages/dashboard/src/components/ResourceMonitor.tsx` | Optimize |
| `packages/dashboard/src/components/TaskHistory.tsx` | Add filters |
| `packages/dashboard/src/components/ConnectionManager.tsx` | Verify after refactor |
| `packages/dashboard/src/index.html` | Add dark class |
| `TODO.md` | Update P3-009, P3-011, P3-012 |

---

## Acceptance Criteria

- [ ] App.tsx is < 50 lines (routing only)
- [ ] DashboardLayout owns header, nav, and route outlet
- [ ] NavigationTabs is memoized and doesn't re-render on data changes
- [ ] ErrorBoundary wraps each route content area
- [ ] Global refetchInterval removed; per-query intervals set appropriately
- [ ] Theme toggle works (dark/light, persisted to localStorage)
- [ ] Advanced task filtering (status + type + date range)
- [ ] Mobile responsive layout (hamburger nav, stacked cards)
- [ ] Session timeout warning shown 5 minutes before expiry
- [ ] All icon buttons have aria-label
- [ ] Dashboard TypeScript compiles cleanly
- [ ] All existing 589 tests continue to pass
