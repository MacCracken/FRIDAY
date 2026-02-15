// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectionsPage } from './ConnectionsPage';
import { createIntegrationList } from '../test/mocks';

vi.mock('../api/client', () => ({
  fetchMcpServers: vi.fn(),
  addMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  patchMcpServer: vi.fn(),
  fetchMcpTools: vi.fn(),
  fetchMcpConfig: vi.fn(),
  updateMcpConfig: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchAvailablePlatforms: vi.fn(),
  createIntegration: vi.fn(),
  startIntegration: vi.fn(),
  stopIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  testIntegration: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchMcpServers = vi.mocked(api.fetchMcpServers);
const mockFetchMcpTools = vi.mocked(api.fetchMcpTools);
const mockFetchMcpConfig = vi.mocked(api.fetchMcpConfig);
const mockFetchIntegrations = vi.mocked(api.fetchIntegrations);
const mockFetchAvailablePlatforms = vi.mocked(api.fetchAvailablePlatforms);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderComponent(initialEntries = ['/connections']) {
  const qc = createQueryClient();
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={qc}>
        <ConnectionsPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ConnectionsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchMcpServers.mockResolvedValue({ servers: [], total: 0 });
    mockFetchMcpTools.mockResolvedValue({ tools: [], total: 0 });
    mockFetchMcpConfig.mockResolvedValue({
      exposeGit: false,
      exposeFilesystem: false,
    });
    mockFetchIntegrations.mockResolvedValue({ integrations: [], total: 0, running: 0 });
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: [] });
  });

  it('renders the Connections header', async () => {
    renderComponent();
    expect(await screen.findByText('Connections')).toBeInTheDocument();
  });

  it('renders all three tabs', async () => {
    renderComponent();
    expect(await screen.findByText('Messaging')).toBeInTheDocument();
    expect(screen.getByText('MCP Servers')).toBeInTheDocument();
    expect(screen.getByText('OAuth')).toBeInTheDocument();
  });

  it('shows Messaging tab content by default', async () => {
    renderComponent();
    expect(
      await screen.findByText('Manage integrations, MCP servers, and authentication')
    ).toBeInTheDocument();
  });

  it('switches to MCP tab when clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const mcpTab = await screen.findByText('MCP Servers');
    await user.click(mcpTab);

    expect(screen.getByText('Add Server')).toBeInTheDocument();
  });

  it('switches to OAuth tab when clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const oauthTab = await screen.findByText('OAuth');
    await user.click(oauthTab);

    expect(screen.getByText(/Connect your account with OAuth providers/)).toBeInTheDocument();
  });

  it('displays OAuth providers when OAuth tab is active', async () => {
    const user = userEvent.setup();
    renderComponent();

    const oauthTab = await screen.findByText('OAuth');
    await user.click(oauthTab);

    expect(screen.getByText('Google')).toBeInTheDocument();
    expect(screen.getByText('GitHub')).toBeInTheDocument();
  });

  it('shows info banner when no platforms registered', async () => {
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: [] });
    renderComponent();
    expect(await screen.findByText('No platform adapters registered')).toBeInTheDocument();
  });

  it('shows messaging integrations when available', async () => {
    mockFetchIntegrations.mockResolvedValue({
      integrations: createIntegrationList(),
      total: 3,
      running: 1,
    });
    mockFetchAvailablePlatforms.mockResolvedValue({ platforms: ['telegram', 'discord'] });

    renderComponent();
    expect(await screen.findByText('Friday Telegram')).toBeInTheDocument();
    expect(screen.getByText('Dev Discord')).toBeInTheDocument();
  });

  it('shows MCP servers when available', async () => {
    const user = userEvent.setup();
    mockFetchMcpServers.mockResolvedValue({
      servers: [
        {
          id: '1',
          name: 'Test MCP',
          transport: 'stdio',
          enabled: true,
          command: 'npx',
          args: [],
          description: 'Test server',
          url: null,
          env: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      total: 1,
    });
    mockFetchMcpTools.mockResolvedValue({ tools: [], total: 0 });

    renderComponent();

    const mcpTab = await screen.findByText('MCP Servers');
    await user.click(mcpTab);

    expect(screen.getByText('Test MCP')).toBeInTheDocument();
  });

  it('shows Add Server form when Add Server button clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const mcpTab = await screen.findByText('MCP Servers');
    await user.click(mcpTab);

    const addButton = screen.getByText('Add Server');
    await user.click(addButton);

    expect(screen.getByText('Add MCP Server')).toBeInTheDocument();
  });

  it('shows Connected OAuth providers', async () => {
    const user = userEvent.setup();
    mockFetchIntegrations.mockResolvedValue({
      integrations: [
        {
          id: '1',
          platform: 'google_oauth',
          displayName: 'Google',
          status: 'connected',
          messageCount: 0,
          config: {},
          enabled: true,
        },
      ],
      total: 1,
      running: 1,
    });

    renderComponent();

    const oauthTab = await screen.findByText('OAuth');
    await user.click(oauthTab);

    expect(screen.getByText('Connected OAuth Providers')).toBeInTheDocument();
    expect(screen.getAllByText('Google').length).toBeGreaterThan(0);
  });
});
