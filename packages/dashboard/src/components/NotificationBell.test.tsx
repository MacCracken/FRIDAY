// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationBell } from './NotificationBell';

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(),
}));

import { useWebSocket } from '../hooks/useWebSocket';

const mockUseWebSocket = vi.mocked(useWebSocket);

describe('NotificationBell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockUseWebSocket.mockReturnValue({
      connected: true,
      reconnecting: false,
      lastMessage: null,
      send: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    });
  });

  it('renders the notification bell button', () => {
    render(<NotificationBell />);
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument();
  });

  it('shows "No notifications" when dropdown is opened and empty', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('shows notifications header when opened', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Notifications')).toBeInTheDocument();
  });

  it('loads notifications from localStorage', async () => {
    const stored = [
      {
        id: 'test-1',
        type: 'security',
        title: 'Test Alert',
        message: 'Something happened',
        timestamp: Date.now(),
        read: false,
      },
    ];
    localStorage.setItem('friday_notifications', JSON.stringify(stored));

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Test Alert')).toBeInTheDocument();
    expect(screen.getByText('Something happened')).toBeInTheDocument();
  });

  it('shows unread count badge', () => {
    const stored = [
      { id: '1', type: 'security', title: 'A', message: 'B', timestamp: Date.now(), read: false },
      { id: '2', type: 'security', title: 'C', message: 'D', timestamp: Date.now(), read: false },
    ];
    localStorage.setItem('friday_notifications', JSON.stringify(stored));

    render(<NotificationBell />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('clears all notifications when clear button is clicked', async () => {
    const stored = [
      { id: '1', type: 'security', title: 'A', message: 'B', timestamp: Date.now(), read: false },
    ];
    localStorage.setItem('friday_notifications', JSON.stringify(stored));

    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(screen.getByLabelText('Notifications'));
    await user.click(screen.getByLabelText('Clear all notifications'));
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });
});
