"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StrKey } from "@stellar/stellar-sdk";
import { shortAddr } from "@/lib/utils";
import { isPendingAddress } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";

export type AddressInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  pending?: boolean;
  addressBook?: AddressEntry[];
  onAddressBookChange?: () => void;
  /**
   * Called when an entry is picked from the address book, with the full entry
   * (address + label). Lets callers that track an associated label (e.g. split
   * recipients) update it alongside the address. When provided, this replaces
   * the plain `onChange(address)` call for address-book selections.
   */
  onSelectEntry?: (entry: AddressEntry) => void;
};

export default function AddressInput({
  value,
  onChange,
  placeholder = "G... or PENDING:label",
  pending,
  addressBook = [],
  onAddressBookChange,
  onSelectEntry,
}: AddressInputProps) {
  const [focused, setFocused] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isValid =
    !isPendingAddress(value) &&
    value.trim().length > 0 &&
    StrKey.isValidEd25519PublicKey(value.trim());

  const isSaved = addressBook.some((e) => e.address === value.trim());

  useEffect(() => {
    setShowSave(false);
    setSaveLabel("");
  }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setFocused(false);
        setShowSave(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function saveToAddressBook() {
    const address = value.trim();
    const label = saveLabel.trim();
    if (!label) {
      toast.error("Label is required");
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(address)) {
      toast.error("Invalid Stellar address");
      return;
    }
    setSaveBusy(true);
    try {
      const r = await fetch("/api/address-book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, address }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? "Failed to save contact");
      }
      toast.success("Contact saved to address book.");
      setShowSave(false);
      setSaveLabel("");
      onAddressBookChange?.();
    } catch (err) {
      toast.error((err as Error).message ?? "Failed");
    } finally {
      setSaveBusy(false);
    }
  }

  function selectEntry(entry: AddressEntry) {
    if (onSelectEntry) {
      onSelectEntry(entry);
    } else {
      onChange(entry.address);
    }
    setFocused(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          className={`border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 pr-10 font-mono text-[14px] focus:ring-1 focus:outline-none ${
            pending ? "ring-1 ring-amber-700" : ""
          }`}
          autoComplete="off"
        />
        {pending && (
          <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
            needs address
          </span>
        )}
        {isValid && !isSaved && (
          <button
            type="button"
            onClick={() => setShowSave((v) => !v)}
            title="Save to address book"
            className="text-on-surface-variant hover:text-primary absolute right-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
          </button>
        )}
      </div>

      {showSave && isValid && (
        <div className="border-outline-variant/50 bg-surface-container-high absolute z-30 mt-1 w-full rounded-lg border p-3 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.7)]">
          <div className="text-label-sm text-on-surface-variant mb-1.5 font-mono uppercase">
            Save to address book
          </div>
          <input
            value={saveLabel}
            onChange={(e) => setSaveLabel(e.target.value)}
            placeholder="Label e.g. Alice"
            className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary w-full rounded border px-2 py-1.5 font-mono text-[13px] focus:ring-1 focus:outline-none"
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowSave(false);
                setSaveLabel("");
              }}
              disabled={saveBusy}
              className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:bg-surface-container-high/40 shrink-0 rounded border px-2.5 py-1.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={saveToAddressBook}
              disabled={saveBusy}
              className="bg-primary text-label-sm text-on-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono font-bold transition-all hover:-translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveBusy ? "SAVING…" : "SAVE"}
            </button>
          </div>
        </div>
      )}

      {focused && !showSave && addressBook.length > 0 && (
        <div className="glass-panel absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border py-1 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]">
          {addressBook.map((entry) => (
            <button
              key={entry.address}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                selectEntry(entry);
              }}
              className="hover:bg-surface-container-high/40 w-full px-3 py-2 text-left transition-colors"
            >
              <div className="text-body-md text-on-surface">{entry.label}</div>
              <div className="text-label-sm text-on-surface-variant font-mono">
                {shortAddr(entry.address)}
              </div>
            </button>
          ))}
        </div>
      )}

      {focused && !showSave && addressBook.length === 0 && (
        <div className="glass-panel absolute z-20 mt-1 w-full rounded-lg border px-3 py-2 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]">
          <div className="text-label-sm text-on-surface-variant font-mono">NO SAVED CONTACTS.</div>
        </div>
      )}
    </div>
  );
}
