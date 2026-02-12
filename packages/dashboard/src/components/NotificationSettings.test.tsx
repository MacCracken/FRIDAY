// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationSettings } from './NotificationSettings';

describe('NotificationSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the heading', () => {
    render(<NotificationSettings />);
    expect(screen.getByText('Notification Preferences')).toBeInTheDocument();
  });

  it('renders enable notifications toggle', () => {
    render(<NotificationSettings />);
    expect(screen.getByLabelText('Toggle notifications')).toBeInTheDocument();
  });

  it('renders notification sound toggle', () => {
    render(<NotificationSettings />);
    expect(screen.getByLabelText('Toggle notification sound')).toBeInTheDocument();
  });

  it('renders event type checkboxes', () => {
    render(<NotificationSettings />);
    expect(screen.getByText('Security events')).toBeInTheDocument();
    expect(screen.getByText('Task completions')).toBeInTheDocument();
    expect(screen.getByText('Task failures')).toBeInTheDocument();
  });

  it('persists preferences to localStorage', async () => {
    const user = userEvent.setup();
    render(<NotificationSettings />);

    await user.click(screen.getByLabelText('Toggle notification sound'));

    const stored = JSON.parse(localStorage.getItem('friday_notification_prefs') ?? '{}');
    expect(stored.sound).toBe(true);
  });
});
