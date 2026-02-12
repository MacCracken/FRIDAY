// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModelWidget } from './ModelWidget';
import { createModelInfoResponse } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchModelInfo: vi.fn(),
  switchModel: vi.fn(),
}));

import * as api from '../api/client';

const mockFetchModelInfo = vi.mocked(api.fetchModelInfo);
const mockSwitchModel = vi.mocked(api.switchModel);

// ── Helpers ──────────────────────────────────────────────────────

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderComponent(onClose = vi.fn()) {
  const qc = createQueryClient();
  return {
    onClose,
    ...render(
      <QueryClientProvider client={qc}>
        <ModelWidget onClose={onClose} />
      </QueryClientProvider>
    ),
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('ModelWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchModelInfo.mockResolvedValue(createModelInfoResponse());
    mockSwitchModel.mockResolvedValue({ success: true, model: 'openai/gpt-4o' });
  });

  it('renders current model info', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Model Selection')).toBeInTheDocument();
    });

    expect(screen.getByText('Current Model')).toBeInTheDocument();
    // The model name appears in both the current section and the list, so use getAllByText
    const modelElements = screen.getAllByText(/claude-sonnet-4-20250514/);
    expect(modelElements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows provider sections', async () => {
    renderComponent();

    await waitFor(() => {
      // Use getAllByText since "Anthropic" appears in current model badge too
      const elements = screen.getAllByText(/Anthropic/);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    expect(screen.getByText(/Ollama/)).toBeInTheDocument();
  });

  it('calls switchModel when a different model is clicked', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/OpenAI/)).toBeInTheDocument();
    });

    // Expand OpenAI section
    await user.click(screen.getByText(/OpenAI/));

    // Click gpt-4o
    await waitFor(() => {
      expect(screen.getByText('gpt-4o')).toBeInTheDocument();
    });
    await user.click(screen.getByText('gpt-4o'));

    expect(mockSwitchModel).toHaveBeenCalled();
    const call = mockSwitchModel.mock.calls[0][0];
    expect(call).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('shows pricing information for models', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/\$3 \/ \$15 per 1M tokens/)).toBeInTheDocument();
    });
  });

  it('shows free label for ollama', async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Ollama/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Ollama/));

    await waitFor(() => {
      expect(screen.getByText(/Free \(local\)/)).toBeInTheDocument();
    });
  });
});
