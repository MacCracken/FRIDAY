import { Activity, RefreshCw, LogOut, Sun, Moon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useSessionTimeout } from '../hooks/useSessionTimeout';

interface StatusBarProps {
  isConnected: boolean;
  wsConnected: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

export function StatusBar({ isConnected, wsConnected, onRefresh, onLogout }: StatusBarProps) {
  const { theme, toggle } = useTheme();
  const { showWarning, dismiss } = useSessionTimeout(3600);

  return (
    <>
      <div className="flex items-center gap-4">
        {/* Connection Status */}
        <div className="flex items-center gap-2" role="status" aria-label="Server connection status">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-destructive'}`} />
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* WebSocket Status */}
        <div className="flex items-center gap-2" role="status" aria-label="Live updates status">
          <Activity className={`w-4 h-4 ${wsConnected ? 'text-success' : 'text-muted-foreground'}`} />
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {wsConnected ? 'Live' : 'Polling'}
          </span>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggle}
          className="btn-ghost p-2"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="btn-ghost p-2"
          aria-label="Refresh metrics"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Logout */}
        <button
          onClick={onLogout}
          className="btn-ghost p-2"
          aria-label="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
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
