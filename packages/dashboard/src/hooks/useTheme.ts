import { useState, useEffect, useCallback, useRef } from 'react';

export type ThemeId =
  | 'system'
  // ── Dark (free) ──
  | 'dark'
  | 'tokyonight'
  | 'catppuccin'
  | 'gruvbox'
  | 'nord'
  | 'one-dark'
  | 'dracula'
  | 'solarized-dark'
  | 'rose-pine'
  | 'horizon'
  // ── Light (free) ──
  | 'light'
  | 'catppuccin-latte'
  | 'rose-pine-dawn'
  | 'everforest-light'
  | 'one-light'
  | 'ayu-light'
  | 'solarized-light'
  | 'github-light'
  | 'quiet-light'
  | 'winter-light'
  // ── Enterprise ──
  | 'monokai'
  | 'github-dark'
  | 'everforest'
  | 'ayu'
  | 'catppuccin-macchiato'
  | 'kanagawa'
  | 'matrix'
  | 'synthwave'
  | 'palenight'
  | 'nightowl'
  // ── Custom (dynamic) ──
  | `custom:${string}`;

export const DARK_THEMES = new Set<ThemeId>([
  // Built-in
  'dark',
  'nord',
  'one-dark',
  'solarized-dark',
  'horizon',
  'everforest',
  'ayu',
  'catppuccin-macchiato',
  'matrix',
  'synthwave',
  // Marketplace-installable (CSS defined but not shown in Appearance until installed)
  'tokyonight',
  'catppuccin',
  'gruvbox',
  'dracula',
  'rose-pine',
  'monokai',
  'github-dark',
  'kanagawa',
  'palenight',
  'nightowl',
]);

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  isDark: boolean;
  enterprise?: boolean;
  preview: [string, string, string]; // [bg hex, fg hex, accent hex]
}

export const THEMES: ThemeMeta[] = [
  // ── Dark (free) ──────────────────────────────────────────────
  { id: 'dark', name: 'Default Dark', isDark: true, preview: ['#0d1117', '#e6edf3', '#2f81f7'] },
  { id: 'nord', name: 'Nord', isDark: true, preview: ['#2e3440', '#eceff4', '#88c0d0'] },
  { id: 'one-dark', name: 'One Dark', isDark: true, preview: ['#282c34', '#abb2bf', '#61afef'] },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    isDark: true,
    preview: ['#002b36', '#839496', '#268bd2'],
  },
  { id: 'horizon', name: 'Horizon', isDark: true, preview: ['#1c1e26', '#d5d8da', '#e95678'] },

  // ── Light (free) ─────────────────────────────────────────────
  { id: 'light', name: 'Default Light', isDark: false, preview: ['#ffffff', '#111827', '#0ea5e9'] },
  { id: 'one-light', name: 'One Light', isDark: false, preview: ['#fafafa', '#383a42', '#4078f2'] },
  {
    id: 'github-light',
    name: 'GitHub Light',
    isDark: false,
    preview: ['#ffffff', '#24292f', '#0969da'],
  },
  {
    id: 'quiet-light',
    name: 'Quiet Light',
    isDark: false,
    preview: ['#f5f5f5', '#333333', '#4b83cd'],
  },
  {
    id: 'winter-light',
    name: 'Winter Light',
    isDark: false,
    preview: ['#f0f4fc', '#2e3440', '#5e81ac'],
  },

  // ── Enterprise ───────────────────────────────────────────────
  {
    id: 'everforest',
    name: 'Everforest Dark',
    isDark: true,
    enterprise: true,
    preview: ['#2d3b35', '#d4c6a1', '#a7c080'],
  },
  {
    id: 'ayu',
    name: 'Ayu Dark',
    isDark: true,
    enterprise: true,
    preview: ['#0b0e14', '#bfbab0', '#e6b450'],
  },
  {
    id: 'catppuccin-macchiato',
    name: 'Catppuccin Macchiato',
    isDark: true,
    enterprise: true,
    preview: ['#24273a', '#cad3f5', '#c6a0f6'],
  },
  {
    id: 'matrix',
    name: 'Matrix',
    isDark: true,
    enterprise: true,
    preview: ['#0a0a0a', '#00ff00', '#00cc00'],
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    isDark: true,
    enterprise: true,
    preview: ['#262335', '#e0d3f5', '#ff7edb'],
  },

  // ── System ───────────────────────────────────────────────────
  { id: 'system', name: 'System', isDark: false, preview: ['#888888', '#111111', '#0ea5e9'] },
];

// ── Custom Theme Types ─────────────────────────────────────────────────

/** CSS variable names used in themes (HSL values). */
export const THEME_CSS_VARS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'success',
  'warning',
  'info',
] as const;

export type ThemeCssVar = (typeof THEME_CSS_VARS)[number];

/** A custom theme definition — maps CSS var names to HSL value strings. */
export interface CustomTheme {
  id: string;
  name: string;
  isDark: boolean;
  colors: Record<ThemeCssVar, string>;
}

/** Exported JSON format for custom themes. */
export interface CustomThemeExport {
  name: string;
  isDark: boolean;
  colors: Record<ThemeCssVar, string>;
}

/** Theme scheduling configuration. */
export interface ThemeSchedule {
  enabled: boolean;
  lightTheme: ThemeId;
  darkTheme: ThemeId;
  /** Hour (0–23) to switch to light theme. */
  lightHour: number;
  /** Hour (0–23) to switch to dark theme. */
  darkHour: number;
  /** Use OS schedule (prefers-color-scheme) instead of time. */
  useOsSchedule: boolean;
}

// ── HSL validation ─────────────────────────────────────────────────────

const HSL_REGEX = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

export function isValidHsl(value: string): boolean {
  return HSL_REGEX.test(value.trim());
}

export function validateCustomTheme(
  theme: unknown
): { valid: true; theme: CustomThemeExport } | { valid: false; error: string } {
  if (!theme || typeof theme !== 'object') {
    return { valid: false, error: 'Theme must be a JSON object' };
  }
  const t = theme as Record<string, unknown>;
  if (typeof t.name !== 'string' || t.name.length === 0 || t.name.length > 64) {
    return { valid: false, error: 'Theme name must be a non-empty string (max 64 chars)' };
  }
  if (typeof t.isDark !== 'boolean') {
    return { valid: false, error: 'isDark must be a boolean' };
  }
  if (!t.colors || typeof t.colors !== 'object') {
    return { valid: false, error: 'colors must be an object' };
  }
  const colors = t.colors as Record<string, unknown>;
  for (const varName of THEME_CSS_VARS) {
    const val = colors[varName];
    if (typeof val !== 'string') {
      return { valid: false, error: `Missing or invalid color: ${varName}` };
    }
    if (!isValidHsl(val)) {
      return { valid: false, error: `Invalid HSL value for ${varName}: "${val}"` };
    }
  }
  return {
    valid: true,
    theme: {
      name: t.name,
      isDark: t.isDark,
      colors: colors as Record<ThemeCssVar, string>,
    },
  };
}

// ── Custom Theme Storage (localStorage) ────────────────────────────────

const CUSTOM_THEMES_KEY = 'custom_themes';
const THEME_SCHEDULE_KEY = 'theme_schedule';
const MAX_CUSTOM_THEMES = 20;

export function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t: unknown) =>
        t &&
        typeof t === 'object' &&
        typeof (t as CustomTheme).id === 'string' &&
        typeof (t as CustomTheme).name === 'string'
    );
  } catch {
    return [];
  }
}

export function saveCustomThemes(themes: CustomTheme[]): void {
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes.slice(0, MAX_CUSTOM_THEMES)));
}

export function addCustomTheme(exported: CustomThemeExport): CustomTheme {
  const themes = loadCustomThemes();
  const id = exported.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32);
  const theme: CustomTheme = { id, ...exported };
  // Replace if same name exists, otherwise append
  const idx = themes.findIndex((t) => t.id === id);
  if (idx >= 0) {
    themes[idx] = theme;
  } else {
    themes.push(theme);
  }
  saveCustomThemes(themes);
  return theme;
}

export function removeCustomTheme(id: string): void {
  const themes = loadCustomThemes().filter((t) => t.id !== id);
  saveCustomThemes(themes);
}

export function exportCustomTheme(theme: CustomTheme): CustomThemeExport {
  return { name: theme.name, isDark: theme.isDark, colors: theme.colors };
}

/** Extract current CSS variable values from the document root for use in the theme editor. */
export function extractThemeCssVars(): Record<ThemeCssVar, string> {
  const style = getComputedStyle(document.documentElement);
  const result: Record<string, string> = {};
  for (const v of THEME_CSS_VARS) {
    result[v] = style.getPropertyValue(`--${v}`).trim() || '0 0% 50%';
  }
  return result;
}

// ── CSS Injection for Custom Themes ────────────────────────────────────

function injectCustomThemeCss(theme: CustomTheme): void {
  const styleId = `custom-theme-${theme.id}`;
  let el = document.getElementById(styleId);
  if (!el) {
    el = document.createElement('style');
    el.id = styleId;
    document.head.appendChild(el);
  }
  const vars = Object.entries(theme.colors)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');
  el.textContent = `html[data-theme="custom:${theme.id}"] {\n${vars}\n}`;
}

function injectAllCustomThemeCss(): void {
  for (const t of loadCustomThemes()) {
    injectCustomThemeCss(t);
  }
}

// ── Theme Scheduling ───────────────────────────────────────────────────

export const DEFAULT_SCHEDULE: ThemeSchedule = {
  enabled: false,
  lightTheme: 'light',
  darkTheme: 'dark',
  lightHour: 7,
  darkHour: 19,
  useOsSchedule: false,
};

export function loadSchedule(): ThemeSchedule {
  try {
    const raw = localStorage.getItem(THEME_SCHEDULE_KEY);
    if (!raw) return DEFAULT_SCHEDULE;
    return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SCHEDULE;
  }
}

export function saveSchedule(schedule: ThemeSchedule): void {
  localStorage.setItem(THEME_SCHEDULE_KEY, JSON.stringify(schedule));
}

/** Determine which theme to use based on schedule. Returns null if schedule is disabled. */
export function getScheduledTheme(schedule: ThemeSchedule, now?: Date): ThemeId | null {
  if (!schedule.enabled) return null;
  if (schedule.useOsSchedule) {
    if (typeof window === 'undefined') return null;
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? schedule.darkTheme
      : schedule.lightTheme;
  }
  const hour = (now ?? new Date()).getHours();
  // If lightHour < darkHour: light during [lightHour, darkHour), dark otherwise
  // If lightHour >= darkHour: dark during [darkHour, lightHour), light otherwise
  if (schedule.lightHour < schedule.darkHour) {
    return hour >= schedule.lightHour && hour < schedule.darkHour
      ? schedule.lightTheme
      : schedule.darkTheme;
  }
  return hour >= schedule.darkHour && hour < schedule.lightHour
    ? schedule.darkTheme
    : schedule.lightTheme;
}

// ── Apply Theme ────────────────────────────────────────────────────────

export function applyTheme(theme: ThemeId) {
  // Inject custom theme CSS if needed
  if (theme.startsWith('custom:')) {
    injectAllCustomThemeCss();
  }

  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  // Determine if dark: check built-in set, or custom theme's isDark flag
  let dark: boolean;
  if (resolved.startsWith('custom:')) {
    const customId = resolved.slice('custom:'.length);
    const custom = loadCustomThemes().find((t) => t.id === customId);
    dark = custom?.isDark ?? false;
  } else {
    dark = DARK_THEMES.has(resolved);
  }

  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.setAttribute('data-theme', resolved);
}

let globalTheme: ThemeId =
  ((typeof window !== 'undefined' ? localStorage.getItem('theme') : null) as ThemeId) || 'dark';
let listeners: ((theme: ThemeId) => void)[] = [];

function notifyListeners() {
  listeners.forEach((fn) => {
    fn(globalTheme);
  });
}

export function useTheme() {
  const [theme, _setTheme] = useState<ThemeId>(globalTheme);
  const scheduleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    listeners.push(_setTheme);
    return () => {
      listeners = listeners.filter((fn) => fn !== _setTheme);
    };
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem('theme', theme);
    globalTheme = theme;
    notifyListeners();
  }, [theme]);

  // Theme scheduling: check every 60s if schedule wants a different theme
  useEffect(() => {
    const check = () => {
      const schedule = loadSchedule();
      const scheduled = getScheduledTheme(schedule);
      if (scheduled && scheduled !== globalTheme) {
        _setTheme(scheduled);
      }
    };
    check();
    scheduleRef.current = setInterval(check, 60_000);
    return () => {
      if (scheduleRef.current) clearInterval(scheduleRef.current);
    };
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    _setTheme(t);
  }, []);

  const toggle = useCallback(() => {
    _setTheme((t) => (DARK_THEMES.has(t) ? 'light' : 'dark'));
  }, []);

  const isDark =
    theme === 'system'
      ? typeof window !== 'undefined'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : false
      : theme.startsWith('custom:')
        ? (loadCustomThemes().find((t) => t.id === theme.slice('custom:'.length))?.isDark ?? false)
        : DARK_THEMES.has(theme);

  return { theme, isDark, setTheme, toggle };
}
