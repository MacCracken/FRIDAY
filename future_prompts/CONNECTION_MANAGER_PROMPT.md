# ConnectionManager Completion Prompt

> Complete P3-009: Add connect forms, start/stop/delete controls, and real-time status to the ConnectionManager dashboard component.

---

## Context

The integration framework is fully operational:
- `IntegrationManager` at `packages/core/src/integrations/manager.ts` handles lifecycle
- REST API at `packages/core/src/integrations/integration-routes.ts`:
  - `GET /api/v1/integrations/platforms` — list registered platforms
  - `GET /api/v1/integrations` — list configured integrations (with `total`, `running` counts)
  - `POST /api/v1/integrations` — create `{ platform, displayName, enabled, config }`
  - `PUT /api/v1/integrations/:id` — update
  - `DELETE /api/v1/integrations/:id` — delete (stops if running)
  - `POST /api/v1/integrations/:id/start` — start
  - `POST /api/v1/integrations/:id/stop` — stop
  - `GET /api/v1/integrations/:id/messages` — list messages (limit, offset)
  - `POST /api/v1/integrations/:id/messages` — send `{ chatId, text }`
- Dashboard API client at `packages/dashboard/src/api/client.ts` has `fetchIntegrations()` and `fetchAvailablePlatforms()`
- `ConnectionManager.tsx` currently shows platform cards with status + info banner, but no interactive controls
- Dashboard types at `packages/dashboard/src/types.ts` define `IntegrationInfo`, `IntegrationStatus`

---

## Part 1: Add API Client Functions

### 1.1 Update `packages/dashboard/src/api/client.ts`

Add these functions after the existing integration functions:

```typescript
export async function createIntegration(data: {
  platform: string;
  displayName: string;
  enabled: boolean;
  config: Record<string, unknown>;
}): Promise<IntegrationInfo> {
  return request('/integrations', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateIntegration(
  id: string,
  data: Partial<{ displayName: string; enabled: boolean; config: Record<string, unknown> }>
): Promise<IntegrationInfo> {
  return request(`/integrations/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteIntegration(id: string): Promise<void> {
  await request(`/integrations/${id}`, { method: 'DELETE' });
}

export async function startIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/start`, { method: 'POST' });
}

export async function stopIntegration(id: string): Promise<{ message: string }> {
  return request(`/integrations/${id}/stop`, { method: 'POST' });
}
```

---

## Part 2: Connection Form Component

### 2.1 Add connect form to `ConnectionManager.tsx`

When a user clicks "Connect" on an available platform card, show an inline form:

**State:**
```typescript
const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
const [formData, setFormData] = useState({ displayName: '', botToken: '' });
```

**Form fields per platform:**

| Platform | Fields |
|----------|--------|
| telegram | Bot Token (password), Display Name |
| discord | Bot Token (password), Display Name |
| slack | Bot Token (password), App Token (password), Display Name |
| webhook | Webhook URL, Secret (password), Display Name |

**Form component (inline, replaces the platform card when active):**
```tsx
{connectingPlatform === platformId && (
  <div className="card p-4 border-primary border-2">
    <h3 className="font-medium text-sm mb-3">Connect {meta.name}</h3>
    <form onSubmit={handleConnect} className="space-y-3">
      <input
        type="text"
        placeholder="Display Name"
        value={formData.displayName}
        onChange={(e) => setFormData(prev => ({ ...prev, displayName: e.target.value }))}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <input
        type="password"
        placeholder="Bot Token"
        value={formData.botToken}
        onChange={(e) => setFormData(prev => ({ ...prev, botToken: e.target.value }))}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button type="submit" disabled={!formData.displayName || !formData.botToken}
                className="btn btn-primary text-xs px-3 py-1.5">
          Connect
        </button>
        <button type="button" onClick={() => setConnectingPlatform(null)}
                className="btn btn-ghost text-xs px-3 py-1.5">
          Cancel
        </button>
      </div>
    </form>
  </div>
)}
```

**Submit handler:**
```typescript
const createMut = useMutation({
  mutationFn: async () => {
    const integration = await createIntegration({
      platform: connectingPlatform!,
      displayName: formData.displayName,
      enabled: true,
      config: { botToken: formData.botToken },
    });
    await startIntegration(integration.id);
    return integration;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['integrations'] });
    setConnectingPlatform(null);
    setFormData({ displayName: '', botToken: '' });
  },
});
```

### 2.2 Add "Connect" button to available platform cards

On platform cards where `isRegistered === true`, add a Connect button:
```tsx
{isRegistered && (
  <button
    onClick={() => setConnectingPlatform(platformId)}
    className="btn btn-primary text-xs px-3 py-1.5 mt-2"
  >
    Connect
  </button>
)}
```

---

## Part 3: Integration Card Controls

### 3.1 Update `IntegrationCard` component

Add start/stop/delete controls to the existing `IntegrationCard`:

```tsx
function IntegrationCard({ integration }: { integration: IntegrationInfo }) {
  const queryClient = useQueryClient();

  const startMut = useMutation({
    mutationFn: () => startIntegration(integration.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const stopMut = useMutation({
    mutationFn: () => stopIntegration(integration.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteIntegration(integration.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const isConnected = integration.status === 'connected';
  const isLoading = startMut.isPending || stopMut.isPending || deleteMut.isPending;

  // ... existing card layout ...

  // Add control buttons at bottom:
  <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
    {isConnected ? (
      <button onClick={() => stopMut.mutate()} disabled={isLoading}
              className="text-xs text-muted hover:text-destructive transition-colors">
        Stop
      </button>
    ) : (
      <button onClick={() => startMut.mutate()} disabled={isLoading}
              className="text-xs text-muted hover:text-primary transition-colors">
        Start
      </button>
    )}
    <button onClick={() => {
      if (confirm(`Delete ${integration.displayName}?`)) deleteMut.mutate();
    }} disabled={isLoading}
            className="text-xs text-muted hover:text-destructive transition-colors ml-auto">
      Delete
    </button>
  </div>
}
```

### 3.2 Add last activity timestamp

Show relative time for `lastMessageAt`:
```tsx
{integration.lastMessageAt && (
  <span className="text-xs text-muted">
    Last: {formatRelativeTime(integration.lastMessageAt)}
  </span>
)}
```

### 3.3 Error state display

When `integration.status === 'error'`, show a retry button:
```tsx
{integration.status === 'error' && (
  <button onClick={() => startMut.mutate()} className="text-xs text-primary">
    Retry
  </button>
)}
```

---

## Part 4: Imports and Dependencies

### 4.1 Update imports in ConnectionManager.tsx

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchIntegrations,
  fetchAvailablePlatforms,
  createIntegration,
  startIntegration,
  stopIntegration,
  deleteIntegration,
} from '../api/client';
```

---

## Files to Modify

| File | Action |
|------|--------|
| `packages/dashboard/src/api/client.ts` | Add 5 new API functions |
| `packages/dashboard/src/components/ConnectionManager.tsx` | Major update (form, controls) |
| `TODO.md` | Update P3-009 status |

---

## Acceptance Criteria

- [ ] "Connect" button appears on available (registered) platform cards
- [ ] Clicking "Connect" shows inline form with platform-specific fields
- [ ] Form submission creates integration AND starts it
- [ ] IntegrationCard shows Start/Stop buttons based on current status
- [ ] IntegrationCard shows Delete button with confirmation
- [ ] Error state shows Retry button
- [ ] All mutations invalidate the integrations query for live updates
- [ ] Loading states disable buttons during mutations
- [ ] Dashboard TypeScript compiles cleanly
- [ ] All existing 589 tests continue to pass
