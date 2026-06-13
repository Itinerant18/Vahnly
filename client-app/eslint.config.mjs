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

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  dsGuard,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
