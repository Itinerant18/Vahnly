'use client';

/**
 * ThemeProvider — Client component that initialises the theme store on mount.
 * Rider app version — reads localStorage and applies [data-theme] to <html>.
 */

import { MotionConfig } from 'framer-motion';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // reducedMotion="user" makes every Framer Motion animation honour the OS
  // prefers-reduced-motion setting (CSS handles the rest via globals.css).
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
