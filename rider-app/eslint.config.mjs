// Flat config (ESLint 9). eslint-config-next flat array imported directly (FlatCompat
// crashes on ESLint 9). Design-system guard blocks arbitrary hex color classes (bg-[#..]).
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...nextCoreWebVitals,
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'Literal[value=/\\[#/]', message: 'Design system: use a token class (bg-background-primary, text-content-secondary, bg-accent-400) — not arbitrary hex like bg-[#FF6B35]. See src/styles/tokens.css.' },
        { selector: 'TemplateElement[value.raw=/\\[#/]', message: 'Design system: use a token class, not arbitrary hex (bg-[#...]) in a template literal. See src/styles/tokens.css.' },
      ],
    },
  },
];
