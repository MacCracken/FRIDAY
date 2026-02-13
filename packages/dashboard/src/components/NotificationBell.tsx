/**
 * Notification Bell
 *
 * In-app notifications from WebSocket security and task events.
 * Stores read state in localStorage.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, Check, Trash2, Shield, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import type { WebSocketMessage } from '../types';

interface Notification {
  id: string;
  type: 'security' | 'task_completed' | 'task_failed';
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

const STORAGE_KEY = 'friday_notifications';
const MAX_NOTIFICATIONS = 50;

function loadNotifications(): Notification[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveNotifications(notifications: Notification[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)));
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { lastMessage } = useWebSocket('/ws/metrics');

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Process incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    const notification = messageToNotification(lastMessage);
    if (!notification) return;

    setNotifications((prev) => {
      // Avoid duplicates
      if (prev.some((n) => n.id === notification.id)) return prev;
      const next = [notification, ...prev].slice(0, MAX_NOTIFICATIONS);
      saveNotifications(next);
      return next;
    });
  }, [lastMessage]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      saveNotifications(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      saveNotifications(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    saveNotifications([]);
  }, []);

  const iconForType = (type: string) => {
    switch (type) {
      case 'security': return <Shield className="w-4 h-4 text-warning flex-shrink-0" />;
      case 'task_completed': return <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />;
      case 'task_failed': return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
      default: return <AlertTriangle className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
    }
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost p-2 relative rounded-md border border-transparent hover:border-border"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 bg-card border rounded-md shadow-lg z-50 max-h-96 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <h3 className="text-sm font-medium">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="btn-ghost p-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Mark all as read"
                  title="Mark all read"
                >
                  <Check className="w-3 h-3" />
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="btn-ghost p-1 text-xs text-muted-foreground hover:text-destructive"
                  aria-label="Clear all notifications"
                  title="Clear all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markAsRead(n.id)}
                  className={`w-full text-left px-3 py-2 border-b last:border-0 hover:bg-muted/30 transition-colors flex gap-2 ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  {iconForType(n.type)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <p className={`text-xs font-medium truncate ${n.read ? '' : 'text-foreground'}`}>
                        {n.title}
                      </p>
                      {!n.read && (
                        <span className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0 ml-1" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{formatTime(n.timestamp)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function messageToNotification(msg: WebSocketMessage): Notification | null {
  const ts = msg.timestamp || Date.now();
  const payload = msg.payload as Record<string, unknown> | undefined;

  if (msg.channel === 'security' && payload) {
    return {
      id: `sec-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'security',
      title: String(payload.type ?? 'Security Event').replace(/_/g, ' '),
      message: String(payload.message ?? 'Security event detected'),
      timestamp: ts,
      read: false,
    };
  }

  if (msg.channel === 'tasks' && payload) {
    const status = String(payload.status ?? '');
    if (status === 'completed' || status === 'failed') {
      return {
        id: `task-${ts}-${Math.random().toString(36).slice(2, 6)}`,
        type: status === 'completed' ? 'task_completed' : 'task_failed',
        title: `Task ${status}`,
        message: String(payload.name ?? payload.id ?? 'Unknown task'),
        timestamp: ts,
        read: false,
      };
    }
  }

  return null;
}
