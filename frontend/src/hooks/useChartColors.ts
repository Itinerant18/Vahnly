import { useMemo } from 'react';

function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function useChartColors() {
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
