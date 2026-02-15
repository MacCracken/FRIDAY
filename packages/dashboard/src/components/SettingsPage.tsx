import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Settings, Shield, Key, Blocks } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { fetchSoulConfig, fetchMcpServers } from '../api/client';
import { NotificationSettings } from './NotificationSettings';
import { LogRetentionSettings } from './LogRetentionSettings';
import { SecuritySettings } from './SecuritySettings';
import { ApiKeysSettings } from './ApiKeysSettings';

type TabType = 'general' | 'security' | 'api-keys';

export function SettingsPage() {
  const location = useLocation();
  const getInitialTab = (): TabType => {
    const path = location.pathname;
    if (path.includes('/security-settings')) return 'security';
    if (path.includes('/api-keys')) return 'api-keys';
    return 'general';
  };

  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-primary flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">System configuration and preferences</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('general')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'general'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Settings className="w-4 h-4" />
          General
        </button>
        <button
          onClick={() => setActiveTab('security')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'security'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          Security
        </button>
        <button
          onClick={() => setActiveTab('api-keys')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'api-keys'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Key className="w-4 h-4" />
          API Keys
        </button>
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'security' && <SecuritySettings />}
      {activeTab === 'api-keys' && <ApiKeysSettings />}
    </div>
  );
}

function GeneralTab() {
  const navigate = useNavigate();

  const { data: soulConfig } = useQuery({
    queryKey: ['soulConfig'],
    queryFn: fetchSoulConfig,
  });

  const { data: mcpData } = useQuery({
    queryKey: ['mcpServers'],
    queryFn: fetchMcpServers,
  });

  return (
    <div className="space-y-6">
      <NotificationSettings />
      <LogRetentionSettings />

      {soulConfig && (
        <div className="card p-4 space-y-3">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Soul System
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Status</span>
              <span className={soulConfig.enabled ? 'text-success' : 'text-destructive'}>
                {soulConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Learning Mode</span>
              <span>{soulConfig.learningMode.join(', ')}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Max Skills</span>
              <span>{soulConfig.maxSkills}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">Max Prompt Tokens</span>
              <span>{soulConfig.maxPromptTokens.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm flex items-center gap-2">
            <Blocks className="w-4 h-4" />
            MCP Servers
          </h3>
          <button
            className="text-xs text-primary hover:text-primary/80"
            onClick={() => navigate('/mcp')}
          >
            Manage
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground block">Configured</span>
            <span>{mcpData?.total ?? 0} servers</span>
          </div>
          <div>
            <span className="text-xs text-muted-foreground block">Enabled</span>
            <span>{mcpData?.servers?.filter((s) => s.enabled).length ?? 0} servers</span>
          </div>
        </div>
      </div>
    </div>
  );
}
