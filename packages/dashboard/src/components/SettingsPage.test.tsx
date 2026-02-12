// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';
import { createApiKey, createSoulConfig } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchAgentName: vi.fn(),
  updateAgentName: vi.fn(),
  fetchApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  fetchSoulConfig: vi.fn(),
  fetchAuditStats: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchAgentName = vi.mocked(api.fetchAgentName);
const mockUpdateAgentName = vi.mocked(api.updateAgentName);
const mockFetchApiKeys = vi.mocked(api.fetchApiKeys);
const mockCreateApiKey = vi.mocked(api.createApiKey);
const mockFetchSoulConfig = vi.mocked(api.fetchSoulConfig);
const mockFetchAuditStats = vi.mocked(api.fetchAuditStats);

// ── Helpers ──────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderComponent() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchAgentName.mockResolvedValue({ agentName: 'Friday' });
    mockFetchApiKeys.mockResolvedValue({ keys: [] });
    mockFetchSoulConfig.mockResolvedValue(createSoulConfig());
    mockFetchAuditStats.mockResolvedValue({ totalEntries: 0, chainValid: true });
  });

  it('renders the Settings heading', async () => {
    renderComponent();
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('System configuration and API key management')).toBeInTheDocument();
  });

  it('displays the agent name', async () => {
    renderComponent();
    expect(await screen.findByText('Friday')).toBeInTheDocument();
  });

  it('shows Edit button for agent name', async () => {
    renderComponent();
    expect(await screen.findByLabelText('Edit agent name')).toBeInTheDocument();
  });

  it('switches to edit mode when Edit is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const editButton = await screen.findByLabelText('Edit agent name');
    await user.click(editButton);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows "No API keys created yet." when no keys exist', async () => {
    renderComponent();
    expect(await screen.findByText('No API keys created yet.')).toBeInTheDocument();
  });

  it('renders API key list when keys exist', async () => {
    mockFetchApiKeys.mockResolvedValue({
      keys: [
        createApiKey({ id: 'k1', name: 'CI Pipeline', role: 'operator', prefix: 'fri_abc' }),
        createApiKey({ id: 'k2', name: 'Monitor', role: 'viewer', prefix: 'fri_def' }),
      ],
    });
    renderComponent();

    expect(await screen.findByText('CI Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Monitor')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('viewer')).toBeInTheDocument();
  });

  it('shows Create Key button that opens the create form', async () => {
    const user = userEvent.setup();
    renderComponent();

    const createButton = await screen.findByText('Create Key');
    await user.click(createButton);

    expect(screen.getByPlaceholderText('e.g. CI Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Role')).toBeInTheDocument();
    expect(screen.getByText('Expires (days)')).toBeInTheDocument();
  });

  it('renders soul config section when config is loaded', async () => {
    renderComponent();

    expect(await screen.findByText('Soul System')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('observe, suggest')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('4,096')).toBeInTheDocument();
  });

  it('shows revoke button for each API key', async () => {
    mockFetchApiKeys.mockResolvedValue({
      keys: [createApiKey({ id: 'k1', name: 'Test Key' })],
    });
    renderComponent();

    expect(await screen.findByLabelText('Revoke API key Test Key')).toBeInTheDocument();
  });
});
