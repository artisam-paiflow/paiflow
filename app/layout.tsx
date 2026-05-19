import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pink Raft — Zaps for money on Stellar",
  description:
    "Drag, drop, deploy. Pink Raft turns triggers and actions into real Soroban contracts on Stellar in under a minute.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
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
