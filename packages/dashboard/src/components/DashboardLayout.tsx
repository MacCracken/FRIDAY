import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { fetchMetrics, fetchHealth, fetchOnboardingStatus } from '../api/client';
import { NavigationTabs } from './NavigationTabs';
import { StatusBar } from './StatusBar';
import { ErrorBoundary } from './common/ErrorBoundary';
import { MetricsGraph } from './MetricsGraph';
import { TaskHistory } from './TaskHistory';
import { SecurityEvents } from './SecurityEvents';
import { ResourceMonitor } from './ResourceMonitor';
import { OnboardingWizard } from './OnboardingWizard';
import { PersonalityEditor } from './PersonalityEditor';
import { SkillsManager } from './SkillsManager';
import { ConnectionManager } from './ConnectionManager';
import { SettingsPage } from './SettingsPage';
import type { MetricsSnapshot } from '../types';

export function DashboardLayout() {
  const { logout } = useAuth();

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

  const { connected } = useWebSocket('/ws/metrics');

  const { data: onboarding, refetch: refetchOnboarding } = useQuery({
    queryKey: ['onboarding'],
    queryFn: fetchOnboardingStatus,
    retry: false,
  });

  if (onboarding?.needed) {
    return <OnboardingWizard onComplete={() => { void refetchOnboarding(); }} />;
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
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card relative">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold">SecureYeoman</h1>
                <p className="text-xs text-muted-foreground hidden sm:block">Performance Dashboard</p>
              </div>
            </div>

            <StatusBar
              isConnected={isConnected}
              wsConnected={connected}
              onRefresh={() => refetchMetrics()}
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </header>

      {/* Navigation */}
      <NavigationTabs />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6 flex-1">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<OverviewPage metrics={metrics} />} />
            <Route path="/tasks" element={<TaskHistory />} />
            <Route path="/security" element={<SecurityEvents metrics={metrics} />} />
            <Route path="/personality" element={<PersonalityEditor />} />
            <Route path="/skills" element={<SkillsManager />} />
            <Route path="/connections" element={<ConnectionManager />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>SecureYeoman v0.1.0</span>
            <span>Local Network Only</span>
          </div>
        </div>
      </footer>
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
          trend={metrics?.tasks?.successRate ? `${(metrics.tasks.successRate * 100).toFixed(1)}% success` : undefined}
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
          <p className="text-2xl font-bold mt-1">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
          {trend && (
            <p className={`text-xs mt-1 flex items-center gap-1 ${
              trendUp === true ? 'text-success' :
              trendUp === false ? 'text-destructive' :
              'text-muted-foreground'
            }`}>
              {trendUp === true && <CheckCircle className="w-3 h-3" />}
              {trendUp === false && <XCircle className="w-3 h-3" />}
              {trend}
            </p>
          )}
        </div>
        <div className="p-2 bg-primary/10 rounded-lg text-primary">
          {icon}
        </div>
      </div>
    </div>
  );
}
