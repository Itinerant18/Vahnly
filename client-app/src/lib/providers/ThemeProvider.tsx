'use client';

/**
 * ThemeProvider — Client component that initialises the theme store on mount.
 *
 * This must be a Client Component because it calls useEffect and accesses
 * Capacitor Preferences (native API unavailable during SSR).
 *
 * It renders no markup — it purely handles the side effect of reading the
 * persisted theme and applying [data-theme="dark"] to <html>.
 */

import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { useThemeStore } from '@/store/useThemeStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reducedMotion="user" makes every Framer Motion animation honour the OS
  // prefers-reduced-motion setting (CSS handles the rest via globals.css).
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
