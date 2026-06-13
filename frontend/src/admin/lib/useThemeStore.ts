/**
 * useThemeStore — Design system dark mode store (Admin Dashboard)
 *
 * Uses localStorage (not Capacitor Preferences) since the admin dashboard
 * runs in a browser, not a native Capacitor shell.
 *
 * Applies [data-theme="dark"] to <html> for CSS custom property switching.
 *
 * Usage:
 *   const { theme, setTheme, resolvedTheme } = useThemeStore();
 */

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const LS_KEY = 'dfu-admin-theme';

// ── DOM helpers ─────────────────────────────────────────────────────────────

function applyResolved(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

function getSystemResolved(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemResolved() : theme;
}

// ── Minimal store (no zustand dependency needed in admin) ────────────────────

type Listener = () => void;

class ThemeStore {
  private _theme: Theme;
  private _resolvedTheme: ResolvedTheme;
  private _listeners = new Set<Listener>();
  private _systemMQ: MediaQueryList | null = null;
  private _systemHandler: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    const saved = localStorage.getItem(LS_KEY) as Theme | null;
    this._theme = saved ?? 'system';
    this._resolvedTheme = resolveTheme(this._theme);
    applyResolved(this._resolvedTheme);
    if (this._theme === 'system') this._attachSystemListener();
  }

  get theme() { return this._theme; }
  get resolvedTheme() { return this._resolvedTheme; }

  setTheme(theme: Theme) {
    this._removeSystemListener();
    this._theme = theme;
    this._resolvedTheme = resolveTheme(theme);
    applyResolved(this._resolvedTheme);
    localStorage.setItem(LS_KEY, theme);
    if (theme === 'system') this._attachSystemListener();
    this._notify();
  }

  /** Call once on app mount to apply persisted preference */
  initTheme() {
    applyResolved(this._resolvedTheme);
  }

  subscribe(listener: Listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify() {
    this._listeners.forEach((l) => l());
  }

  private _attachSystemListener() {
    this._systemMQ = window.matchMedia('(prefers-color-scheme: dark)');
    this._systemHandler = (e) => {
      this._resolvedTheme = e.matches ? 'dark' : 'light';
      applyResolved(this._resolvedTheme);
      this._notify();
    };
    this._systemMQ.addEventListener('change', this._systemHandler);
  }

  private _removeSystemListener() {
    if (this._systemMQ && this._systemHandler) {
      this._systemMQ.removeEventListener('change', this._systemHandler);
      this._systemMQ = null;
      this._systemHandler = null;
    }
  }
}

// Singleton — one store, shared across the app
export const themeStore = new ThemeStore();

// React hook
import { useSyncExternalStore } from 'react';

export function useThemeStore() {
  const theme = useSyncExternalStore(
    themeStore.subscribe.bind(themeStore),
    () => themeStore.theme,
  );
  const resolvedTheme = useSyncExternalStore(
    themeStore.subscribe.bind(themeStore),
    () => themeStore.resolvedTheme,
  );
  return {
    theme,
    resolvedTheme,
    setTheme: (t: Theme) => themeStore.setTheme(t),
  };
}
