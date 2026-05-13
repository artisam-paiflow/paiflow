"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function Topbar({ username }: { username: string }) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="text-brand-300 font-bold">
          Pink Raft
        </Link>
        <nav className="flex gap-4 text-sm text-zinc-300">
          <Link href="/dashboard" className="hover:text-white">
            Flows
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-400">{username}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded border border-zinc-700 px-3 py-1 hover:bg-zinc-900"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
