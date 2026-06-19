'use client';

/**
 * ThemeProvider — Client component that initialises the theme store on mount.
 * Rider app version — reads localStorage and applies [data-theme] to <html>.
 */

import { useEffect } from 'react';
import { MotionConfig } from 'framer-motion';
import { useThemeStore } from '@/lib/store/themeStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { initTheme } = useThemeStore();

  useEffect(() => {
    initTheme();
    // initTheme is stable (Zustand action reference never changes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reducedMotion="user" makes every Framer Motion animation honour the OS
  // prefers-reduced-motion setting (CSS handles the rest via globals.css).
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
