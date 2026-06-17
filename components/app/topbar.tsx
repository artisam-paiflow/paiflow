"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import Logo from "./logo";

const nav: { href: string; label: string; icon: string }[] = [
  { href: "/dashboard", label: "Flows", icon: "account_tree" },
];

const accountItems: { href: string; label: string; icon: string }[] = [
  { href: "/account", label: "Profile", icon: "person" },
  { href: "/account/address-book", label: "Address Book", icon: "contacts" },
];

export default function Topbar({ username }: { username: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

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
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-haspopup="true"
              className="border-outline-variant/30 bg-surface-container-low/60 text-label-sm text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">person</span>
              <span className="hidden sm:inline">{username}</span>
              <span className="material-symbols-outlined text-[14px]">
                {open ? "expand_less" : "expand_more"}
              </span>
            </button>

            {open && (
              <div className="glass-panel absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border p-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]">
                {accountItems.map((item) => {
                  const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={`text-label-sm inline-flex items-center gap-2 rounded-lg px-3 py-2 font-mono transition-colors ${
                        active
                          ? "bg-surface-container-high/60 text-primary"
                          : "text-on-surface hover:bg-surface-container-high/40"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
                      {item.label}
                    </Link>
                  );
                })}
                <div className="border-outline-variant/20 my-1 border-t" />
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-label-sm text-error hover:bg-error-container/30 inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 font-mono transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">logout</span>
                  SIGN OUT
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
