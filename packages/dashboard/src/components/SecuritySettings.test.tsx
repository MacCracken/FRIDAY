// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecuritySettings } from './SecuritySettings';
import { createMetricsSnapshot } from '../test/mocks';

vi.mock('../api/client', () => ({
  fetchRoles: vi.fn(),
  fetchAuditStats: vi.fn(),
  fetchMetrics: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchRoles = vi.mocked(api.fetchRoles);
const mockFetchAuditStats = vi.mocked(api.fetchAuditStats);
const mockFetchMetrics = vi.mocked(api.fetchMetrics);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderComponent() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SecuritySettings />
    </QueryClientProvider>
  );
}

describe('SecuritySettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchRoles.mockResolvedValue({
      roles: [
        { name: 'admin', permissions: ['read', 'write', 'delete'] },
        { name: 'viewer', permissions: ['read'] },
      ],
    });
    mockFetchAuditStats.mockResolvedValue({
      totalEntries: 1250,
      chainValid: true,
      lastVerification: Date.now(),
    });
    mockFetchMetrics.mockResolvedValue(
      createMetricsSnapshot({
        security: {
          authAttemptsTotal: 0,
          authSuccessTotal: 0,
          authFailuresTotal: 0,
          activeSessions: 0,
          permissionChecksTotal: 0,
          permissionDenialsTotal: 0,
          blockedRequestsTotal: 0,
          rateLimitHitsTotal: 5,
          injectionAttemptsTotal: 0,
          eventsBySeverity: {},
          eventsByType: {},
          auditEntriesTotal: 1250,
          auditChainValid: true,
        },
      })
    );
  });

  it('renders the heading', async () => {
    renderComponent();
    expect(await screen.findByText('Security Settings')).toBeInTheDocument();
  });

  it('displays roles and permissions', async () => {
    renderComponent();
    expect(await screen.findByText('admin')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('displays audit chain status', async () => {
    renderComponent();
    expect(await screen.findByText('Valid')).toBeInTheDocument();
  });

  it('shows rate limiting section', async () => {
    renderComponent();
    expect(await screen.findByText('Rate Limiting')).toBeInTheDocument();
  });
});
