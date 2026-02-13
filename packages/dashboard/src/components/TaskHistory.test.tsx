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
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  updateTask: vi.fn(),
  fetchHeartbeatTasks: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchTasks = vi.mocked(api.fetchTasks);
const mockCreateTask = vi.mocked(api.createTask);
const mockUpdateTask = vi.mocked(api.updateTask);
const mockDeleteTask = vi.mocked(api.deleteTask);
const mockFetchHeartbeatTasks = vi.mocked(api.fetchHeartbeatTasks);

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
    mockFetchHeartbeatTasks.mockResolvedValue({ tasks: [] });
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

    expect(mockFetchTasks).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('calls fetchTasks with type filter when changed', async () => {
    const user = userEvent.setup();
    renderComponent();

    const typeSelect = await screen.findByLabelText('Filter by type');
    await user.selectOptions(typeSelect, 'query');

    expect(mockFetchTasks).toHaveBeenCalledWith(expect.objectContaining({ type: 'query' }));
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

  // ── Create Task Tests ─────────────────────────────────────────────

  it('renders New Task button', async () => {
    renderComponent();
    expect(await screen.findByText('New Task')).toBeInTheDocument();
  });

  it('opens create dialog when New Task button is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    const newTaskButton = await screen.findByText('New Task');
    await user.click(newTaskButton);

    expect(screen.getByText('Create New Task')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., Run backup')).toBeInTheDocument();
  });

  it('can fill in the create task form', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByText('New Task'));

    const nameInput = screen.getByPlaceholderText('e.g., Run backup');
    await user.type(nameInput, 'My New Task');

    expect(nameInput).toHaveValue('My New Task');
  });

  it('calls createTask when form is submitted', async () => {
    const user = userEvent.setup();
    mockCreateTask.mockResolvedValue({
      id: 'new-task-id',
      name: 'My New Task',
      type: 'execute',
      status: 'pending',
      createdAt: Date.now(),
    });
    renderComponent();

    await user.click(screen.getByText('New Task'));

    const nameInput = screen.getByPlaceholderText('e.g., Run backup');
    await user.type(nameInput, 'My New Task');

    await user.click(screen.getByText('Create Task'));

    expect(mockCreateTask).toHaveBeenCalled();
  });

  it('closes dialog after successful task creation', async () => {
    const user = userEvent.setup();
    mockCreateTask.mockResolvedValue({
      id: 'new-task-id',
      name: 'My New Task',
      type: 'execute',
      status: 'pending',
      createdAt: Date.now(),
    });
    renderComponent();

    await user.click(screen.getByText('New Task'));

    const nameInput = screen.getByPlaceholderText('e.g., Run backup');
    await user.type(nameInput, 'My New Task');

    await user.click(screen.getByText('Create Task'));

    expect(screen.queryByText('Create New Task')).not.toBeInTheDocument();
  });

  it('disables create button when name is empty', async () => {
    renderComponent();

    await userEvent.setup().click(screen.getByText('New Task'));

    const createButton = screen.getByText('Create Task');
    expect(createButton).toBeDisabled();
  });

  // ── Heartbeat Task Tests ──────────────────────────────────────────

  it('renders heartbeat tasks alongside regular tasks with personality name', async () => {
    const tasks = createTaskList(2);
    mockFetchTasks.mockResolvedValue({ tasks, total: 2 });
    mockFetchHeartbeatTasks.mockResolvedValue({
      tasks: [
        {
          name: 'system_health',
          type: 'system_health',
          enabled: true,
          intervalMs: 300000,
          lastRunAt: Date.now() - 60000,
          config: {},
          personalityId: 'p-1',
          personalityName: 'Friday',
        },
        {
          name: 'memory_status',
          type: 'memory_status',
          enabled: false,
          intervalMs: 600000,
          lastRunAt: null,
          config: {},
          personalityId: 'p-1',
          personalityName: 'Friday',
        },
      ],
    });
    renderComponent();

    // Regular tasks show
    expect(await screen.findByText('Run deployment script')).toBeInTheDocument();

    // Heartbeat section header shows with personality name
    expect(screen.getByText('Heartbeat Tasks')).toBeInTheDocument();
    expect(screen.getAllByText(/Friday/).length).toBeGreaterThanOrEqual(1);

    // Heartbeat tasks show (name appears in both name cell and type badge)
    expect(screen.getAllByText('system_health').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('memory_status').length).toBeGreaterThanOrEqual(1);

    // Per-row personality attribution
    expect(screen.getAllByText(/Managed by Friday/).length).toBe(2);
  });

  it('shows heartbeat tasks even when no regular tasks exist', async () => {
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
    mockFetchHeartbeatTasks.mockResolvedValue({
      tasks: [
        {
          name: 'system_health',
          type: 'system_health',
          enabled: true,
          intervalMs: 300000,
          lastRunAt: Date.now() - 60000,
          config: {},
          personalityId: null,
          personalityName: null,
        },
      ],
    });
    renderComponent();

    // "No tasks found" should NOT show when heartbeat tasks exist
    expect(screen.queryByText('No tasks found')).not.toBeInTheDocument();

    // Heartbeat section and task should be visible
    expect(await screen.findByText('Heartbeat Tasks')).toBeInTheDocument();
    expect(screen.getAllByText('system_health').length).toBeGreaterThanOrEqual(1);

    // Falls back to generic text when no personality is set
    expect(screen.getByText('Managed by Personality')).toBeInTheDocument();
  });

  it('shows "No tasks found" only when no regular AND no heartbeat tasks exist', async () => {
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
    mockFetchHeartbeatTasks.mockResolvedValue({ tasks: [] });
    renderComponent();

    expect(await screen.findByText('No tasks found')).toBeInTheDocument();
  });

  it('shows heartbeat Active/Disabled status', async () => {
    mockFetchTasks.mockResolvedValue({ tasks: [], total: 0 });
    mockFetchHeartbeatTasks.mockResolvedValue({
      tasks: [
        {
          name: 'enabled_task',
          type: 'system_health',
          enabled: true,
          intervalMs: 300000,
          lastRunAt: null,
          config: {},
        },
        {
          name: 'disabled_task',
          type: 'memory_status',
          enabled: false,
          intervalMs: 600000,
          lastRunAt: null,
          config: {},
        },
      ],
    });
    renderComponent();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  // ── Edit Task Tests ────────────────────────────────────────────────

  it('opens edit dialog when edit button is clicked', async () => {
    const user = userEvent.setup();
    const tasks = createTaskList(1);
    mockFetchTasks.mockResolvedValue({ tasks, total: 1 });
    renderComponent();

    await screen.findByText('Run deployment script');
    const editButton = screen.getByTitle('Edit task');
    await user.click(editButton);

    expect(screen.getByText('Edit Task')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Run deployment script')).toBeInTheDocument();
  });

  it('calls updateTask when edit form is saved', async () => {
    const user = userEvent.setup();
    const tasks = createTaskList(1);
    mockFetchTasks.mockResolvedValue({ tasks, total: 1 });
    mockUpdateTask.mockResolvedValue({
      ...tasks[0],
      name: 'Updated Name',
    });
    renderComponent();

    await screen.findByText('Run deployment script');
    await user.click(screen.getByTitle('Edit task'));

    const nameInput = screen.getByDisplayValue('Run deployment script');
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Name');

    await user.click(screen.getByText('Save'));

    expect(mockUpdateTask).toHaveBeenCalledWith(
      tasks[0].id,
      expect.objectContaining({ name: 'Updated Name' })
    );
  });

  // ── Delete Task Tests ──────────────────────────────────────────────

  it('shows confirmation dialog when delete is clicked', async () => {
    const user = userEvent.setup();
    const tasks = createTaskList(1);
    mockFetchTasks.mockResolvedValue({ tasks, total: 1 });
    renderComponent();

    await screen.findByText('Run deployment script');
    const deleteButton = screen.getByTitle('Delete task');
    await user.click(deleteButton);

    expect(screen.getByText('Delete Task')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
  });

  it('calls deleteTask when confirmation is accepted', async () => {
    const user = userEvent.setup();
    const tasks = createTaskList(1);
    mockFetchTasks.mockResolvedValue({ tasks, total: 1 });
    mockDeleteTask.mockResolvedValue(undefined);
    renderComponent();

    await screen.findByText('Run deployment script');
    await user.click(screen.getByTitle('Delete task'));

    // Click the Delete button in the confirmation dialog
    const deleteConfirmButton = screen.getByRole('button', { name: 'Delete' });
    await user.click(deleteConfirmButton);

    expect(mockDeleteTask).toHaveBeenCalledWith(tasks[0].id);
  });

  it('dismisses delete confirmation when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const tasks = createTaskList(1);
    mockFetchTasks.mockResolvedValue({ tasks, total: 1 });
    renderComponent();

    await screen.findByText('Run deployment script');
    await user.click(screen.getByTitle('Delete task'));

    expect(screen.getByText('Delete Task')).toBeInTheDocument();

    // Click Cancel
    const cancelButtons = screen.getAllByText('Cancel');
    await user.click(cancelButtons[cancelButtons.length - 1]);

    expect(screen.queryByText(/Are you sure you want to delete/)).not.toBeInTheDocument();
  });
});
