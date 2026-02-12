// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskHistory } from './TaskHistory';
import { createTaskList } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchTasks: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchTasks = vi.mocked(api.fetchTasks);

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
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TaskHistory />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('TaskHistory', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
  });

  it('renders the Task History heading', async () => {
    renderComponent();
    expect(await screen.findByText('Task History')).toBeInTheDocument();
  });

  it('shows "No tasks found" when no tasks are returned', async () => {
    renderComponent();
    expect(await screen.findByText('No tasks found')).toBeInTheDocument();
  });

  it('renders task rows when tasks are returned', async () => {
    const tasks = createTaskList(3);
    mockFetchTasks.mockResolvedValue({ tasks, total: 3 });
    renderComponent();

    expect(await screen.findByText('Run deployment script')).toBeInTheDocument();
    expect(screen.getByText('Query user database')).toBeInTheDocument();
    expect(screen.getByText('Read config file')).toBeInTheDocument();
  });

  it('displays task status text', async () => {
    const tasks = createTaskList(3);
    mockFetchTasks.mockResolvedValue({ tasks, total: 3 });
    renderComponent();

    expect(await screen.findByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('displays error message for failed tasks', async () => {
    const tasks = createTaskList(2);
    mockFetchTasks.mockResolvedValue({ tasks, total: 2 });
    renderComponent();

    expect(await screen.findByText('Process exited with code 1')).toBeInTheDocument();
  });

  it('shows task type badges', async () => {
    const tasks = createTaskList(3);
    mockFetchTasks.mockResolvedValue({ tasks, total: 3 });
    renderComponent();

    expect(await screen.findByText('execute')).toBeInTheDocument();
    expect(screen.getByText('query')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
  });

  it('renders status filter dropdown with expected options', async () => {
    renderComponent();
    const statusSelect = await screen.findByLabelText('Filter by status');
    expect(statusSelect).toBeInTheDocument();
    expect(statusSelect).toHaveValue('');
  });

  it('renders type filter dropdown with expected options', async () => {
    renderComponent();
    const typeSelect = await screen.findByLabelText('Filter by type');
    expect(typeSelect).toBeInTheDocument();
    expect(typeSelect).toHaveValue('');
  });

  it('calls fetchTasks with status filter when changed', async () => {
    const user = userEvent.setup();
    renderComponent();

    const statusSelect = await screen.findByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'failed');

    expect(mockFetchTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('calls fetchTasks with type filter when changed', async () => {
    const user = userEvent.setup();
    renderComponent();

    const typeSelect = await screen.findByLabelText('Filter by type');
    await user.selectOptions(typeSelect, 'query');

    expect(mockFetchTasks).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'query' })
    );
  });

  it('shows Clear button when a filter is active and resets on click', async () => {
    const user = userEvent.setup();
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
    renderComponent();

    // Initially no Clear button
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();

    const statusSelect = await screen.findByLabelText('Filter by status');
    await user.selectOptions(statusSelect, 'completed');

    const clearButton = await screen.findByText('Clear');
    expect(clearButton).toBeInTheDocument();

    await user.click(clearButton);
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
  });

  it('shows pagination when total exceeds page size', async () => {
    const tasks = createTaskList(10);
    mockFetchTasks.mockResolvedValue({ tasks, total: 25 });
    renderComponent();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 10 of 25/)).toBeInTheDocument();
  });

  it('does not show pagination when total fits in one page', async () => {
    const tasks = createTaskList(5);
    mockFetchTasks.mockResolvedValue({ tasks, total: 5 });
    renderComponent();

    await screen.findByText('Run deployment script');
    expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
  });

  // ── Date Range Tests ────────────────────────────────────────────

  it('renders date range preset buttons', async () => {
    renderComponent();
    expect(await screen.findByText('Last hour')).toBeInTheDocument();
    expect(screen.getByText('Last 24h')).toBeInTheDocument();
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('All time')).toBeInTheDocument();
  });

  it('renders from and to date inputs', async () => {
    renderComponent();
    expect(await screen.findByLabelText('From date')).toBeInTheDocument();
    expect(screen.getByLabelText('To date')).toBeInTheDocument();
  });

  // ── Export Tests ─────────────────────────────────────────────────

  it('renders export CSV and JSON buttons', async () => {
    renderComponent();
    expect(await screen.findByLabelText('Export CSV')).toBeInTheDocument();
    expect(screen.getByLabelText('Export JSON')).toBeInTheDocument();
  });
});
