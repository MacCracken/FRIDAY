import { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  MessageSquare,
  ListTodo,
  ShieldAlert,
  Brain,
  Zap,
  Cable,
  Code,
  Blocks,
  ShieldCheck,
  Settings,
  PanelLeftOpen,
  PanelLeftClose,
  FileText,
  FlaskConical,
  Store,
  RefreshCw,
  Activity,
  Loader2,
  User,
  ChevronDown,
  LogOut,
  Sun,
  Moon,
} from 'lucide-react';
import { useSidebar } from '../hooks/useSidebar';
import { useTheme } from '../hooks/useTheme';
import { getAccessToken } from '../api/client';

export interface SidebarProps {
  isConnected: boolean;
  wsConnected: boolean;
  reconnecting: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

const NAV_ITEMS: { to: string; label: string; icon: React.ReactNode; end?: boolean }[] = [
  { to: '/', label: 'Overview', icon: <LayoutDashboard className="w-5 h-5" />, end: true },
  { to: '/chat', label: 'Chat', icon: <MessageSquare className="w-5 h-5" /> },
  { to: '/code', label: 'Code', icon: <Code className="w-5 h-5" /> },
  { to: '/tasks', label: 'Tasks', icon: <ListTodo className="w-5 h-5" /> },
  { to: '/security', label: 'Security', icon: <ShieldAlert className="w-5 h-5" /> },
  { to: '/personality', label: 'Personality', icon: <Brain className="w-5 h-5" /> },
  { to: '/skills', label: 'Skills', icon: <Zap className="w-5 h-5" /> },
  { to: '/connections', label: 'Connections', icon: <Cable className="w-5 h-5" /> },
  { to: '/mcp', label: 'MCP Servers', icon: <Blocks className="w-5 h-5" /> },
  { to: '/reports', label: 'Reports', icon: <FileText className="w-5 h-5" /> },
  { to: '/experiments', label: 'Experiments', icon: <FlaskConical className="w-5 h-5" /> },
  { to: '/marketplace', label: 'Marketplace', icon: <Store className="w-5 h-5" /> },
  { to: '/security-settings', label: 'Security Config', icon: <ShieldCheck className="w-5 h-5" /> },
  { to: '/settings', label: 'Settings', icon: <Settings className="w-5 h-5" /> },
];

const navLinkClass = (isActive: boolean, collapsed: boolean) =>
  `group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
  } ${collapsed ? 'justify-center' : ''}`;

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

export function Sidebar({ isConnected, wsConnected, reconnecting, onRefresh, onLogout }: SidebarProps) {
  const { collapsed, toggleCollapse, mobileOpen, setMobileOpen } = useSidebar();
  const { theme, toggle: toggleTheme } = useTheme();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const role = parseJwtRole();

  // Close mobile overlay on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, setMobileOpen]);

  // Click outside to close profile dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo area with refresh button */}
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-border">
        <Shield className="w-7 h-7 text-primary flex-shrink-0" />
        <span
          className={`font-bold text-lg whitespace-nowrap transition-opacity duration-200 flex-1 ${
            collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
          }`}
        >
          SecureYeoman
        </span>
        {!collapsed && (
          <button
            onClick={onRefresh}
            className="btn-ghost p-1.5 rounded flex-shrink-0"
            aria-label="Refresh metrics"
            title="Refresh metrics"
          >
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => navLinkClass(isActive, collapsed)}
          >
            <span className="flex-shrink-0">{icon}</span>
            <span
              className={`transition-opacity duration-200 ${
                collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
              }`}
            >
              {label}
            </span>
            {/* Collapsed tooltip */}
            {collapsed && (
              <span className="sidebar-tooltip">
                {label}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Toggle button */}
      <div className="px-3 py-2 border-t border-border">
        <button
          onClick={toggleCollapse}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-5 h-5 flex-shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="w-5 h-5 flex-shrink-0" />
              <span className="transition-opacity duration-200">Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* User profile */}
      <div ref={profileRef} className="relative px-3 pt-2 pb-0 border-t border-border">
        <button
          onClick={() => setProfileOpen((v) => !v)}
          className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          aria-label="User menu"
          aria-expanded={profileOpen}
          aria-haspopup="menu"
        >
          <User className="w-5 h-5 flex-shrink-0" />
          <span
            className={`flex-1 text-left transition-opacity duration-200 ${
              collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
            }`}
          >
            Admin
          </span>
          {!collapsed && (
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
          )}
        </button>

        {profileOpen && (
          <div
            className={`absolute ${
              collapsed ? 'left-full bottom-0 ml-2' : 'left-3 right-3 bottom-full mb-1'
            } bg-card border rounded-md shadow-lg z-50`}
            role="menu"
          >
            {/* User info */}
            <div className="px-3 py-2 border-b">
              <p className="text-sm font-medium">Admin</p>
              <p className="text-xs text-muted-foreground capitalize">{role}</p>
            </div>

            {/* Theme toggle */}
            <button
              onClick={() => { toggleTheme(); setProfileOpen(false); }}
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

      {/* Connection & Live status */}
      <div className={`px-3 pb-3 pt-1 space-y-1 ${collapsed ? '' : ''}`}>
        {/* Connection Status */}
        <div
          className={`flex items-center gap-3 px-3 py-1.5 ${collapsed ? 'justify-center' : ''}`}
          role="status"
          aria-label="Server connection status"
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-destructive'}`} />
          </div>
          <span
            className={`text-xs text-muted-foreground whitespace-nowrap transition-opacity duration-200 ${
              collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
            }`}
          >
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* WebSocket Status */}
        <div
          className={`flex items-center gap-3 px-3 py-1.5 ${collapsed ? 'justify-center' : ''}`}
          role="status"
          aria-label="Live updates status"
        >
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            {reconnecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-warning" />
            ) : (
              <Activity className={`w-3.5 h-3.5 ${wsConnected ? 'text-success' : 'text-muted-foreground'}`} />
            )}
          </div>
          <span
            className={`text-xs text-muted-foreground whitespace-nowrap transition-opacity duration-200 ${
              collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
            }`}
          >
            {reconnecting ? 'Reconnecting...' : wsConnected ? 'Live' : 'Polling'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col fixed left-0 top-0 h-screen bg-card border-r border-border z-30 transition-[width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ width: collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-expanded)' }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="md:hidden fixed left-0 top-0 h-screen bg-card border-r border-border z-50 transition-transform duration-200"
            style={{ width: 'var(--sidebar-expanded)' }}
          >
            {sidebarContent}
          </aside>
        </>
      )}
    </>
  );
}
