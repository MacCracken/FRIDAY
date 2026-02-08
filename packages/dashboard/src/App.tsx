import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Shield, 
  Activity, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Cpu,
  HardDrive,
  Zap,
  Lock,
  RefreshCw
} from 'lucide-react';
import { MetricsGraph } from './components/MetricsGraph';
import { TaskHistory } from './components/TaskHistory';
import { SecurityEvents } from './components/SecurityEvents';
import { ResourceMonitor } from './components/ResourceMonitor';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchMetrics, fetchHealth } from './api/client';
import type { MetricsSnapshot } from './types';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'security'>('overview');
  
  // Check if we're on local network
  const [isLocalNetwork, setIsLocalNetwork] = useState(true);
  
  useEffect(() => {
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || 
                    hostname === '127.0.0.1' ||
                    hostname.startsWith('192.168.') ||
                    hostname.startsWith('10.') ||
                    hostname.startsWith('172.16.') ||
                    hostname.endsWith('.local');
    setIsLocalNetwork(isLocal);
  }, []);
  
  // Fetch health status
  const { data: health, isLoading: healthLoading, error: healthError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 5000,
  });
  
  // Fetch metrics
  const { data: metrics, isLoading: metricsLoading, refetch: refetchMetrics } = useQuery({
    queryKey: ['metrics'],
    queryFn: fetchMetrics,
    refetchInterval: 5000,
  });
  
  // WebSocket for real-time updates
  const { connected, lastMessage } = useWebSocket('/ws/metrics');
  
  // Block access if not on local network
  if (!isLocalNetwork) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="card max-w-md p-8 text-center">
          <Lock className="w-16 h-16 mx-auto text-destructive mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground">
            The SecureClaw Dashboard is only accessible from the local network.
          </p>
        </div>
      </div>
    );
  }
  
  const isConnected = !healthError && health?.status === 'ok';
  
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-primary" />
              <div>
                <h1 className="text-xl font-bold">SecureClaw</h1>
                <p className="text-xs text-muted-foreground">Performance Dashboard</p>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              {/* Connection Status */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-destructive'}`} />
                <span className="text-sm text-muted-foreground">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              
              {/* WebSocket Status */}
              <div className="flex items-center gap-2">
                <Activity className={`w-4 h-4 ${connected ? 'text-success' : 'text-muted-foreground'}`} />
                <span className="text-sm text-muted-foreground">
                  {connected ? 'Live' : 'Polling'}
                </span>
              </div>
              
              {/* Refresh Button */}
              <button 
                onClick={() => refetchMetrics()}
                className="btn-ghost p-2"
                title="Refresh metrics"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Navigation Tabs */}
      <nav className="border-b bg-card">
        <div className="container mx-auto px-4">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'overview' 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'tasks' 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'security' 
                  ? 'border-primary text-primary' 
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Security
            </button>
          </div>
        </div>
      </nav>
      
      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <MetricsGraph metrics={metrics} />
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
        )}
        
        {activeTab === 'tasks' && (
          <TaskHistory />
        )}
        
        {activeTab === 'security' && (
          <SecurityEvents metrics={metrics} />
        )}
      </main>
      
      {/* Footer */}
      <footer className="border-t bg-card mt-auto">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>SecureClaw v0.1.0</span>
            <span>Local Network Only</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

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

export default App;
