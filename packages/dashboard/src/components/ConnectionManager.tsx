import { useQuery } from '@tanstack/react-query';
import { Wifi, WifiOff, MessageCircle, Mail, Terminal, Globe, Radio, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { fetchIntegrations, fetchAvailablePlatforms } from '../api/client';
import type { IntegrationInfo, IntegrationStatus } from '../types';

interface PlatformMeta {
  name: string;
  description: string;
  icon: React.ReactNode;
}

const PLATFORM_META: Record<string, PlatformMeta> = {
  telegram: { name: 'Telegram', description: 'Connect to Telegram Bot API for messaging', icon: <MessageCircle className="w-6 h-6" /> },
  discord: { name: 'Discord', description: 'Integrate with Discord servers and channels', icon: <Radio className="w-6 h-6" /> },
  slack: { name: 'Slack', description: 'Connect to Slack workspaces via Bot API', icon: <Mail className="w-6 h-6" /> },
  cli: { name: 'CLI', description: 'Local command-line interface (built-in)', icon: <Terminal className="w-6 h-6" /> },
  webhook: { name: 'Webhook', description: 'Generic HTTP webhook for custom integrations', icon: <Globe className="w-6 h-6" /> },
};

const STATUS_CONFIG: Record<IntegrationStatus, { color: string; icon: React.ReactNode; label: string }> = {
  connected: { color: 'text-green-400', icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Connected' },
  disconnected: { color: 'text-muted', icon: <XCircle className="w-3.5 h-3.5" />, label: 'Disconnected' },
  error: { color: 'text-red-400', icon: <AlertCircle className="w-3.5 h-3.5" />, label: 'Error' },
  configuring: { color: 'text-yellow-400', icon: <AlertCircle className="w-3.5 h-3.5" />, label: 'Configuring' },
};

export function ConnectionManager() {
  const { data: integrationsData } = useQuery({
    queryKey: ['integrations'],
    queryFn: fetchIntegrations,
    refetchInterval: 10000,
  });

  const { data: platformsData } = useQuery({
    queryKey: ['availablePlatforms'],
    queryFn: fetchAvailablePlatforms,
  });

  const integrations = integrationsData?.integrations ?? [];
  const availablePlatforms = new Set(platformsData?.platforms ?? []);
  const hasRegisteredPlatforms = availablePlatforms.size > 0;

  // Build list of all platform cards: active integrations + unregistered platforms
  const activePlatformIds = new Set(integrations.map((i) => i.platform));
  const unregisteredPlatforms = Object.keys(PLATFORM_META).filter(
    (p) => !activePlatformIds.has(p)
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-primary flex items-center gap-2">
            <Wifi className="w-5 h-5" />
            Connections
          </h2>
          <p className="text-sm text-muted mt-1">
            Manage platform integrations and messaging channels
          </p>
        </div>
        {integrationsData && (
          <div className="text-sm text-muted">
            {integrationsData.running} running / {integrationsData.total} configured
          </div>
        )}
      </div>

      {/* Info banner when no platforms are registered */}
      {!hasRegisteredPlatforms && (
        <div className="card p-4 border-l-4 border-l-yellow-500 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div>
              <p className="font-medium text-sm">No platform adapters registered</p>
              <p className="text-xs text-muted mt-1">
                Platform adapters (Telegram, Discord, etc.) need to be installed and registered.
                See the integration documentation for setup instructions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active integrations */}
      {integrations.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted">Configured Integrations</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.map((integration) => (
              <IntegrationCard key={integration.id} integration={integration} />
            ))}
          </div>
        </div>
      )}

      {/* Available / coming-soon platforms */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Available Platforms</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {unregisteredPlatforms.map((platformId) => {
            const meta = PLATFORM_META[platformId];
            const isRegistered = availablePlatforms.has(platformId);
            return (
              <div
                key={platformId}
                className={`card p-4 ${isRegistered ? '' : 'opacity-60 cursor-not-allowed'}`}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-surface text-muted">
                    {meta.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-sm">{meta.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        isRegistered ? 'bg-green-500/10 text-green-400' : 'bg-surface text-muted'
                      }`}>
                        {isRegistered ? 'Available' : 'Coming Soon'}
                      </span>
                    </div>
                    <p className="text-xs text-muted mt-1">{meta.description}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationInfo }) {
  const meta = PLATFORM_META[integration.platform] ?? {
    name: integration.platform,
    description: '',
    icon: <Globe className="w-6 h-6" />,
  };
  const statusConfig = STATUS_CONFIG[integration.status];

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-surface text-muted">
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">{integration.displayName}</h3>
            <span className={`text-xs flex items-center gap-1 ${statusConfig.color}`}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">{meta.name}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted">
            <span>{integration.messageCount} messages</span>
            {integration.errorMessage && (
              <span className="text-red-400 truncate" title={integration.errorMessage}>
                {integration.errorMessage}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
