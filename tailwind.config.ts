import type { Config } from "tailwindcss";

/**
 * Tailwind v4 is configured via the `@theme` block in app/globals.css per
 * BRAND.md §11 + §12. This file only keeps `content` paths and `darkMode`
 * declared so editors and the `prettier-plugin-tailwindcss` resolver find them.
 */
const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
};

export default config;
