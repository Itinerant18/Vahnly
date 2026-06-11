import type { Config } from "tailwindcss";

// Tailwind v4 is configured CSS-first (see app/globals.css @theme). This file is
// kept minimal for tooling that expects a config path.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
};

export default config;
