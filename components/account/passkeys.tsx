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
      toast.success("Passkey added");
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
    toast.success("Removed");
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
    <section className="mt-10 rounded-xl border border-zinc-800 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Passkeys</h2>
        <button
          onClick={addPasskey}
          disabled={busy}
          className="bg-brand-600 hover:bg-brand-500 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Adding…" : "Add a passkey"}
        </button>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {loaded && items.length === 0 && <li className="text-zinc-400">No passkeys yet.</li>}
        {items.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2"
          >
            <div>
              <div className="font-medium">{p.nickname ?? "Unnamed device"}</div>
              <div className="text-xs text-zinc-500">
                {p.deviceType} · added {new Date(p.createdAt).toLocaleString()}
                {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleString()}` : ""}
              </div>
            </div>
            <button
              onClick={() => remove(p.id)}
              className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-6 border-t border-zinc-800 pt-4">
        <button
          onClick={revokeAll}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
        >
          Sign out everywhere
        </button>
      </div>
    </section>
  );
}
