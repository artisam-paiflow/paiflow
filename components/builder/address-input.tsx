"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { StrKey } from "@stellar/stellar-sdk";
import { cn, shortAddr } from "@/lib/utils";
import { isPendingAddress } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";
import {
  filterAddressBook,
  findInitialHighlightIndex,
  nextHighlightIndex,
} from "./address-input.utils";

export type AddressInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  pending?: boolean;
  addressBook?: AddressEntry[];
  addressBookLoading?: boolean;
  addressBookError?: string | null;
  onAddressBookChange?: () => void;
  /**
   * Called when an entry is picked from the address book, with the full entry
   * (address + label). Lets callers that track an associated label (e.g. split
   * recipients) update it alongside the address. When provided, this replaces
   * the plain `onChange(address)` call for address-book selections.
   */
  onSelectEntry?: (entry: AddressEntry) => void;
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  toast.success("Copied to clipboard.");
}

export default function AddressInput({
  value,
  onChange,
  placeholder = "G... or PENDING:label",
  pending,
  addressBook = [],
  addressBookLoading,
  addressBookError,
  onAddressBookChange,
  onSelectEntry,
}: AddressInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [showSave, setShowSave] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const trimmedValue = value.trim();

  const isValid =
    !isPendingAddress(trimmedValue) &&
    trimmedValue.length > 0 &&
    StrKey.isValidEd25519PublicKey(trimmedValue);

  const isSaved = addressBook.some((e) => e.address === trimmedValue);

  const filtered = useMemo(() => filterAddressBook(addressBook, query), [addressBook, query]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setShowSave(false);
    setSaveLabel("");
    setSaveError(null);
  }, [value]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setQuery("");
    setShowSave(false);

    function updatePosition() {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const width = Math.max(rect.width, 280);
      let left = rect.left;
      if (left + width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - width - 8);
      }
      setPosition({ top: rect.bottom + 4, left, width });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
      setShowSave(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setShowSave(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setHighlightIndex(findInitialHighlightIndex(filtered, trimmedValue));
  }, [open, query, addressBook, trimmedValue]);

  useEffect(() => {
    if (!open || highlightIndex < 0) return;
    const row = dropdownRef.current?.querySelector(`[data-index="${highlightIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  function selectEntry(entry: AddressEntry) {
    if (onSelectEntry) {
      onSelectEntry(entry);
    } else {
      onChange(entry.address);
    }
    setOpen(false);
    setShowSave(false);
    setQuery("");
  }

  function handleSelectHighlighted() {
    if (highlightIndex >= 0 && highlightIndex < filtered.length) {
      selectEntry(filtered[highlightIndex]!);
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setHighlightIndex((i) => nextHighlightIndex(i, "down", filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (filtered.length === 0) return;
      setHighlightIndex((i) => nextHighlightIndex(i, "up", filtered.length));
    } else if (e.key === "Enter") {
      if (open && highlightIndex >= 0) {
        e.preventDefault();
        handleSelectHighlighted();
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setShowSave(false);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
      setShowSave(false);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => nextHighlightIndex(i, "down", filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => nextHighlightIndex(i, "up", filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelectHighlighted();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setShowSave(false);
    }
  }

  async function saveToAddressBook() {
    const address = trimmedValue;
    const label = saveLabel.trim();
    if (!label) {
      setSaveError("Label is required");
      return;
    }
    if (!StrKey.isValidEd25519PublicKey(address)) {
      setSaveError("Invalid Stellar address");
      return;
    }
    const existing = addressBook.find((e) => e.address === address);
    if (existing) {
      setSaveError(`This address is already saved as "${existing.label}".`);
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
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
      selectEntry({ address, label });
    } catch (err) {
      setSaveError((err as Error).message ?? "Failed");
    } finally {
      setSaveBusy(false);
    }
  }

  const inputClasses =
    "border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary w-full rounded border px-3 py-2 pr-10 font-mono text-[14px] focus:ring-1 focus:outline-none";

  const dropdownContent = (() => {
    if (addressBookLoading) {
      return (
        <div className="text-label-sm text-on-surface-variant flex items-center justify-center gap-2 px-3 py-6 font-mono">
          <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
          Loading contacts…
        </div>
      );
    }

    if (addressBookError) {
      return (
        <div className="px-3 py-4 text-center">
          <div className="text-error text-label-sm font-mono">{addressBookError}</div>
          <button
            type="button"
            onClick={() => onAddressBookChange?.()}
            className="text-label-sm text-secondary hover:text-secondary-fixed mt-2 font-mono transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }

    if (showSave) {
      return (
        <div className="p-3">
          <div className="text-label-sm text-on-surface-variant mb-1.5 font-mono uppercase">
            Save to address book
          </div>
          <input
            value={saveLabel}
            onChange={(e) => setSaveLabel(e.target.value)}
            placeholder="Label e.g. Alice"
            className={inputClasses}
            autoFocus
          />
          {saveError && (
            <div className="text-label-sm text-error mt-1.5 font-mono">{saveError}</div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowSave(false);
                setSaveLabel("");
                setSaveError(null);
              }}
              disabled={saveBusy}
              className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:bg-surface-container-high/40 shrink-0 rounded-lg border px-2.5 py-1.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              CANCEL
            </button>
            <button
              type="button"
              onClick={() => void saveToAddressBook()}
              disabled={saveBusy || !saveLabel.trim() || !isValid}
              className="bg-primary text-label-sm text-on-primary inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 font-mono font-bold transition-all hover:-translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveBusy ? "SAVING…" : "SAVE"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col">
        {addressBook.length > 0 && (
          <div className="border-outline-variant/20 border-b p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search contacts…"
              className={inputClasses}
              autoFocus
            />
          </div>
        )}

        {filtered.length > 0 ? (
          <div
            role="listbox"
            aria-label="Saved contacts"
            className="custom-scrollbar max-h-72 overflow-auto py-1"
          >
            {filtered.map((entry, index) => {
              const selected = entry.address === trimmedValue;
              const highlighted = index === highlightIndex;
              return (
                <button
                  key={entry.address}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectEntry(entry);
                  }}
                  className={cn(
                    "w-full px-3 py-2 text-left transition-colors",
                    selected && "bg-primary/10 text-primary border-primary border-l-2",
                    highlighted && !selected && "bg-surface-container",
                    !selected && !highlighted && "hover:bg-surface-container-high/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-body-md truncate",
                          selected ? "text-primary" : "text-on-surface",
                        )}
                      >
                        {entry.label}
                      </div>
                      <div
                        className={cn(
                          "text-label-sm truncate font-mono",
                          selected ? "text-primary/80" : "text-on-surface-variant",
                        )}
                        title={entry.address}
                      >
                        {shortAddr(entry.address)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void copyToClipboard(entry.address);
                      }}
                      aria-label="Copy address"
                      title="Copy address"
                      className="text-on-surface-variant hover:text-primary shrink-0 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-4">
            <div className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded-lg border border-dashed p-3 font-mono">
              {query ? <>No contacts match “{query}”.</> : <>NO SAVED CONTACTS.</>}
            </div>
            {isValid && !isSaved && (
              <button
                type="button"
                onClick={() => setShowSave(true)}
                className="text-label-sm text-secondary hover:text-secondary-fixed mt-2 font-mono transition-colors"
              >
                Save this address to your address book
              </button>
            )}
            {!isValid && (
              <div className="text-label-sm text-on-surface-variant mt-2 font-mono">
                Type or paste a Stellar address, or add contacts in Address Book.
              </div>
            )}
          </div>
        )}
      </div>
    );
  })();

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className={cn(inputClasses, pending && "ring-1 ring-amber-700")}
          autoComplete="off"
          aria-expanded={open}
          aria-haspopup="listbox"
        />
        {pending && (
          <span className="absolute -top-2 right-1 rounded bg-amber-950 px-1.5 py-0.5 text-[10px] text-amber-400">
            needs address
          </span>
        )}
        {isValid && !isSaved && (
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setShowSave((v) => !v);
            }}
            title="Save to address book"
            className="text-on-surface-variant hover:text-primary absolute right-2 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">bookmark_add</span>
          </button>
        )}
      </div>

      {open &&
        mounted &&
        position &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              top: position.top,
              left: position.left,
              width: position.width,
            }}
            className="border-outline-variant/60 bg-surface-container-high fixed z-[100] overflow-hidden rounded-xl border shadow-[0_8px_24px_-4px_rgba(0,0,0,0.7)]"
          >
            {dropdownContent}
          </div>,
          document.body,
        )}
    </div>
  );
}
