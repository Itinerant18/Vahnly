// Deprecated: Minimalist UI Theme uses single mode
export const themeStore = {
  initTheme: () => {},
  setTheme: () => {},
  theme: 'light',
  resolvedTheme: 'light',
};

export function useThemeStore() {
  return {
    theme: 'light',
    resolvedTheme: 'light',
    setTheme: () => {},
  };
}
