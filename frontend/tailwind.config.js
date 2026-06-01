/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#000000',
        'on-primary': '#ffffff',
        ink: '#000000',
        body: '#5e5e5e',
        mute: '#afafaf',
        'hairline-mid': '#4b4b4b',
        canvas: '#ffffff',
        'canvas-soft': '#efefef',
        'canvas-softer': '#f3f3f3',
        'surface-pressed': '#e2e2e2',
        link: '#0000ee',
        'on-dark': '#ffffff',
        'black-elevated': '#282828',
        // Operational semantic accents — used only for status dots/badges, never as brand accent
        'status-online': '#138000',
        'status-warn': '#a06000',
        'status-alert': '#b00020',
      },
      borderRadius: {
        'pill': '999px',
        'pill-tab': '36px',
        'xl': '16px',
      },
      fontFamily: {
        sans: ['Geist Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'Fira Code', 'monospace'],
      }
    },
  },
  plugins: [],
};
