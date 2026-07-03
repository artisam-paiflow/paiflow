import type { Metadata } from "next";
import { Toaster } from "sonner";
import { Space_Grotesk, Geist, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Fonts are self-hosted at build time via `next/font/google` (per PR #51
 * review). This eliminates a render-blocking external stylesheet, the
 * GDPR concern with sending visitor IPs to Google's CDN, and the
 * `fonts.googleapis.com` / `fonts.gstatic.com` entries we previously had
 * to add to CSP.
 *
 * Each font exposes a CSS variable consumed by `globals.css` (--font-display,
 * --font-body, --font-mono, --font-symbols). Tailwind's `@theme` maps these
 * to the BRAND.md font-family aliases.
 */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist",
  display: "swap",
});

const jbm = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
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
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            className: "font-body",
          }}
        />
      </body>
    </html>
  );
}
