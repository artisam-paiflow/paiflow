"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { googleStartUrl } from "@/lib/auth/google-navigation";
import { safeReturnPath } from "@/lib/safe-return-path";

export default function GoogleButton({
  from,
  link = false,
  authOrigin,
}: {
  from?: string;
  link?: boolean;
  authOrigin?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      // OAuth state cookies must live on the same host as the fixed callback.
      // Move the browser first when an environment also answers on aliases.
      const canonicalStart = googleStartUrl(authOrigin, window.location.origin, link, from);
      if (canonicalStart) {
        window.location.assign(canonicalStart);
        return;
      }
      if (link) {
        const response = await fetch("/api/account/google/link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error?.message ?? "Could not start Google linking");
      }
      await signIn("google", {
        redirectTo: safeReturnPath(link ? "/account?googleLinked=1" : from, window.location.origin),
      });
    } catch (cause) {
      setError(
        link && cause instanceof Error
          ? cause.message
          : "Could not start Google sign-in. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="mt-md grid gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={start}
        className="border-outline-variant text-on-surface rounded-lg border px-4 py-3 disabled:opacity-50"
      >
        {busy ? "Connecting…" : link ? "Link Google" : "Continue with Google"}
      </button>
      {error ? (
        <p role="alert" className="text-error text-body-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
