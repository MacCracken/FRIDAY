// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchBar } from './SearchBar';
import { createTaskList, createSecurityEventList } from '../test/mocks';

vi.mock('../api/client', () => ({
  fetchTasks: vi.fn(),
  fetchSecurityEvents: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchTasks = vi.mocked(api.fetchTasks);
const mockFetchSecurityEvents = vi.mocked(api.fetchSecurityEvents);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function renderComponent() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={createQueryClient()}>
        <SearchBar />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchTasks.mockResolvedValue({ tasks: createTaskList(5), total: 5 });
    mockFetchSecurityEvents.mockResolvedValue({
      events: createSecurityEventList(),
      total: 4,
    });
  });

  it('renders the search input', () => {
    renderComponent();
    expect(screen.getByLabelText('Global search')).toBeInTheDocument();
  });

  it('shows placeholder text with keyboard shortcut', () => {
    renderComponent();
    expect(screen.getByPlaceholderText('Search... (Ctrl+K)')).toBeInTheDocument();
  });

  it('shows "No results found" when query has no matches', async () => {
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
    mockFetchSecurityEvents.mockResolvedValue({ events: [], total: 0 });

    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText('Global search');
    await user.type(input, 'zzz_no_match');

    await waitFor(() => {
      expect(screen.getByText('No results found')).toBeInTheDocument();
    });
  });

  it('shows task results matching search term', async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText('Global search');
    await user.type(input, 'deployment');

    await waitFor(() => {
      expect(screen.getByText('Tasks')).toBeInTheDocument();
      expect(screen.getByText('Run deployment script')).toBeInTheDocument();
    });
  });

  it('shows security results matching search term', async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText('Global search');
    await user.type(input, 'injection');

    await waitFor(() => {
      expect(screen.getByText('Security Events')).toBeInTheDocument();
    });
  });

  it('clears search when X button is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const input = screen.getByLabelText('Global search');
    await user.type(input, 'test');

    const clearBtn = screen.getByLabelText('Clear search');
    await user.click(clearBtn);

    expect(input).toHaveValue('');
  });

  it('responds to Ctrl+K keyboard shortcut', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.keyboard('{Control>}k{/Control}');

    expect(screen.getByLabelText('Global search')).toHaveFocus();
  });
});
