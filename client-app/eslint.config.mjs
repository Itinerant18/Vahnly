import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Design-system guard: block raw Tailwind palette utilities (bg-zinc-*, text-emerald-*, …)
// and arbitrary hex classes (bg-[#..]). Use semantic token classes / var(--token).
// `gray` is intentionally NOT listed — the design system's gray-* primitive ramp is valid.
const PALETTE = "(bg|text|border|ring|divide|from|to|via|fill|stroke)-(zinc|slate|neutral|stone|emerald|green|red|rose|blue|sky|indigo|amber|yellow|orange|teal|cyan)-";
const dsGuard = {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: `Literal[value=/${PALETTE}/]`, message: "Design system: use a semantic token class (bg-background-secondary, text-content-positive, bg-negative-400) — not a raw Tailwind palette color. See src/styles/tokens.css." },
      { selector: `TemplateElement[value.raw=/${PALETTE}/]`, message: "Design system: use a semantic token class, not a raw Tailwind palette color. See src/styles/tokens.css." },
      { selector: "Literal[value=/\\[#/]", message: "Design system: use a token class, not an arbitrary hex like bg-[#FF6B35]. See src/styles/tokens.css." },
      { selector: "TemplateElement[value.raw=/\\[#/]", message: "Design system: use a token class, not an arbitrary hex (bg-[#...]) in a template literal." },
    ],
  },
};

// eslint-config-next@16 ships React-Compiler-era react-hooks rules at `error`;
// they fire on working code. Keep them as warnings (CI runs plain `eslint`, which
// exits 0 on warnings). rules-of-hooks stays an error.
const hooksNoise = {
  rules: {
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/refs": "warn",
    "react-hooks/purity": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "react/no-unescaped-entities": "warn",
    // Pervasive pragmatic `any` (API casts, Haptics). tsc --noEmit is the real type gate.
    "@typescript-eslint/no-explicit-any": "warn",
  },
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  dsGuard,
  hooksNoise,
  // android/ios hold Capacitor-synced build output (minified _next chunks) — never lint them.
  // DevLocationSpoof is a dev-only widget (tree-shaken from prod) that intentionally uses a
  // debug-yellow palette + a module-level mock hook; exempt it from the design-system guard.
  globalIgnores([
    ".next/**", "out/**", "build/**", "next-env.d.ts", "android/**", "ios/**",
    "src/components/DevLocationSpoof.tsx",
  ]),
]);
