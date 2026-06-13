/**
 * useChartColors — reads CSS custom properties at runtime.
 * Works correctly in both light and dark mode because it reads
 * the computed value AFTER [data-theme] has been applied to <html>.
 *
 * Usage:
 *   const colors = useChartColors();
 *   <path stroke={colors.primary} />
 */
'use client';
import { useMemo } from 'react';

function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export function useChartColors() {
  // Re-compute on every render — cheap getComputedStyle call.
  // Wrap in useMemo with no deps so it only runs once per mount
  // (theme changes cause re-render via ThemeProvider).
  return useMemo(() => ({
    primary:     getCSSVar('--content-primary'),
    secondary:   getCSSVar('--content-secondary'),
    tertiary:    getCSSVar('--content-tertiary'),
    borderColor: getCSSVar('--border-opaque'),
    positive:    getCSSVar('--positive-400'),
    warning:     getCSSVar('--warning-400'),
    negative:    getCSSVar('--negative-400'),
    accent:      getCSSVar('--accent-400'),
    bgPrimary:   getCSSVar('--background-primary'),
    bgSecondary: getCSSVar('--background-secondary'),
  }), []);
}
