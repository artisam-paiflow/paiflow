"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StrKey } from "@stellar/stellar-sdk";
import { shortAddr } from "@/lib/utils";

type Entry = {
  id: string;
  label: string;
  address: string;
  createdAt: string;
};

export default function AddressBookManager() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formLabel, setFormLabel] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAddress, setEditAddress] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/address-book");
    if (!r.ok) {
      toast.error("Failed to load address book");
      setLoaded(true);
      return;
    }
    const json = await r.json();
    setEntries(json?.data ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  function validateAddress(address: string): string | null {
    if (!address.trim()) return "Address is required";
    if (!StrKey.isValidEd25519PublicKey(address.trim())) return "Invalid Stellar address";
    return null;
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    const label = formLabel.trim();
    const address = formAddress.trim();
    if (!label) {
      setFormError("Label is required");
      return;
    }
    const addrError = validateAddress(address);
    if (addrError) {
      setFormError(addrError);
      return;
    }
    const dup = entries.find((en) => en.address === address && en.label !== label);
    if (dup) {
      setFormError(`This address is already saved as "${dup.label}".`);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await fetch("/api/address-book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, address }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? "Failed to add contact");
      }
      toast.success("Contact saved.");
      setFormLabel("");
      setFormAddress("");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    const address = editAddress.trim();
    const addrError = validateAddress(address);
    if (addrError) {
      setEditError(addrError);
      return;
    }
    if (!entries.some((e) => e.id === editingId)) {
      setEditError("Contact not found");
      return;
    }
    const dup = entries.find((en) => en.address === address && en.id !== editingId);
    if (dup) {
      setEditError(`This address is already saved as "${dup.label}".`);
      return;
    }
    setBusy(true);
    setEditError(null);
    try {
      const r = await fetch(`/api/address-book/${editingId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? "Failed to update contact");
      }
      toast.success("Contact updated.");
      setEditingId(null);
      setEditAddress("");
      await refresh();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this contact?")) return;
    const r = await fetch(`/api/address-book/${id}`, { method: "DELETE" });
    if (!r.ok) {
      toast.error("Failed to remove");
      return;
    }
    toast.success("Removed.");
    await refresh();
  }

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setEditAddress(entry.address);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditAddress("");
    setEditError(null);
  }

  return (
    <section className="glass-panel mt-md p-md rounded-xl">
      <div className="flex items-center justify-between">
        <h2 className="text-headline-sm text-on-surface">Contacts</h2>
        <span className="text-label-sm text-on-surface-variant font-mono">/ SAVED ADDRESSES</span>
      </div>

      <form onSubmit={addEntry} className="mt-md gap-md grid md:grid-cols-[1fr_1fr_auto]">
        <label className="group grid gap-1.5">
          <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
            Label
          </span>
          <input
            value={formLabel}
            onChange={(e) => setFormLabel(e.target.value)}
            placeholder="e.g. Alice"
            className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
          />
        </label>
        <label className="group grid gap-1.5">
          <span className="text-label-sm text-on-surface-variant group-focus-within:text-primary font-mono uppercase transition-colors">
            Stellar address
          </span>
          <input
            value={formAddress}
            onChange={(e) => setFormAddress(e.target.value)}
            placeholder="G..."
            className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold transition-all hover:-translate-y-px hover:shadow-[0_0_16px_rgba(255,177,196,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {busy ? "SAVING…" : "ADD"}
          </button>
        </div>
        {formError ? (
          <div className="text-error text-label-sm font-mono md:col-span-3">{formError}</div>
        ) : null}
      </form>

      <ul className="mt-md space-y-2">
        {loaded && entries.length === 0 && (
          <li className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded border border-dashed p-3 font-mono">
            NO CONTACTS YET.
          </li>
        )}
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="border-outline-variant/15 bg-surface-container-low/40 rounded-lg border px-3 py-2.5"
          >
            {editingId === entry.id ? (
              <div className="gap-md grid items-center md:grid-cols-[1fr_1fr_auto]">
                <div className="border-outline-variant/30 bg-surface-container-low/40 text-on-surface rounded border px-3 py-2 font-mono text-[14px]">
                  {entry.label}
                </div>
                <input
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveEdit()}
                    disabled={busy}
                    className="bg-primary text-label-sm text-on-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono font-bold transition-all hover:-translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[14px]">check</span>
                    SAVE
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={busy}
                    className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:bg-surface-container-high/40 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-mono transition-colors"
                  >
                    CANCEL
                  </button>
                </div>
                {editError ? (
                  <div className="text-error text-label-sm font-mono md:col-span-3">
                    {editError}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-body-md text-on-surface truncate">{entry.label}</div>
                  <div className="text-label-sm text-on-surface-variant font-mono">
                    {shortAddr(entry.address)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startEdit(entry)}
                    className="border-secondary/40 text-label-sm text-secondary hover:bg-secondary/10 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">edit</span>
                    EDIT
                  </button>
                  <button
                    onClick={() => remove(entry.id)}
                    className="border-error/40 text-label-sm text-error hover:bg-error-container/30 inline-flex items-center gap-1 rounded border px-2 py-1 font-mono transition-colors"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    REMOVE
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
