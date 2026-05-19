"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

type Passkey = {
  id: string;
  nickname: string | null;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

export default function PasskeyManager() {
  const [items, setItems] = useState<Passkey[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const r = await fetch("/api/account/passkeys").then((r) => r.json());
    setItems(r?.data ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addPasskey() {
    setBusy(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optsRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const opts = await optsRes.json();
      if (!opts?.data) throw new Error("Failed to start registration");
      const attestation = await startRegistration({ optionsJSON: opts.data });
      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attestation),
      });
      if (!verifyRes.ok) {
        const b = await verifyRes.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? "Verification failed");
      }
      toast.success("Passkey added.");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this passkey?")) return;
    const r = await fetch(`/api/account/passkeys/${id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("Failed to remove");
      return;
    }
    toast.success("Removed.");
    await refresh();
  }

  async function revokeAll() {
    if (!confirm("Sign out of every session on every device?")) return;
    const r = await fetch("/api/auth/sessions/revoke-all", { method: "POST" });
    if (!r.ok) {
      toast.error("Failed");
      return;
    }
    window.location.href = "/login";
  }

  return (
    <section className="glass-panel mt-md p-md rounded-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Passkeys</h2>
        <button
          onClick={addPasskey}
          disabled={busy}
          className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          <span className="material-symbols-outlined text-[16px]">key</span>
          {busy ? "ADDING…" : "ADD PASSKEY"}
        </button>
      </div>
      <ul className="mt-md space-y-2">
        {loaded && items.length === 0 && (
          <li className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded border border-dashed p-3 font-mono">
            NO PASSKEYS YET.
          </li>
        )}
        {items.map((p) => (
          <li
            key={p.id}
            className="border-outline-variant/15 bg-surface-container-low/40 flex items-center justify-between rounded-lg border px-3 py-2.5"
          >
            <div>
              <div className="text-body-md text-on-surface">{p.nickname ?? "Unnamed device"}</div>
              <div className="text-label-sm text-on-surface-variant font-mono">
                {p.deviceType.toUpperCase()} · ADDED {new Date(p.createdAt).toLocaleString()}
                {p.lastUsedAt ? ` · LAST USED ${new Date(p.lastUsedAt).toLocaleString()}` : ""}
              </div>
            </div>
            <button
              onClick={() => remove(p.id)}
              className="border-error/40 text-label-sm text-error hover:bg-error-container/30 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete</span>
              REMOVE
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-md border-outline-variant/15 pt-md border-t">
        <button
          onClick={revokeAll}
          className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:border-error/40 hover:text-error inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">logout</span>
          SIGN OUT EVERYWHERE
        </button>
      </div>
    </section>
  );
}
