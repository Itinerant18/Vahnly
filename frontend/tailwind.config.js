/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],

  // Dark mode via [data-theme="dark"] attribute on <html>
  darkMode: ['selector', '[data-theme="dark"]'],

  theme: {
    extend: {
      // ── Font Families ─────────────────────────────────────────────────────
      // Inter: display, body, labels, addresses, phone numbers (everything)
      // JetBrains Mono: fares, ETAs, distances, IDs ONLY
      fontFamily: {
        display: ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body:    ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        sans:    ['var(--font-inter)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:    ['var(--font-jetbrains-mono)', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },

      // ── Semantic Colors (reference CSS custom properties from tokens.css) ─
      colors: {
        // Background
        background: {
          primary:   'var(--background-primary)',
          secondary: 'var(--background-secondary)',
          tertiary:  'var(--background-tertiary)',
          inverse:   'var(--background-inverse)',
        },
        // Content (text)
        content: {
          primary:   'var(--content-primary)',
          secondary: 'var(--content-secondary)',
          tertiary:  'var(--content-tertiary)',
          accent:    'var(--content-accent)',
          positive:  'var(--content-positive)',
          warning:   'var(--content-warning)',
          negative:  'var(--content-negative)',
          inverse:   'var(--content-inverse)',
        },
        // Border
        border: {
          opaque:   'var(--border-opaque)',
          selected: 'var(--border-selected)',
          accent:   'var(--border-accent)',
        },
        // Interactive
        interactive: {
          primary:      'var(--interactive-primary)',
          'primary-text': 'var(--interactive-primary-text)',
          secondary:    'var(--interactive-secondary)',
          hover:        'var(--interactive-hover)',
        },
        // Surface (badge/pill backgrounds)
        surface: {
          positive: 'var(--surface-positive)',
          warning:  'var(--surface-warning)',
          negative: 'var(--surface-negative)',
          accent:   'var(--surface-accent)',
          neutral:  'var(--surface-neutral)',
        },
        // Status
        status: {
          online:   'var(--status-online)',
          active:   'var(--status-active)',
          pending:  'var(--status-pending)',
          offline:  'var(--status-offline)',
          negative: 'var(--status-negative)',
        },
        // Primitive gray ramp
        gray: {
          0:    'var(--gray-0)',
          50:   'var(--gray-50)',
          100:  'var(--gray-100)',
          200:  'var(--gray-200)',
          300:  'var(--gray-300)',
          400:  'var(--gray-400)',
          500:  'var(--gray-500)',
          600:  'var(--gray-600)',
          700:  'var(--gray-700)',
          800:  'var(--gray-800)',
          900:  'var(--gray-900)',
          1000: 'var(--gray-1000)',
        },
        // Accent ramp
        accent: {
          50:  'var(--accent-50)',
          100: 'var(--accent-100)',
          200: 'var(--accent-200)',
          300: 'var(--accent-300)',
          400: 'var(--accent-400)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
        },
        // Positive ramp
        positive: {
          50:  'var(--positive-50)',
          100: 'var(--positive-100)',
          300: 'var(--positive-300)',
          400: 'var(--positive-400)',
          500: 'var(--positive-500)',
          600: 'var(--positive-600)',
        },
        // Warning ramp
        warning: {
          50:  'var(--warning-50)',
          100: 'var(--warning-100)',
          300: 'var(--warning-300)',
          400: 'var(--warning-400)',
          500: 'var(--warning-500)',
          600: 'var(--warning-600)',
        },
        // Negative ramp
        negative: {
          50:  'var(--negative-50)',
          100: 'var(--negative-100)',
          300: 'var(--negative-300)',
          400: 'var(--negative-400)',
          500: 'var(--negative-500)',
          600: 'var(--negative-600)',
        },
        // Legacy ink/canvas/mute/status-* aliases removed (Phase 2) — use the DS
        // semantic tokens directly (content-*, background-*, border-*, status.*, gray-*).
      },

      // ── Spacing (8px base grid, extends Tailwind defaults) ──────────────────
      spacing: {
        '300': '8px',
        '400': '12px',
        '500': '16px',
        '600': '20px',
        '700': '24px',
        '800': '32px',
        '900': '40px',
        '1000': '48px',
        '1100': '64px',
        '1200': '96px',
        'sidebar-collapsed': '64px',
        'sidebar-expanded': '280px',
      },

      // ── Border Radius ────────────────────────────────────────────────────────
      borderRadius: {
        'none': '0px',
        'sm':   '8px',    // buttons, inputs, tags
        'md':   '12px',   // cards
        'lg':   '16px',   // bottom sheets
        'pill': '999px',  // chips, avatars
        // Legacy
        'pill-tab': '36px',
        'xl': '16px',
      },

      // ── Box Shadow (elevation) ───────────────────────────────────────────────
      boxShadow: {
        'elevation-1': 'var(--elevation-1)',
        'elevation-2': 'var(--elevation-2)',
        'elevation-3': 'var(--elevation-3)',
      },

      // ── Motion ──────────────────────────────────────────────────────────────
      transitionTimingFunction: {
        'quint':     'cubic-bezier(0.83, 0, 0.17, 1)',
        'out-quint': 'cubic-bezier(0.22, 1, 0.36, 1)',
        'in-quint':  'cubic-bezier(0.64, 0, 0.78, 0)',
      },
      transitionDuration: {
        'fast':     '100ms',
        'base':     '200ms',
        'moderate': '300ms',
        'slow':     '400ms',
        'sidebar':  '250ms',
      },

      // ── Font Size (role-based scale) ────────────────────────────────────────
      fontSize: {
        'display-large':   ['36px', { lineHeight: '44px', fontWeight: '700', letterSpacing: '-0.02em' }],
        'display-medium':  ['28px', { lineHeight: '36px', fontWeight: '700', letterSpacing: '-0.01em' }],
        'display-small':   ['24px', { lineHeight: '32px', fontWeight: '700' }],
        'heading-xl':      ['22px', { lineHeight: '28px', fontWeight: '700' }],
        'heading-large':   ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'heading-medium':  ['18px', { lineHeight: '24px', fontWeight: '600' }],
        'heading-small':   ['16px', { lineHeight: '22px', fontWeight: '600' }],
        'label-large':     ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'label-medium':    ['12px', { lineHeight: '18px', fontWeight: '600' }],
        'label-small':     ['11px', { lineHeight: '16px', fontWeight: '600', letterSpacing: '0.01em' }],
        'paragraph-large': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'paragraph-medium':['14px', { lineHeight: '22px', fontWeight: '400' }],
        'paragraph-small': ['12px', { lineHeight: '18px', fontWeight: '400' }],
        'mono-large':      ['16px', { lineHeight: '24px', fontWeight: '500' }],
        'mono-medium':     ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'mono-small':      ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
    },
  },
  plugins: [],
};
