/**
 * Notification Settings
 *
 * User-configurable notification preferences stored in localStorage.
 */

import { useState, useEffect } from 'react';
import { Bell, Volume2, VolumeX } from 'lucide-react';

const STORAGE_KEY = 'friday_notification_prefs';

interface NotificationPrefs {
  enabled: boolean;
  sound: boolean;
  eventTypes: string[];
}

const EVENT_TYPE_OPTIONS = [
  { value: 'security', label: 'Security events' },
  { value: 'task_completed', label: 'Task completions' },
  { value: 'task_failed', label: 'Task failures' },
  { value: 'rate_limit', label: 'Rate limit hits' },
  { value: 'auth_failure', label: 'Authentication failures' },
];

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  sound: false,
  eventTypes: ['security', 'task_completed', 'task_failed'],
};

function loadPrefs(): NotificationPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(loadPrefs);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const toggleEventType = (type: string) => {
    setPrefs((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(type)
        ? prev.eventTypes.filter((t) => t !== type)
        : [...prev.eventTypes, type],
    }));
  };

  return (
    <div className="card p-4 space-y-4">
      <h3 className="font-medium text-sm flex items-center gap-2">
        <Bell className="w-4 h-4" />
        Notification Preferences
      </h3>

      {/* Enable/Disable */}
      <div className="flex items-center justify-between">
        <span className="text-sm">Enable notifications</span>
        <button
          onClick={() => setPrefs((p) => ({ ...p, enabled: !p.enabled }))}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            prefs.enabled ? 'bg-primary' : 'bg-muted'
          }`}
          role="switch"
          aria-checked={prefs.enabled}
          aria-label="Toggle notifications"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              prefs.enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Sound */}
      <div className="flex items-center justify-between">
        <span className="text-sm flex items-center gap-2">
          {prefs.sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          Notification sound
        </span>
        <button
          onClick={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
          className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
            prefs.sound ? 'bg-primary' : 'bg-muted'
          }`}
          role="switch"
          aria-checked={prefs.sound}
          aria-label="Toggle notification sound"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
              prefs.sound ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Event Types */}
      <div>
        <p className="text-sm text-muted-foreground mb-2">Notify me about:</p>
        <div className="space-y-2">
          {EVENT_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={prefs.eventTypes.includes(opt.value)}
                onChange={() => toggleEventType(opt.value)}
                className="rounded border-border"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
