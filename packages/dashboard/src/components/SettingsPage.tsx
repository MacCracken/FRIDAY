/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable react-hooks/static-components */
import { useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Settings,
  Shield,
  Key,
  Users,
  Bell,
  AlertTriangle,
  Palette,
  Check,
  Lock,
  Database,
  Download,
  Trash2,
  RefreshCw,
  Plus,
  BadgeCheck,
  Sparkles,
  Upload,
  Clock,
  X,
  Copy,
  Sun,
  Moon,
  DollarSign,
  ArrowRight,
  Pencil,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchBackups,
  createBackup,
  downloadBackup,
  deleteBackup,
  setLicenseKey,
  fetchMarketplaceSkills,
  uninstallMarketplaceSkill,
} from '../api/client';
import type { BackupRecord } from '../types';
import { useLicense, ALL_LICENSED_FEATURES } from '../hooks/useLicense';
import { useLemonCheckout } from '../hooks/useLemonCheckout';
import { NotificationSettings } from './NotificationSettings';
import { LogRetentionSettings } from './LogRetentionSettings';
import { SecuritySettings, RolesSettings, ServiceKeysPanel } from './SecuritySettings';
import { ApiKeysSettings } from './ApiKeysSettings';
import { ProviderKeysSettings } from './ProviderKeysSettings';
import GpuStatusPanel from './GpuStatusPanel';
import { NotificationPrefsPanel } from './NotificationPrefsPanel';
import {
  useTheme,
  THEMES,
  THEME_CSS_VARS,
  loadCustomThemes,
  addCustomTheme,
  removeCustomTheme,
  exportCustomTheme,
  validateCustomTheme,
  isValidHsl,
  extractThemeCssVars,
  loadSchedule,
  saveSchedule,
  type CustomTheme,
  type CustomThemeExport,
  type ThemeCssVar,
  type ThemeSchedule,
  type ThemeId,
} from '../hooks/useTheme';
import { AuditChainTab } from './AuditChainTab';
import { SoulSystemTab } from './SoulSystemTab';
import { RateLimitingTab } from './RateLimitingTab';
import { KeyRotationCard } from './KeyRotationCard';

type TabType =
  | 'general'
  | 'appearance'
  | 'security'
  | 'keys'
  | 'roles'
  | 'souls'
  | 'notifications'
  | 'backup';

function getTabFromPath(path: string): TabType {
  if (path.includes('/security-settings')) return 'security';
  if (path.includes('/api-keys')) return 'keys';
  if (path === '/roles') return 'roles';
  if (path === '/souls') return 'souls';
  return 'general';
}

export function SettingsPage() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>(() => getTabFromPath(location.pathname));

  useEffect(() => {
    setActiveTab(getTabFromPath(location.pathname));
  }, [location.pathname]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Administration</h1>
        <p className="text-sm text-muted-foreground mt-0.5">System configuration and preferences</p>
      </div>

      <div className="flex gap-1 border-b border-border overflow-x-auto scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
        <button
          onClick={() => {
            setActiveTab('general');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'general'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Settings className="w-4 h-4" />
          General
        </button>
        <button
          onClick={() => {
            setActiveTab('souls');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'souls'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Souls
        </button>
        <button
          onClick={() => {
            setActiveTab('security');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'security'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-4 h-4" />
          Security
        </button>
        <button
          onClick={() => {
            setActiveTab('keys');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'keys'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Key className="w-4 h-4" />
          Secrets
        </button>
        <button
          onClick={() => {
            setActiveTab('notifications');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'notifications'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Bell className="w-4 h-4" />
          Notifications
        </button>
        <button
          onClick={() => {
            setActiveTab('appearance');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'appearance'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Palette className="w-4 h-4" />
          Appearance
        </button>
        <button
          onClick={() => {
            setActiveTab('roles');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'roles'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="w-4 h-4" />
          Roles
        </button>
        <button
          onClick={() => {
            setActiveTab('backup');
          }}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'backup'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Database className="w-4 h-4" />
          Backup
        </button>
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'appearance' && <AppearanceTab />}
      {activeTab === 'security' && <SecuritySettings />}
      {activeTab === 'keys' && (
        <div className="space-y-8">
          <Link
            to="/metrics?tab=costs"
            className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors group"
          >
            <DollarSign className="w-4 h-4 text-success" />
            <span className="text-sm font-medium">Provider Cost Analytics</span>
            <span className="text-xs text-muted-foreground flex-1">
              View cost trends, provider breakdown, and optimization recommendations
            </span>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </Link>
          <ProviderKeysSettings />
          <ApiKeysSettings />
          <ServiceKeysPanel />
        </div>
      )}
      {activeTab === 'roles' && <RolesSettings />}
      {activeTab === 'souls' && <SoulSystemTab />}
      {activeTab === 'notifications' && (
        <div className="space-y-6">
          <NotificationSettings />
          <NotificationPrefsPanel />
        </div>
      )}
      {activeTab === 'backup' && <BackupTab />}
    </div>
  );
}

// ── Appearance Tab ────────────────────────────────────────────────

interface MarketplaceThemeMeta {
  themeId: string;
  name: string;
  isDark: boolean;
  preview: [string, string, string];
  skillId: string;
}

/** Initial values passed into the theme editor dialog when editing an existing theme. */
interface ThemeEditorInit {
  name: string;
  isDark: boolean;
  colors: Record<ThemeCssVar, string>;
  /** When true, the theme originates from a marketplace/built-in install (not custom). */
  isInstalledTheme?: boolean;
}

/** Dialog for creating or editing a custom theme. */
function ThemeEditorDialog({
  open,
  onClose,
  onSave,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (theme: CustomThemeExport) => void;
  initial?: ThemeEditorInit | null;
}) {
  const defaultColors = (): Record<ThemeCssVar, string> => {
    const c: Record<string, string> = {};
    for (const v of THEME_CSS_VARS) c[v] = '0 0% 50%';
    return c;
  };

  const [editorName, setEditorName] = useState('My Theme');
  const [editorIsDark, setEditorIsDark] = useState(true);
  const [editorColors, setEditorColors] = useState<Record<ThemeCssVar, string>>(defaultColors);

  // Re-seed state whenever initial changes (opening with a different theme)
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setEditorName(initial.isInstalledTheme ? `${initial.name} (Custom)` : initial.name);
      setEditorIsDark(initial.isDark);
      setEditorColors({ ...initial.colors });
    } else {
      setEditorName('My Theme');
      setEditorIsDark(true);
      setEditorColors(defaultColors());
    }
  }, [open, initial]);

  if (!open) return null;

  const handleExport = () => {
    const json = JSON.stringify(
      { name: editorName, isDark: editorIsDark, colors: editorColors },
      null,
      2
    );
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editorName.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {initial?.isInstalledTheme
              ? 'Edit as Custom Theme'
              : initial
                ? 'Edit Theme'
                : 'Create Theme'}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {initial?.isInstalledTheme && (
          <p className="text-xs text-muted-foreground bg-muted rounded-lg px-3 py-2">
            Editing an installed theme creates a new custom copy. The original remains available for
            re-install.
          </p>
        )}

        <div className="flex gap-4 items-center">
          <input
            value={editorName}
            onChange={(e) => {
              setEditorName(e.target.value);
            }}
            className="text-sm px-2 py-1 rounded border border-input bg-background flex-1"
            placeholder="Theme name"
            maxLength={64}
          />
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={editorIsDark}
              onChange={(e) => {
                setEditorIsDark(e.target.checked);
              }}
              className="rounded"
            />
            Dark theme
          </label>
        </div>

        {/* Live preview strip */}
        <div className="h-8 rounded flex overflow-hidden border border-border">
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.background})` }} />
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.foreground})` }} />
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.primary})` }} />
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.accent})` }} />
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.secondary})` }} />
          <div className="flex-1" style={{ backgroundColor: `hsl(${editorColors.destructive})` }} />
        </div>

        {/* CSS variable inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {THEME_CSS_VARS.map((v) => (
            <div key={v} className="space-y-1">
              <label className="text-[10px] text-muted-foreground block">{v}</label>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-6 h-6 rounded border border-border flex-shrink-0"
                  style={{
                    backgroundColor: isValidHsl(editorColors[v])
                      ? `hsl(${editorColors[v]})`
                      : '#888',
                  }}
                />
                <input
                  value={editorColors[v]}
                  onChange={(e) => {
                    setEditorColors((prev) => ({ ...prev, [v]: e.target.value }));
                  }}
                  className={`text-xs px-1.5 py-1 rounded border bg-background flex-1 font-mono ${
                    isValidHsl(editorColors[v]) ? 'border-input' : 'border-destructive'
                  }`}
                  placeholder="H S% L%"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-border">
          <button
            onClick={handleExport}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted"
          >
            Export JSON
          </button>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave({ name: editorName, isDark: editorIsDark, colors: editorColors });
            }}
            className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(loadCustomThemes);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInit, setEditorInit] = useState<ThemeEditorInit | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ThemeSchedule>(loadSchedule);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Installed marketplace themes ──
  const { data: marketplaceThemeData } = useQuery({
    queryKey: ['marketplace-themes'],
    queryFn: () =>
      fetchMarketplaceSkills(undefined, undefined, undefined, undefined, 200, undefined, 'theme'),
  });

  const installedMarketplaceThemes: MarketplaceThemeMeta[] = (marketplaceThemeData?.skills ?? [])
    .filter((s) => s.installed)
    .map((s) => {
      try {
        const parsed = JSON.parse(s.instructions || '{}');
        return {
          themeId: parsed.themeId || s.id,
          name: parsed.name || s.name,
          isDark: parsed.isDark ?? true,
          preview: parsed.preview || ['#333', '#eee', '#88f'],
          skillId: s.id,
        };
      } catch {
        return null;
      }
    })
    .filter((t): t is MarketplaceThemeMeta => t !== null);

  const uninstallThemeMut = useMutation({
    mutationFn: (id: string) => uninstallMarketplaceSkill(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace-themes'] });
      void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });

  const refreshCustomThemes = () => {
    setCustomThemes(loadCustomThemes());
  };

  const darkThemes = THEMES.filter((t) => t.isDark && !t.enterprise);
  const darkEnterprise = THEMES.filter((t) => t.isDark && t.enterprise);
  const lightThemes = THEMES.filter((t) => !t.isDark && t.id !== 'system' && !t.enterprise);
  const lightEnterprise = THEMES.filter((t) => !t.isDark && t.enterprise);
  const systemTheme = THEMES.filter((t) => t.id === 'system');

  const ThemeCard = ({ t }: { t: (typeof THEMES)[0] }) => (
    <div
      key={t.id}
      className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-all duration-150 ${
        theme === t.id
          ? 'border-primary shadow-md shadow-primary/20'
          : 'border-border hover:border-muted-foreground/50'
      }`}
    >
      <button
        onClick={() => {
          setTheme(t.id);
        }}
        className="flex-1"
      >
        <div className="h-12 flex">
          {t.preview.map((color, i) => (
            <div key={i} className="flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-card text-left">
        <span className="text-xs font-medium truncate flex-1">{t.name}</span>
        {theme === t.id && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
        {t.id !== 'system' && (
          <button
            onClick={() => {
              openEditBuiltinTheme(t);
            }}
            className="p-0.5 text-muted-foreground hover:text-primary"
            title="Edit as custom theme"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );

  const CustomThemeCard = ({ t }: { t: CustomTheme }) => {
    const themeId: ThemeId = `custom:${t.id}`;
    return (
      <div
        className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-all duration-150 ${
          theme === themeId
            ? 'border-primary shadow-md shadow-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        }`}
      >
        <button
          onClick={() => {
            setTheme(themeId);
          }}
          className="flex-1"
        >
          <div className="h-12 flex">
            <div className="flex-1" style={{ backgroundColor: `hsl(${t.colors.background})` }} />
            <div className="flex-1" style={{ backgroundColor: `hsl(${t.colors.foreground})` }} />
            <div className="flex-1" style={{ backgroundColor: `hsl(${t.colors.primary})` }} />
          </div>
        </button>
        <div className="flex items-center gap-1 px-2 py-1.5 bg-card text-left">
          <span className="text-xs font-medium truncate flex-1">{t.name}</span>
          <button
            onClick={() => {
              openEditCustomTheme(t);
            }}
            className="p-0.5 hover:text-primary"
            title="Edit theme"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              const json = JSON.stringify(exportCustomTheme(t), null, 2);
              void navigator.clipboard.writeText(json);
            }}
            className="p-0.5 hover:text-primary"
            title="Copy JSON"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              removeCustomTheme(t.id);
              refreshCustomThemes();
              if (theme === themeId) setTheme('dark');
            }}
            className="p-0.5 hover:text-destructive"
            title="Delete"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  const Section = ({ label, themes }: { label: string; themes: typeof THEMES }) => (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {themes.map((t) => (
          <ThemeCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );

  const MarketplaceThemeCard = ({ t }: { t: MarketplaceThemeMeta }) => {
    const themeId = t.themeId as ThemeId;
    return (
      <div
        className={`relative flex flex-col rounded-lg border-2 overflow-hidden transition-all duration-150 ${
          theme === themeId
            ? 'border-primary shadow-md shadow-primary/20'
            : 'border-border hover:border-muted-foreground/50'
        }`}
      >
        <button
          onClick={() => {
            setTheme(themeId);
          }}
          className="flex-1"
        >
          <div className="h-12 flex">
            {t.preview.map((color, i) => (
              <div key={i} className="flex-1" style={{ backgroundColor: color }} />
            ))}
          </div>
        </button>
        <div className="flex items-center gap-1 px-2 py-1.5 bg-card text-left">
          <span className="text-xs font-medium truncate flex-1">{t.name}</span>
          {theme === themeId && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          <button
            onClick={() => {
              openEditMarketplaceTheme(t);
            }}
            className="p-0.5 hover:text-primary"
            title="Edit as custom theme"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              uninstallThemeMut.mutate(t.skillId);
              if (theme === themeId) setTheme('dark');
            }}
            className="p-0.5 hover:text-destructive"
            title="Uninstall"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  };

  // ── Upload handler ──

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const result = validateCustomTheme(parsed);
        if (!result.valid) {
          setUploadError(result.error);
          return;
        }
        const added = addCustomTheme(result.theme);
        refreshCustomThemes();
        setTheme(`custom:${added.id}`);
      } catch {
        setUploadError('Invalid JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Save editor theme (callback from dialog) ──

  const handleEditorSave = (exported: CustomThemeExport) => {
    const result = validateCustomTheme(exported);
    if (!result.valid) {
      setUploadError(result.error);
      return;
    }
    const added = addCustomTheme(result.theme);
    refreshCustomThemes();
    setTheme(`custom:${added.id}`);
    setEditorOpen(false);
    setEditorInit(null);
  };

  /** Open editor for a new custom theme. */
  const openCreateEditor = () => {
    setEditorInit(null);
    setEditorOpen(true);
  };

  /** Open editor pre-filled with an installed marketplace theme's CSS vars. */
  const openEditMarketplaceTheme = (t: MarketplaceThemeMeta) => {
    // Temporarily apply the theme to read its CSS vars
    const prev = theme;
    setTheme(t.themeId as ThemeId);
    // Need a micro-delay for the browser to apply the new data-theme attribute
    requestAnimationFrame(() => {
      const colors = extractThemeCssVars();
      setTheme(prev); // restore
      setEditorInit({ name: t.name, isDark: t.isDark, colors, isInstalledTheme: true });
      setEditorOpen(true);
    });
  };

  /** Open editor pre-filled with an existing custom theme's colors. */
  const openEditCustomTheme = (t: CustomTheme) => {
    setEditorInit({ name: t.name, isDark: t.isDark, colors: { ...t.colors } });
    setEditorOpen(true);
  };

  /** Open editor pre-filled with a built-in theme's CSS vars. */
  const openEditBuiltinTheme = (t: (typeof THEMES)[0]) => {
    const prev = theme;
    setTheme(t.id);
    requestAnimationFrame(() => {
      const colors = extractThemeCssVars();
      setTheme(prev);
      setEditorInit({ name: t.name, isDark: t.isDark, colors, isInstalledTheme: true });
      setEditorOpen(true);
    });
  };

  // ── Schedule handler ──

  const updateSchedule = (updates: Partial<ThemeSchedule>) => {
    const next = { ...schedule, ...updates };
    setSchedule(next);
    saveSchedule(next);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Choose a theme for the dashboard</p>
      </div>

      {/* ── Theme Scheduling ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Auto-Switch Schedule</h3>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              schedule.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
            }`}
          >
            {schedule.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <button
            role="switch"
            aria-checked={schedule.enabled}
            aria-label="Enable scheduled theme switching"
            onClick={() => {
              updateSchedule({ enabled: !schedule.enabled });
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ml-auto ${
              schedule.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                schedule.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
        </div>
        {schedule.enabled && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
            <>
              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span>Use OS light/dark schedule</span>
                <button
                  role="switch"
                  aria-checked={schedule.useOsSchedule}
                  onClick={() => {
                    updateSchedule({ useOsSchedule: !schedule.useOsSchedule });
                  }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    schedule.useOsSchedule ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      schedule.useOsSchedule ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </label>
              {!schedule.useOsSchedule && (
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <Sun className="w-3.5 h-3.5 text-warning" />
                    Light at
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={schedule.lightHour}
                      onChange={(e) => {
                        updateSchedule({ lightHour: parseInt(e.target.value) || 0 });
                      }}
                      className="w-16 px-2 py-1.5 rounded-lg border border-input bg-background text-sm text-center"
                    />
                    :00
                  </label>
                  <label className="flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5 text-info" />
                    Dark at
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={schedule.darkHour}
                      onChange={(e) => {
                        updateSchedule({ darkHour: parseInt(e.target.value) || 0 });
                      }}
                      className="w-16 px-2 py-1.5 rounded-lg border border-input bg-background text-sm text-center"
                    />
                    :00
                  </label>
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Sun className="w-4 h-4" />
                  Light theme:
                  <select
                    value={schedule.lightTheme}
                    onChange={(e) => {
                      updateSchedule({ lightTheme: e.target.value as ThemeId });
                    }}
                    className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm min-w-[160px]"
                  >
                    {THEMES.filter((t) => !t.isDark && t.id !== 'system').map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    {installedMarketplaceThemes
                      .filter((t) => !t.isDark)
                      .map((t) => (
                        <option key={t.themeId} value={t.themeId}>
                          {t.name}
                        </option>
                      ))}
                    {customThemes
                      .filter((t) => !t.isDark)
                      .map((t) => (
                        <option key={t.id} value={`custom:${t.id}`}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <Moon className="w-4 h-4" />
                  Dark theme:
                  <select
                    value={schedule.darkTheme}
                    onChange={(e) => {
                      updateSchedule({ darkTheme: e.target.value as ThemeId });
                    }}
                    className="px-3 py-1.5 rounded-lg border border-input bg-background text-sm min-w-[160px]"
                  >
                    {THEMES.filter((t) => t.isDark).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    {installedMarketplaceThemes
                      .filter((t) => t.isDark)
                      .map((t) => (
                        <option key={t.themeId} value={t.themeId}>
                          {t.name}
                        </option>
                      ))}
                    {customThemes
                      .filter((t) => t.isDark)
                      .map((t) => (
                        <option key={t.id} value={`custom:${t.id}`}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </>
          </div>
        )}
      </div>

      <Section label="System" themes={systemTheme} />
      <Section label="Dark" themes={darkThemes} />
      <Section label="Light" themes={lightThemes} />
      <Section label="Enterprise" themes={[...darkEnterprise, ...lightEnterprise]} />

      {/* ── Installed from Marketplace ── */}
      {installedMarketplaceThemes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-muted-foreground">
              Installed from Marketplace
            </h3>
            <span className="text-xs text-muted-foreground">
              ({installedMarketplaceThemes.length})
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {installedMarketplaceThemes.map((t) => (
              <MarketplaceThemeCard key={t.skillId} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* ── Custom Themes ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">Custom Themes</h3>
          <button
            onClick={openCreateEditor}
            className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            Create
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
          >
            <Upload className="w-3 h-3 inline mr-1" />
            Import
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleUpload}
          />
        </div>
        {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        {customThemes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {customThemes.map((t) => (
              <CustomThemeCard key={t.id} t={t} />
            ))}
          </div>
        )}
        {customThemes.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No custom themes yet. Create or import one.
          </p>
        )}
      </div>

      {/* ── Theme Editor Dialog ── */}
      <ThemeEditorDialog
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditorInit(null);
        }}
        onSave={handleEditorSave}
        initial={editorInit}
      />
    </div>
  );
}

// ── Backup Tab ────────────────────────────────────────────────────

const STATUS_BADGE: Record<BackupRecord['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/10 text-blue-500',
  completed: 'bg-success/10 text-success',
  failed: 'bg-destructive/10 text-destructive',
};

function formatBytes(n: number | null): string {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTs(ts: number | null): string {
  if (ts === null) return '—';
  return new Date(ts).toLocaleString();
}

function BackupTab() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => fetchBackups({ limit: 50 }),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: () => createBackup(label),
    onSuccess: () => {
      setLabel('');
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBackup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const handleDownload = async (backup: BackupRecord) => {
    try {
      const blob = await downloadBackup(backup.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${backup.id}.pgdump`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // download error — silently ignore (user sees no file)
    }
  };

  const backups = data?.backups ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Backup &amp; Disaster Recovery</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Create and manage database backups using pg_dump
        </p>
      </div>

      {/* Create backup */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">New Backup</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
            }}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => {
              createMutation.mutate();
            }}
            disabled={createMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {createMutation.isPending ? 'Creating…' : 'Create Backup'}
          </button>
        </div>
        {createMutation.isError && (
          <p className="text-sm text-destructive">Failed to create backup</p>
        )}
      </div>

      {/* Backup list */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium">Backups</h3>
          <button
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['backups'] })}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">Loading…</div>
        ) : backups.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground text-center">
            No backups yet. Create one above.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {backups.map((backup) => (
              <div key={backup.id} className="flex items-center gap-3 px-4 py-3">
                <Database className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {backup.label || `backup-${backup.id.slice(0, 8)}`}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[backup.status]}`}
                    >
                      {backup.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(backup.sizeBytes)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Created {formatTs(backup.createdAt)}
                    {backup.completedAt && ` · Completed ${formatTs(backup.completedAt)}`}
                    {backup.createdBy && ` · by ${backup.createdBy}`}
                  </div>
                  {backup.error && (
                    <p className="text-xs text-destructive mt-0.5 truncate">{backup.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {backup.status === 'completed' && (
                    <button
                      onClick={() => void handleDownload(backup)}
                      title="Download"
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      deleteMutation.mutate(backup.id);
                    }}
                    disabled={deleteMutation.isPending}
                    title="Delete"
                    className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {data && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
            {data.total} backup{data.total !== 1 ? 's' : ''} total
          </div>
        )}
      </div>
    </div>
  );
}

// ── License Card ───────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  // Pro
  advanced_brain: 'Advanced Brain & RAG',
  provider_management: 'Provider Management',
  computer_use: 'Computer Use',
  custom_integrations: 'Custom Integrations',
  prompt_engineering: 'Prompt Engineering',
  batch_inference: 'Batch Inference',
  // Enterprise
  adaptive_learning: 'Adaptive Learning',
  sso_saml: 'SSO / SAML',
  multi_tenancy: 'Multi-Tenancy',
  cicd_integration: 'CI/CD Integration',
  advanced_observability: 'Observability',
  a2a_federation: 'A2A Federation',
  swarm_orchestration: 'Swarm Orchestration',
  confidential_computing: 'Confidential Computing',
  audit_export: 'Audit Export',
  dlp_security: 'Data Loss Prevention',
  compliance_governance: 'Compliance & Governance',
  supply_chain: 'Supply Chain Security',
  ifran: 'Ifran LLM Controller',
  break_glass: 'Break Glass Recovery',
  simulation: 'Simulation Engine',
  edge_fleet: 'Edge Fleet',
};

function getDaysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  return Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
}

function LicenseCard() {
  const { license, isLoading, isEnterprise, hasFeature, refresh } = useLicense();
  const lemonCheckout = useLemonCheckout();
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);

  const setKeyMutation = useMutation({
    mutationFn: (key: string) => setLicenseKey(key),
    onSuccess: () => {
      setKeyInput('');
      setShowInput(false);
      void refresh();
    },
  });

  const daysUntilExpiry = getDaysUntilExpiry(license?.expiresAt ?? null);
  const showExpiryBanner = isEnterprise && daysUntilExpiry !== null && daysUntilExpiry <= 30;

  return (
    <div className="card">
      <div className="p-4 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BadgeCheck
            className={`w-5 h-5 ${isEnterprise ? 'text-primary' : 'text-muted-foreground'}`}
          />
          <h3 className="font-medium">License</h3>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${isEnterprise ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
          >
            {isLoading
              ? '…'
              : isEnterprise
                ? license?.tier === 'enterprise'
                  ? 'Enterprise'
                  : 'Pro'
                : 'Community'}
          </span>
        </div>
        <button
          onClick={() => {
            setShowInput((v) => !v);
          }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {showInput ? 'Cancel' : 'Set license key'}
        </button>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {/* Expiry countdown banner */}
            {showExpiryBanner && (
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium ${
                  daysUntilExpiry <= 7
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/10 text-warning'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {daysUntilExpiry <= 0
                  ? 'License has expired. Enterprise features are disabled.'
                  : `License expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}. Contact your administrator to renew.`}
              </div>
            )}

            {/* Grace period banner */}
            {license?.gracePeriod?.active && !license.valid && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-primary/10 text-primary">
                <BadgeCheck className="w-4 h-4 shrink-0" />
                Trial period: {license.gracePeriod.daysRemaining} day
                {license.gracePeriod.daysRemaining === 1 ? '' : 's'} remaining. All features are
                unlocked.
              </div>
            )}
            {license?.gracePeriod && !license.gracePeriod.active && !license.valid && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-destructive/10 text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Trial period expired. Apply a license key to unlock Pro/Enterprise features.
              </div>
            )}

            {isEnterprise && license && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Organization</p>
                  <p className="font-medium">{license.organization ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Seats</p>
                  <p className="font-medium">{license.seats ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Expires</p>
                  <p className="font-medium">
                    {license.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : 'Never'}
                  </p>
                </div>
              </div>
            )}

            {/* Feature chips — green for available, grey/locked for missing */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ALL_LICENSED_FEATURES.map((f) => {
                const available = hasFeature(f);
                return (
                  <span
                    key={f}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      available ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {available ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {FEATURE_LABELS[f] ?? f}
                  </span>
                );
              })}
            </div>

            {!isEnterprise && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Running on the community tier.{' '}
                  {lemonCheckout.isConfigured
                    ? 'Purchase a license or enter a key to unlock features.'
                    : 'Enter a license key to unlock licensed features.'}
                </p>
                {lemonCheckout.isConfigured && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        lemonCheckout.openCheckout('pro');
                      }}
                      disabled={lemonCheckout.isLoading}
                      className="rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      {lemonCheckout.isLoading ? 'Processing…' : 'Upgrade to Pro — $20/yr'}
                    </button>
                    <button
                      onClick={() => {
                        lemonCheckout.openCheckout('solopreneur');
                      }}
                      disabled={lemonCheckout.isLoading}
                      className="rounded-md bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      Solopreneur — $100/yr
                    </button>
                    <button
                      onClick={() => {
                        lemonCheckout.openCheckout('enterprise');
                      }}
                      disabled={lemonCheckout.isLoading}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Enterprise — $1,000/yr
                    </button>
                  </div>
                )}
                {lemonCheckout.error && (
                  <p className="text-xs text-destructive">{lemonCheckout.error}</p>
                )}
              </div>
            )}

            {license?.error && (
              <p className="text-xs text-destructive">Key error: {license.error}</p>
            )}
          </>
        )}

        {showInput && (
          <div className="flex gap-2 pt-1">
            <input
              type="password"
              placeholder="Paste license key…"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
              }}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => {
                setKeyMutation.mutate(keyInput);
              }}
              disabled={!keyInput.trim() || setKeyMutation.isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {setKeyMutation.isPending ? 'Saving…' : 'Apply'}
            </button>
          </div>
        )}
        {setKeyMutation.isError && (
          <p className="text-xs text-destructive">
            {setKeyMutation.error instanceof Error
              ? setKeyMutation.error.message
              : 'Failed to set key'}
          </p>
        )}
      </div>
    </div>
  );
}

function GeneralTab() {
  return (
    <div className="space-y-6">
      <LicenseCard />
      <KeyRotationCard />
      <AuditChainTab />
      <RateLimitingTab />
      <LogRetentionSettings />
      <div className="card p-4">
        <GpuStatusPanel />
      </div>
    </div>
  );
}
