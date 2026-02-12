// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionManager } from './ConnectionManager';
import { createIntegrationList } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchIntegrations: vi.fn(),
  fetchAvailablePlatforms: vi.fn(),
  createIntegration: vi.fn(),
  startIntegration: vi.fn(),
  stopIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchIntegrations = vi.mocked(api.fetchIntegrations);
const mockFetchAvailablePlatforms = vi.mocked(api.fetchAvailablePlatforms);
const mockCreateIntegration = vi.mocked(api.createIntegration);
const mockStartIntegration = vi.mocked(api.startIntegration);

// ── Helpers ──────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderComponent() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ConnectionManager />
    </QueryClientProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('ConnectionManager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchIntegrations.mockResolvedValue({
      integrations: [],
      total: 0,
      running: 0,
    });
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: [] });
  });

  it('renders the header and description', async () => {
    renderComponent();
    expect(await screen.findByText('Connections')).toBeInTheDocument();
    expect(
      screen.getByText('Manage platform integrations and messaging channels')
    ).toBeInTheDocument();
  });

  it('shows running/configured counts when data is loaded', async () => {
    mockFetchIntegrations.mockResolvedValue({
      integrations: createIntegrationList(),
      total: 3,
      running: 1,
    });
    renderComponent();
    expect(await screen.findByText('1 running / 3 configured')).toBeInTheDocument();
  });

  it('displays info banner when no platform adapters are registered', async () => {
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: [] });
    renderComponent();
    expect(
      await screen.findByText('No platform adapters registered')
    ).toBeInTheDocument();
  });

  it('does not display info banner when platforms are registered', async () => {
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram', 'discord'] });
    renderComponent();
    // Wait for platform-dependent elements to appear (Available badges)
    await screen.findAllByText('Available');
    expect(screen.queryByText('No platform adapters registered')).not.toBeInTheDocument();
  });

  it('renders integration cards for configured integrations', async () => {
    const integrations = createIntegrationList();
    mockFetchIntegrations.mockResolvedValue({
      integrations,
      total: 3,
      running: 1,
    });
    renderComponent();

    expect(await screen.findByText('Friday Telegram')).toBeInTheDocument();
    expect(screen.getByText('Dev Discord')).toBeInTheDocument();
    expect(screen.getByText('Team Slack')).toBeInTheDocument();
  });

  it('displays status labels on integration cards', async () => {
    const integrations = createIntegrationList();
    mockFetchIntegrations.mockResolvedValue({
      integrations,
      total: 3,
      running: 1,
    });
    renderComponent();

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('shows message count on integration cards', async () => {
    mockFetchIntegrations.mockResolvedValue({
      integrations: createIntegrationList(),
      total: 3,
      running: 1,
    });
    renderComponent();
    expect(await screen.findByText('256 messages')).toBeInTheDocument();
    expect(screen.getByText('42 messages')).toBeInTheDocument();
  });

  it('shows error message on errored integration', async () => {
    mockFetchIntegrations.mockResolvedValue({
      integrations: createIntegrationList(),
      total: 3,
      running: 1,
    });
    renderComponent();
    expect(await screen.findByText('Invalid bot token')).toBeInTheDocument();
  });

  it('renders available platform cards with "Coming Soon" when not registered', async () => {
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: [] });
    renderComponent();
    const comingSoonBadges = await screen.findAllByText('Coming Soon');
    expect(comingSoonBadges.length).toBeGreaterThan(0);
  });

  it('shows Connect button for registered available platforms', async () => {
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram'] });
    renderComponent();
    const connectButtons = await screen.findAllByText('Connect');
    expect(connectButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('opens connect form when clicking Connect on an available platform', async () => {
    const user = userEvent.setup();
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram'] });
    renderComponent();

    const connectButton = await screen.findByRole('button', { name: 'Connect' });
    await user.click(connectButton);

    expect(screen.getByText('Connect Telegram')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Display Name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Bot Token')).toBeInTheDocument();
  });

  it('disables submit when display name is empty', async () => {
    const user = userEvent.setup();
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram'] });
    renderComponent();

    const connectButton = await screen.findByRole('button', { name: 'Connect' });
    await user.click(connectButton);

    const submitButton = screen.getByRole('button', { name: 'Connect' });
    expect(submitButton).toBeDisabled();
  });

  it('shows Cancel button in connect form that closes the form', async () => {
    const user = userEvent.setup();
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram'] });
    renderComponent();

    const connectButton = await screen.findByRole('button', { name: 'Connect' });
    await user.click(connectButton);

    expect(screen.getByText('Connect Telegram')).toBeInTheDocument();
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(screen.queryByText('Connect Telegram')).not.toBeInTheDocument();
  });
});
