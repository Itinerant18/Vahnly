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
      // eslint-config-next@16 ships React-Compiler-era react-hooks rules at
      // `error`; they fire on working code (e.g. fetch().then(setState)). Keep them
      // visible as warnings so they don't fail CI. rules-of-hooks stays an error.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
];
