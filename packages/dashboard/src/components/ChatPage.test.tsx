// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatPage } from './ChatPage';
import { createChatResponse } from '../test/mocks';

// ── Mock API client ──────────────────────────────────────────────
vi.mock('../api/client', () => ({
  fetchActivePersonality: vi.fn(),
  sendChatMessage: vi.fn(),
  fetchModelInfo: vi.fn(),
  switchModel: vi.fn(),
}));

// ── Mock ModelWidget to keep test focused ────────────────────────
vi.mock('./ModelWidget', () => ({
  ModelWidget: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="model-widget">
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

import * as api from '../api/client';

const mockFetchActivePersonality = vi.mocked(api.fetchActivePersonality);
const mockSendChatMessage = vi.mocked(api.sendChatMessage);

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
      <ChatPage />
    </QueryClientProvider>
  );
}

// ── Tests ────────────────────────────────────────────────────────

describe('ChatPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetchActivePersonality.mockResolvedValue({
      personality: {
        id: 'p-1',
        name: 'FRIDAY',
        description: 'Friendly AI assistant',
        systemPrompt: 'You are FRIDAY.',
        traits: {},
        sex: 'unspecified',
        voice: '',
        preferredLanguage: '',
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
    mockSendChatMessage.mockResolvedValue(createChatResponse());
  });

  it('renders the Chat heading with personality name', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText(/Chat with FRIDAY/)).toBeInTheDocument();
    });
  });

  it('renders empty state message', () => {
    renderComponent();
    expect(screen.getByText(/Start a conversation/)).toBeInTheDocument();
  });

  it('sends a message and displays the response', async () => {
    const user = userEvent.setup();
    renderComponent();

    const textarea = screen.getByPlaceholderText(/Message/);
    await user.type(textarea, 'Hello!{enter}');

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalled();
    });

    const call = mockSendChatMessage.mock.calls[0][0];
    expect(call.message).toBe('Hello!');

    await waitFor(() => {
      expect(screen.getByText('Hello! I am FRIDAY, your AI assistant.')).toBeInTheDocument();
    });
  });

  it('shows the user message in the chat', async () => {
    const user = userEvent.setup();
    renderComponent();

    const textarea = screen.getByPlaceholderText(/Message/);
    await user.type(textarea, 'Test message{enter}');

    await waitFor(() => {
      expect(screen.getByText('Test message')).toBeInTheDocument();
    });
  });

  it('disables input while loading', async () => {
    let resolveChat: (value: any) => void;
    mockSendChatMessage.mockImplementation(
      () => new Promise((resolve) => { resolveChat = resolve; })
    );

    const user = userEvent.setup();
    renderComponent();

    const textarea = screen.getByPlaceholderText(/Message/);
    await user.type(textarea, 'Hello!{enter}');

    await waitFor(() => {
      expect(textarea).toBeDisabled();
    });

    // Resolve the promise
    resolveChat!(createChatResponse());

    await waitFor(() => {
      expect(textarea).not.toBeDisabled();
    });
  });

  it('toggles model widget on button click', async () => {
    const user = userEvent.setup();
    renderComponent();

    const modelButton = screen.getByText('Model Info');
    await user.click(modelButton);

    expect(screen.getByTestId('model-widget')).toBeInTheDocument();

    // Close it
    await user.click(screen.getByText('Close'));
    expect(screen.queryByTestId('model-widget')).not.toBeInTheDocument();
  });

  it('displays error message on chat failure', async () => {
    mockSendChatMessage.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    renderComponent();

    const textarea = screen.getByPlaceholderText(/Message/);
    await user.type(textarea, 'Hello!{enter}');

    await waitFor(() => {
      expect(screen.getByText(/Error: Network error/)).toBeInTheDocument();
    });
  });
});
