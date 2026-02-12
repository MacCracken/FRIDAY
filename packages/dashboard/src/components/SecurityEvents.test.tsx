// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecurityEvents } from './SecurityEvents';
import { createMetricsSnapshot, createSecurityEventList } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchSecurityEvents: vi.fn(),
  verifyAuditChain: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchSecurityEvents = vi.mocked(api.fetchSecurityEvents);
const mockVerifyAuditChain = vi.mocked(api.verifyAuditChain);

// ── Helpers ──────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderComponent(metrics = createMetricsSnapshot()) {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SecurityEvents metrics={metrics} />
    </QueryClientProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('SecurityEvents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchSecurityEvents.mockResolvedValue({ events: [], total: 0 });
    mockVerifyAuditChain.mockResolvedValue({ valid: true, entriesChecked: 100 });
  });

  it('renders audit chain status as Valid when auditChainValid is true', async () => {
    renderComponent();
    expect(await screen.findByText('Valid')).toBeInTheDocument();
  });

  it('renders audit chain status as Invalid when auditChainValid is false', async () => {
    const metrics = createMetricsSnapshot({
      security: {
        ...createMetricsSnapshot().security,
        auditChainValid: false,
      },
    });
    renderComponent(metrics);
    expect(await screen.findByText('Invalid')).toBeInTheDocument();
    expect(screen.getByText('Requires attention')).toBeInTheDocument();
  });

  it('shows audit entries total count', async () => {
    renderComponent();
    expect(await screen.findByText('1250 entries')).toBeInTheDocument();
  });

  it('renders authentication stats from metrics', async () => {
    renderComponent();
    expect(await screen.findByText('Authentication')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();  // authAttemptsTotal
    expect(screen.getByText('42')).toBeInTheDocument();  // authSuccessTotal
    // authFailuresTotal = 3 and activeSessions = 2 may appear multiple times in the DOM
    // so we use getAllByText to verify presence
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);   // authFailuresTotal
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);   // activeSessions
  });

  it('renders threat summary stats from metrics', async () => {
    renderComponent();
    expect(await screen.findByText('Threat Summary')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();   // rateLimitHitsTotal
    expect(screen.getByText('1')).toBeInTheDocument();   // injectionAttemptsTotal
    expect(screen.getByText('5')).toBeInTheDocument();   // permissionDenialsTotal
  });

  it('shows "No security events recorded" when events list is empty', async () => {
    renderComponent();
    expect(await screen.findByText('No security events recorded')).toBeInTheDocument();
  });

  it('renders event rows when events are present', async () => {
    const events = createSecurityEventList();
    mockFetchSecurityEvents.mockResolvedValue({ events, total: events.length });
    renderComponent();

    expect(await screen.findByText('Successful login')).toBeInTheDocument();
    expect(screen.getByText('Failed login attempt')).toBeInTheDocument();
    expect(screen.getByText('Rate limit exceeded for API endpoint')).toBeInTheDocument();
    expect(screen.getByText('SQL injection attempt detected in query parameter')).toBeInTheDocument();
  });

  it('displays event type formatted with spaces instead of underscores', async () => {
    const events = createSecurityEventList();
    mockFetchSecurityEvents.mockResolvedValue({ events, total: events.length });
    renderComponent();

    expect(await screen.findByText('auth success')).toBeInTheDocument();
    expect(screen.getByText('auth failure')).toBeInTheDocument();
    expect(screen.getByText('rate limit exceeded')).toBeInTheDocument();
    expect(screen.getByText('injection attempt')).toBeInTheDocument();
  });

  it('shows user IDs on events that have them', async () => {
    const events = createSecurityEventList();
    mockFetchSecurityEvents.mockResolvedValue({ events, total: events.length });
    renderComponent();

    expect(await screen.findByText('User: admin')).toBeInTheDocument();
    expect(screen.getByText('User: unknown')).toBeInTheDocument();
  });

  it('shows IP addresses on events that have them', async () => {
    const events = createSecurityEventList();
    mockFetchSecurityEvents.mockResolvedValue({ events, total: events.length });
    renderComponent();

    expect(await screen.findByText('IP: 10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('IP: 192.168.1.100')).toBeInTheDocument();
    expect(screen.getByText('IP: 203.0.113.5')).toBeInTheDocument();
  });

  it('renders verify audit chain button', async () => {
    renderComponent();
    expect(await screen.findByLabelText('Verify audit chain')).toBeInTheDocument();
  });

  it('renders with undefined metrics gracefully', async () => {
    const qc = createQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <SecurityEvents metrics={undefined} />
      </QueryClientProvider>
    );
    // Should show 0 for all stats
    expect(await screen.findByText('Authentication')).toBeInTheDocument();
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(4);
  });
});
