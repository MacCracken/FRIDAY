import { useState, useEffect, useRef } from 'react';
import {
  Activity, RefreshCw, LogOut, Sun, Moon, User, ChevronDown, Loader2,
} from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useSessionTimeout } from '../hooks/useSessionTimeout';
import { getAccessToken } from '../api/client';

interface StatusBarProps {
  isConnected: boolean;
  wsConnected: boolean;
  reconnecting: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

function parseJwtRole(): string {
  try {
    const token = getAccessToken();
    if (!token) return 'unknown';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.role ?? 'user';
  } catch {
    return 'user';
  }
}

export function StatusBar({ isConnected, wsConnected, reconnecting, onRefresh, onLogout }: StatusBarProps) {
  const { theme, toggle } = useTheme();
  const { showWarning, dismiss } = useSessionTimeout(3600);
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const role = parseJwtRole();

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2" role="status" aria-label="Server connection status">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-destructive'}`} />
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* WebSocket Status */}
        <div className="flex items-center gap-1.5" role="status" aria-label="Live updates status">
          {reconnecting ? (
            <Loader2 className="w-4 h-4 animate-spin text-warning" />
          ) : (
            <Activity className={`w-4 h-4 ${wsConnected ? 'text-success' : 'text-muted-foreground'}`} />
          )}
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {reconnecting ? 'Reconnecting...' : wsConnected ? 'Live' : 'Polling'}
          </span>
        </div>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="btn-ghost p-2"
          aria-label="Refresh metrics"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* User Profile Dropdown */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="btn-ghost p-2 flex items-center gap-1"
            aria-label="User menu"
            aria-expanded={profileOpen}
            aria-haspopup="menu"
          >
            <User className="w-4 h-4" />
            <ChevronDown className={`w-3 h-3 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          </button>

          {profileOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-md shadow-lg z-50"
              role="menu"
            >
              {/* User info */}
              <div className="px-3 py-2 border-b">
                <p className="text-sm font-medium">Admin</p>
                <p className="text-xs text-muted-foreground capitalize">{role}</p>
              </div>

              {/* Theme toggle */}
              <button
                onClick={() => { toggle(); setProfileOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors"
                role="menuitem"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>

              {/* Logout */}
              <button
                onClick={() => { setProfileOpen(false); onLogout(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center gap-2 transition-colors text-destructive"
                role="menuitem"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Session timeout warning */}
      {showWarning && (
        <div className="absolute top-full left-0 right-0 bg-warning/10 border-b border-warning text-warning text-sm px-4 py-2 flex justify-between items-center">
          <span>Your session expires soon. Save your work.</span>
          <button onClick={dismiss} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
