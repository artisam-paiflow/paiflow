"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

/**
 * No-account entry point. Mints a disposable sandbox user via
 * `/api/auth/sandbox`, then exchanges the returned single-use ticket for a
 * session through the Credentials provider — the same handshake the passkey
 * login uses.
 */
export default function SandboxEntry() {
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const res = await fetch("/api/auth/sandbox", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        data?: { ticket?: string };
        error?: { message?: string };
      } | null;
      const ticket = body?.data?.ticket;
      if (!res.ok || !ticket) {
        toast.error(body?.error?.message ?? "Could not start a sandbox session");
        setStarting(false);
        return;
      }
      const signInRes = await signIn("credentials", { passkeyTicket: ticket, redirect: false });
      if (signInRes?.error) {
        toast.error("Could not start a sandbox session");
        setStarting(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      toast.error("Could not start a sandbox session");
      setStarting(false);
    }
  }

  return (
    <section className="glass-panel mt-md border-tertiary/20 bg-tertiary/5 p-md rounded-xl">
      <div className="text-label-sm text-tertiary flex items-center gap-2 font-mono">
        <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
          science
        </span>
        TRY THE SANDBOX · TESTNET
      </div>
      <p className="text-body-md text-on-surface-variant mt-3">
        No account needed. Build and deploy a simple swap flow on Stellar testnet with your own
        wallet. Sandbox sessions are temporary and limited to the builder.
      </p>
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="border-tertiary/40 text-label-md text-tertiary hover:bg-tertiary/10 mt-md inline-flex w-full items-center justify-center gap-2 rounded-lg border px-5 py-2.5 font-mono font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {starting ? "STARTING SANDBOX…" : "TRY THE SANDBOX"}
        {!starting ? (
          <span aria-hidden="true" className="material-symbols-outlined text-[16px]">
            arrow_forward
          </span>
        ) : null}
      </button>
    </section>
  );
}
