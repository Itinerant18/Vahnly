/**
 * useThemeStore — Design system dark mode store (Driver App)
 *
 * Theme is persisted in Capacitor Preferences so it survives app restarts
 * on both iOS and Android. Falls back to the user's OS preference when
 * no explicit preference has been saved.
 *
 * Usage:
 *   const { theme, setTheme } = useThemeStore();
 *   <button onClick={() => setTheme("dark")}>Dark</button>
 *
 * Dark mode is applied by setting [data-theme="dark"] on <html>.
 * Light mode removes that attribute.
 * System mode tracks window.matchMedia("(prefers-color-scheme: dark)").
 */

import { create } from 'zustand';
import { Preferences } from '@capacitor/preferences';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const PREFS_KEY = 'dfu-theme';

// ── DOM helpers ─────────────────────────────────────────────────────────────

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
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return getSystemResolved();
  return theme;
}

// ── Store ────────────────────────────────────────────────────────────────────

interface ThemeState {
  /** The user's explicit preference (may be "system") */
  theme: Theme;
  /** What's actually applied to the DOM right now */
  resolvedTheme: ResolvedTheme;

  /** Persist + apply a new theme preference */
  setTheme: (theme: Theme) => Promise<void>;

  /**
   * Read persisted preference from Capacitor Preferences and apply it.
   * Call this once in layout.tsx useEffect on mount.
   */
  initTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  // Track the system-media-query listener so we can remove it when switching
  // away from "system" mode.
  let systemMediaListener: (() => void) | null = null;

  function removeSystemListener() {
    if (systemMediaListener) {
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

    setTheme: async (theme: Theme) => {
      removeSystemListener();

      const resolved = resolveTheme(theme);
      applyResolved(resolved);
      set({ theme, resolvedTheme: resolved });

      // Persist to Capacitor Preferences
      await Preferences.set({ key: PREFS_KEY, value: theme });

      // Re-attach listener when switching to "system"
      if (theme === 'system') attachSystemListener();
    },

    initTheme: async () => {
      // 1. Read persisted preference
      const { value } = await Preferences.get({ key: PREFS_KEY });
      const saved = (value as Theme | null) ?? 'system';

      // 2. Resolve and apply
      const resolved = resolveTheme(saved);
      applyResolved(resolved);
      set({ theme: saved, resolvedTheme: resolved });

      // 3. Attach system listener if needed
      if (saved === 'system') attachSystemListener();
    },
  };
});
