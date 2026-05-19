"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

export default function PasskeyLogin({ from }: { from?: string }) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const opts = await fetch("/api/auth/passkey/login/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }).then((r) => r.json());
      if (!opts?.data) throw new Error("Failed to get options");
      const assertion = await startAuthentication({ optionsJSON: opts.data });
      const verify = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...assertion, _scope: opts.data._scope }),
      }).then((r) => r.json());
      if (!verify?.data?.ticket) throw new Error(verify?.error?.message ?? "Verify failed");
      const res = await signIn("credentials", {
        passkeyTicket: verify.data.ticket,
        redirect: false,
      });
      if (res?.error) throw new Error("Login failed");
      window.location.href = from && from.startsWith("/") ? from : "/dashboard";
    } catch (err) {
      toast.error((err as Error).message ?? "Passkey sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="border-secondary/60 px-md py-sm text-label-md text-secondary hover:border-secondary hover:bg-secondary/10 inline-flex items-center justify-center gap-2 rounded-lg border bg-transparent font-mono transition-all duration-200 hover:shadow-[0_0_16px_rgba(152,203,255,0.35)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="material-symbols-outlined text-[16px]">key</span>
      {busy ? "TALKING TO YOUR DEVICE…" : "SIGN IN WITH PASSKEY"}
    </button>
  );
}
