"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import Logo from "./logo";

const nav: { href: string; label: string; icon: string }[] = [
  { href: "/dashboard", label: "Flows", icon: "account_tree" },
];

export default function Topbar({ username }: { username: string }) {
  const pathname = usePathname();

  return (
    <header className="glass-panel-nav sticky top-0 z-40 h-16">
      <div className="px-margin mx-auto flex h-full w-full max-w-7xl items-center justify-between">
        <div className="gap-lg flex items-center">
          <Link href="/dashboard" className="flex items-center" aria-label="Pink Raft dashboard">
            <Logo size={22} />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-label-md inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono transition-colors ${
                    active
                      ? "bg-surface-container-high/60 text-primary"
                      : "text-on-surface-variant hover:bg-surface-container-high/40 hover:text-on-surface"
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-[16px] ${active ? "filled" : ""}`}
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/account"
            className="border-outline-variant/30 bg-surface-container-low/60 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface hidden items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors sm:inline-flex"
          >
            <span className="material-symbols-outlined text-[14px]">person</span>
            {username}
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-error/40 hover:text-error inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">logout</span>
            <span className="hidden sm:inline">SIGN OUT</span>
          </button>
        </div>
      </div>
    </header>
  );
}
