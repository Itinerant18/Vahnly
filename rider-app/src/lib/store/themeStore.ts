/**
 * themeStore — Design system dark mode store (Rider App)
 *
 * Persists to localStorage. When @capacitor/preferences is added to
 * rider-app's dependencies, upgrade persistTheme/loadTheme to use it.
 *
 * Applies [data-theme="dark"] to <html> for CSS custom property switching.
 */

import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'dfu-rider-theme';

// ── Storage helpers ──────────────────────────────────────────────────────────

function persistTheme(value: Theme) {
  try { localStorage.setItem(STORAGE_KEY, value); } catch { /* ignore */ }
}

function loadTheme(): Theme {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';
  } catch {
    return 'system';
  }
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function applyResolved(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
}

function getSystemResolved(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? getSystemResolved() : theme;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  /** Persist + apply a new theme preference */
  setTheme: (theme: Theme) => void;
  /** Read persisted preference and apply it. Call once in ThemeProvider mount. */
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  let systemMediaListener: (() => void) | null = null;

  function removeSystemListener() {
    if (systemMediaListener && typeof window !== 'undefined') {
      window
        .matchMedia('(prefers-color-scheme: dark)')
        .removeEventListener('change', systemMediaListener);
      systemMediaListener = null;
    }
  }

  function attachSystemListener() {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    systemMediaListener = () => {
      const resolved = mq.matches ? 'dark' : 'light';
      applyResolved(resolved);
      set({ resolvedTheme: resolved });
    };
    mq.addEventListener('change', systemMediaListener);
  }

  return {
    theme: 'system',
    resolvedTheme: 'light',

    setTheme: (theme: Theme) => {
      removeSystemListener();
      const resolved = resolveTheme(theme);
      applyResolved(resolved);
      persistTheme(theme);
      set({ theme, resolvedTheme: resolved });
      if (theme === 'system') attachSystemListener();
    },

    initTheme: () => {
      const saved = loadTheme();
      const resolved = resolveTheme(saved);
      applyResolved(resolved);
      set({ theme: saved, resolvedTheme: resolved });
      if (saved === 'system') attachSystemListener();
    },
  };
});
