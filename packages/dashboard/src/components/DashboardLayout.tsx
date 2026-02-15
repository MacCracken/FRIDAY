import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  Lock,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  HardDrive,
  Loader2,
  Menu,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSidebar } from '../hooks/useSidebar';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchMetrics, fetchHealth, fetchOnboardingStatus } from '../api/client';
import { Sidebar } from './Sidebar';
import { SearchBar } from './SearchBar';
import { NotificationBell } from './NotificationBell';
import { ErrorBoundary } from './common/ErrorBoundary';
import { OnboardingWizard } from './OnboardingWizard';
import type { MetricsSnapshot } from '../types';

// Lazy-loaded route components — splits ReactFlow (~200KB) + Recharts (~100KB)
// into separate chunks that only load when their routes are visited.
const MetricsGraph = lazy(() =>
  import('./MetricsGraph').then((m) => ({ default: m.MetricsGraph }))
);
const ResourceMonitor = lazy(() =>
  import('./ResourceMonitor').then((m) => ({ default: m.ResourceMonitor }))
);
const PersonalityEditor = lazy(() =>
  import('./PersonalityEditor').then((m) => ({ default: m.PersonalityEditor }))
);
const CodePage = lazy(() => import('./CodePage').then((m) => ({ default: m.CodePage })));
const ChatPage = lazy(() => import('./ChatPage').then((m) => ({ default: m.ChatPage })));
const ExperimentsPage = lazy(() =>
  import('./ExperimentsPage').then((m) => ({ default: m.ExperimentsPage }))
);
const SettingsPage = lazy(() =>
  import('./SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const SecurityPage = lazy(() =>
  import('./SecurityPage').then((m) => ({ default: m.SecurityPage }))
);
const SkillsPage = lazy(() => import('./SkillsPage').then((m) => ({ default: m.SkillsPage })));
const ConnectionsPage = lazy(() =>
  import('./ConnectionsPage').then((m) => ({ default: m.ConnectionsPage }))
);

export function DashboardLayout() {
  const { logout } = useAuth();
  const { collapsed, setMobileOpen } = useSidebar();

  // Local network check
  const [isLocalNetwork, setIsLocalNetwork] = useState(true);
  useEffect(() => {
    const hostname = window.location.hostname;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.endsWith('.local');
    setIsLocalNetwork(isLocal);
  }, []);

  // Data queries
  const { data: health, error: healthError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });

  const { data: metrics, refetch: refetchMetrics } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 5000,
  });

  const { connected, reconnecting } = useWebSocket('/ws/metrics');

  const { data: onboarding, refetch: refetchOnboarding } = useQuery({
    queryKey: ['onboarding'],
    queryFn: fetchOnboardingStatus,
    retry: false,
  });

  if (onboarding?.needed) {
    return (
      <OnboardingWizard
        onComplete={() => {
          void refetchOnboarding();
        }}
      />
    );
  }

  if (!isLocalNetwork) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="card max-w-md p-8 text-center">
          <Lock className="w-16 h-16 mx-auto text-destructive mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">
            The SecureYeoman Dashboard is only accessible from the local network.
          </p>
        </div>
      </div>
    );
  }

  const isConnected = !healthError && health?.status === 'ok';

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <Sidebar
        isConnected={isConnected}
        wsConnected={connected}
        reconnecting={reconnecting}
        onRefresh={() => refetchMetrics()}
        onLogout={() => void logout()}
      />

      {/* Main content column */}
      <div
        className="flex flex-col flex-1 min-h-screen transition-[margin-left] duration-200"
        style={{
          marginLeft: `var(--sidebar-collapsed)`,
        }}
      >
        {/* Use CSS media query via class for responsive margin */}
        <style>{`
          @media (min-width: 768px) {
            .sidebar-content-area {
              margin-left: ${collapsed ? 'var(--sidebar-collapsed)' : 'var(--sidebar-expanded)'} !important;
            }
          }
          @media (max-width: 767px) {
            .sidebar-content-area {
              margin-left: 0 !important;
            }
          }
        `}</style>

        <div
          className="sidebar-content-area flex flex-col flex-1 min-h-0 transition-[margin-left] duration-200"
          style={{ marginLeft: 0 }}
        >
          {/* Header */}
          <header className="border-b bg-card sticky top-0 z-20 shrink-0">
            <div className="px-4 py-3 sm:py-4">
              <div className="flex items-center justify-between gap-2">
                {/* Mobile: hamburger + logo */}
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 md:hidden">
                  <button
                    className="btn-ghost p-2"
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open navigation menu"
                  >
                    <Menu className="w-5 h-5" />
                  </button>
                  <Shield className="w-7 h-7 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <h1 className="text-lg font-bold truncate">SecureYeoman</h1>
                  </div>
                </div>

                {/* Desktop: spacer so items center-right */}
                <div className="hidden md:block" />

                {/* Notification bell + search */}
                <div className="flex items-center gap-3">
                  <NotificationBell />
                  <div className="hidden md:block">
                    <SearchBar />
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="px-2 sm:px-3 py-3 sm:py-4 flex-1">
            <ErrorBoundary>
              <Suspense fallback={<PageSkeleton />}>
                <Routes>
                  <Route path="/" element={<OverviewPage metrics={metrics} />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/code" element={<CodePage />} />
                  <Route path="/security" element={<SecurityPage />} />
                  <Route path="/tasks" element={<SecurityPage />} />
                  <Route path="/reports" element={<SecurityPage />} />
                  <Route path="/personality" element={<PersonalityEditor />} />
                  <Route path="/skills" element={<SkillsPage />} />
                  <Route path="/marketplace" element={<SkillsPage />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/mcp" element={<ConnectionsPage />} />
                  <Route path="/experiments" element={<ExperimentsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/security-settings" element={<SettingsPage />} />
                  <Route path="/api-keys" element={<SettingsPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
}

// ── Overview Page ─────────────────────────────────────────────────────

function OverviewPage({ metrics }: { metrics?: MetricsSnapshot }) {
  return (
    <div className="space-y-6">
      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Tasks Today"
          value={metrics?.tasks?.total ?? 0}
          icon={<Activity className="w-5 h-5" />}
          trend={
            metrics?.tasks?.successRate
              ? `${(metrics.tasks.successRate * 100).toFixed(1)}% success`
              : undefined
          }
          trendUp={metrics?.tasks?.successRate ? metrics.tasks.successRate > 0.9 : undefined}
        />
        <StatCard
          title="Active Tasks"
          value={metrics?.tasks?.inProgress ?? 0}
          icon={<Clock className="w-5 h-5" />}
          subtitle={`${metrics?.tasks?.queueDepth ?? 0} queued`}
        />
        <StatCard
          title="Audit Entries"
          value={metrics?.security?.auditEntriesTotal ?? 0}
          icon={<Shield className="w-5 h-5" />}
          trend={metrics?.security?.auditChainValid ? 'Chain Valid' : 'Chain Invalid'}
          trendUp={metrics?.security?.auditChainValid}
        />
        <StatCard
          title="Memory Usage"
          value={`${(metrics?.resources?.memoryUsedMb ?? 0).toFixed(1)} MB`}
          icon={<HardDrive className="w-5 h-5" />}
        />
      </div>

      {/* Metrics Graph */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title text-lg">System Overview</h2>
          <p className="card-description">Real-time visualization of agent activity</p>
        </div>
        <div className="card-content">
          <ErrorBoundary fallbackTitle="Graph failed to render">
            <MetricsGraph metrics={metrics} />
          </ErrorBoundary>
        </div>
      </div>

      {/* Resource Monitor */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title text-lg">Resource Usage</h2>
        </div>
        <div className="card-content">
          <ResourceMonitor metrics={metrics} />
        </div>
      </div>
    </div>
  );
}

// ── PageSkeleton ──────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  trendUp?: boolean;
  subtitle?: string;
}

function StatCard({ title, value, icon, trend, trendUp, subtitle }: StatCardProps) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-xl sm:text-2xl font-bold mt-1 truncate">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          {trend && (
            <p
              className={`text-xs mt-1 flex items-center gap-1 ${
                trendUp === true
                  ? 'text-success'
                  : trendUp === false
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }`}
            >
              {trendUp === true && <CheckCircle className="w-3 h-3" />}
              {trendUp === false && <XCircle className="w-3 h-3" />}
              {trend}
            </p>
          )}
        </div>
        <div className="p-2 bg-primary/10 rounded-lg text-primary">{icon}</div>
      </div>
    </div>
  );
}
