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
      onClick={onClick}
      disabled={busy}
      className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-900 disabled:opacity-60"
    >
      {busy ? "Talking to your device…" : "Sign in with passkey"}
    </button>
  );
}
