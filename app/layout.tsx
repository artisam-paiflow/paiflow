import type { Metadata } from "next";
import { Toaster } from "sonner";
import localFont from "next/font/local";
import "./globals.css";
import { SessionProvider } from "@/components/app/session-provider";
import { AnalyticsProvider } from "@/components/app/analytics-provider";

/**
 * Fonts are bundled in app/fonts and self-hosted via `next/font/local`.
 * Builds and browsers do not need to fetch fonts from Google's CDN.
 * The text fonts are the same Latin variable files used by the homepage.
 *
 * Each font exposes a CSS variable consumed by `globals.css` (--font-display,
 * --font-body, --font-mono, --font-symbols). Tailwind's `@theme` maps these
 * to the BRAND.md font-family aliases.
 */
const grotesk = localFont({
  src: "./fonts/space-grotesk-latin.woff2",
  weight: "300 700",
  variable: "--font-grotesk",
  display: "swap",
});

const geist = localFont({
  src: "./fonts/geist-latin.woff2",
  weight: "100 900",
  variable: "--font-geist",
  display: "swap",
});

const jbm = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  weight: "400 800",
  variable: "--font-jbm",
  display: "swap",
});

// Material Symbols is not in next/font/google's static font list — self-host
// via next/font/local with the variable woff2 from Google Fonts. Single
// FILL axis (0..1) keeps the file ~444 KB instead of 3.8 MB for all axes;
// FILL is the only axis we actually toggle. `display: 'block'` hides
// glyphs until the font loads so users never see ligature names as text.
const symbols = localFont({
  src: "./fonts/material-symbols-outlined.woff2",
  weight: "400",
  variable: "--font-symbols",
  display: "block",
});

export const metadata: Metadata = {
  title: "Paiflow — Zaps for Payments on Stellar",
  description:
    "Drag, drop, deploy. Paiflow turns triggers and actions into real Soroban contracts on Stellar in under a minute.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${geist.variable} ${jbm.variable} ${symbols.variable} dark`}
    >
      <body className="bg-surface-container-lowest text-on-surface min-h-screen antialiased">
        <SessionProvider>
          <AnalyticsProvider />
          {children}
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              className: "font-body",
            }}
          />
        </SessionProvider>
      </body>
    </html>
  );
}
