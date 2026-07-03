import type { Config } from "tailwindcss";

/**
 * Tailwind v4 is configured via the `@theme` block in app/globals.css per
 * BRAND.md §11 + §12. This file only keeps `content` paths and `darkMode`
 * declared so editors and the `prettier-plugin-tailwindcss` resolver find them.
 *
 * Dark-mode policy: Paiflow is dark-only by design (BRAND.md §10 lists
 * light mode as an anti-pattern). `darkMode: "class"` + an always-on
 * `<html className="dark">` in app/layout.tsx is intentional, not a stub
 * for a future light theme. Do not wire a light variant without updating
 * BRAND.md first.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
};

export default config;
