"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { cn, shortAddr } from "@/lib/utils";
import { isPendingAddress } from "@/lib/flows/schema";
import type { AddressEntry } from "@/lib/address-book.types";
import { stellarExpertContractUrl, type StellarNetwork } from "@/lib/stellar/explorer";
import { isAccountId, isContractId } from "@/lib/stellar/strkey";
import { apiError } from "@/lib/friendly-error";
import {
  filterAddressBook,
  findInitialHighlightIndex,
  nextHighlightIndex,
} from "../address-input.utils";
import { Field, type FieldControlProps } from "./field";
import { inputClass, readoutClass } from "./styles";

export type AddressKind = "account" | "contract" | "either";

export function isAcceptedAddress(value: string, accept: AddressKind): boolean {
  switch (accept) {
    case "account":
      return isAccountId(value);
    case "contract":
      return isContractId(value);
    case "either":
      return isAccountId(value) || isContractId(value);
    default: {
      const never: never = accept;
      return never;
    }
  }
}

const KIND_PLACEHOLDER: Record<AddressKind, string> = {
  account: "G...",
  contract: "C...",
  either: "G... or C...",
};

export type PinnedAddress = {
  /** `undefined` when the environment has no value; shown as unconfigured. */
  id: string | undefined;
  label: string;
  network: StellarNetwork;
};

type EditableProps = {
  pinned?: undefined;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  pending?: boolean;
  /** Which strkeys count as a complete address. Default `"account"` (G… only). */
  accept?: AddressKind;
  /** Whether a `PENDING:label` placeholder address is a value this field may hold. Default true. */
  pendingAllowed?: boolean;
  /**
   * `"always"` forwards every keystroke (the legacy behaviour). `"valid"` holds
   * the draft locally and calls `onChange` only with a complete address, a
   * `PENDING:` label (when allowed), or `""` for an explicit clear (#588).
   */
  commit?: "always" | "valid";
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

type UnlabelledProps = EditableProps & {
  label?: undefined;
  hint?: undefined;
  /** Colours the border only; the caller renders the message. */
  error?: boolean;
};

type LabelledProps = EditableProps & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  /** A string is rendered under the field and described; a boolean only colours the border. */
  error?: string | boolean | null;
};

type PinnedProps = {
  /** A server-supplied address shown read-only, e.g. the Soroswap router. */
  pinned: PinnedAddress;
  hint?: React.ReactNode;
};

export type AddressPickerProps = UnlabelledProps | LabelledProps | PinnedProps;

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

/**
 * A Stellar address field with an address-book dropdown, or — with `pinned` —
 * a read-only display of an address the server supplies.
 */
export function AddressPicker(props: AddressPickerProps) {
  if (props.pinned) return <PinnedAddressField pinned={props.pinned} hint={props.hint} />;
  return <EditableAddressPicker {...props} />;
}

export default AddressPicker;

function PinnedAddressField({ pinned, hint }: { pinned: PinnedAddress; hint?: React.ReactNode }) {
  const { id, label, network } = pinned;
  if (id === undefined) {
    return (
      <Field label={label} hint={hint}>
        {(control) => (
          <output {...control} aria-invalid className={readoutClass}>
            <span className="text-error">Not configured on this environment</span>
          </output>
        )}
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint}>
      {(control) => (
        <div className="flex items-center gap-2">
          <output {...control} title={id} className={`${readoutClass} min-w-0`}>
            <span aria-hidden="true">{shortAddr(id, 4, 4)}</span>
            <span className="sr-only">{id}</span>
          </output>
          <button
            type="button"
            onClick={() => void copyToClipboard(id)}
            aria-label={`Copy ${label} address`}
            title="Copy address"
            className="text-on-surface-variant hover:text-primary shrink-0 p-1 transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
              content_copy
            </span>
          </button>
          {isContractId(id) && (
            <a
              href={stellarExpertContractUrl(id, network)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View ${label} on stellar.expert (opens in a new tab)`}
              title="View on stellar.expert"
              className="text-on-surface-variant hover:text-primary inline-flex shrink-0 items-center justify-center p-1 transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
                open_in_new
              </span>
            </a>
          )}
        </div>
      )}
    </Field>
  );
}

function EditableAddressPicker({
  value,
  onChange,
  placeholder: placeholderProp,
  pending,
  accept = "account",
  pendingAllowed = true,
  commit = "always",
  label,
  hint,
  error,
  addressBook = [],
  addressBookLoading,
  addressBookError,
  onAddressBookChange,
  onSelectEntry,
}: UnlabelledProps | LabelledProps) {
  const placeholder =
    placeholderProp ?? KIND_PLACEHOLDER[accept] + (pendingAllowed ? " or PENDING:label" : "");
  const listboxId = useId();
  const pendingBadgeId = useId();
  const [draft, setDraft] = useState(value);
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

  const text = commit === "valid" ? draft : value;
  const trimmedValue = text.trim();

  const isValid = isAcceptedAddress(trimmedValue, accept);
  // A draft the parent never received: it still holds the last committed
  // address, so the field must not look settled on something else.
  const uncommitted = commit === "valid" && trimmedValue !== value.trim();
  const invalid = Boolean(error) || uncommitted;
  // The address book stores G… accounts only (`/api/address-book`).
  const canSave = isAccountId(trimmedValue);

  const isSaved = addressBook.some((e) => e.address === trimmedValue);

  const filtered = useMemo(
    () =>
      filterAddressBook(
        addressBook.filter((e) => isAcceptedAddress(e.address, accept)),
        query,
      ),
    [addressBook, query, accept],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    setShowSave(false);
    setSaveLabel("");
    setSaveError(null);
  }, [text]);

  function handleTyped(raw: string) {
    const next = raw.trim();
    if (commit === "always") {
      onChange(next);
      return;
    }
    setDraft(next);
    if (
      next === "" ||
      isAcceptedAddress(next, accept) ||
      (pendingAllowed && isPendingAddress(next))
    ) {
      onChange(next);
    }
  }

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
    setDraft(entry.address);
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
    if (!isAccountId(address)) {
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
        throw apiError(b, "Failed to save contact");
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

  // ARIA only; the portal, positioning and key handling are unchanged (#609).
  // "Expanded" means the listbox is on screen, not merely the popup: the
  // loading, error, save and empty states have no listbox to control.
  const listboxShown =
    open &&
    mounted &&
    position !== null &&
    !addressBookLoading &&
    !addressBookError &&
    !showSave &&
    filtered.length > 0;
  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const comboboxProps = {
    role: "combobox",
    "aria-expanded": listboxShown,
    "aria-autocomplete": "list",
    "aria-controls": listboxShown ? listboxId : undefined,
    "aria-activedescendant":
      listboxShown && highlightIndex >= 0 && highlightIndex < filtered.length
        ? optionId(highlightIndex)
        : undefined,
  } as const;

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
            className={inputClass}
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
              disabled={saveBusy || !saveLabel.trim() || !canSave}
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
              className={inputClass}
              autoFocus
              aria-label="Search contacts"
              {...comboboxProps}
            />
          </div>
        )}

        {filtered.length > 0 ? (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Saved contacts"
            className="custom-scrollbar max-h-72 overflow-auto py-1"
          >
            {filtered.map((entry, index) => {
              const selected = entry.address === trimmedValue;
              const highlighted = index === highlightIndex;
              // A div, not a <button>: selection happens via onMouseDown while
              // focus stays in the search input, so no button semantics are
              // lost. The copy control inside is a mouse-only span, not a
              // button: an option's children are presentational, and a
              // focusable one inside it fails axe's nested-interactive rule.
              return (
                <div
                  key={entry.address}
                  id={optionId(index)}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectEntry(entry);
                  }}
                  className={cn(
                    "w-full cursor-pointer px-3 py-2 text-left transition-colors",
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
                    <span
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        void copyToClipboard(entry.address);
                      }}
                      aria-hidden="true"
                      title="Copy address"
                      className="text-on-surface-variant hover:text-primary shrink-0 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-4">
            <div className="border-outline-variant/30 text-label-sm text-on-surface-variant rounded-lg border border-dashed p-3 font-mono">
              {query ? <>No contacts match “{query}”.</> : <>NO SAVED CONTACTS.</>}
            </div>
            {canSave && !isSaved && (
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

  // The badge is the only place the pending state is written down, so it joins
  // whatever `Field` already describes the control with.
  const describedBy = (control?: FieldControlProps) =>
    [control?.["aria-describedby"], pending ? pendingBadgeId : null].filter(Boolean).join(" ") ||
    undefined;

  const picker = (control?: FieldControlProps) => (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <input
          {...control}
          value={text}
          onChange={(e) => handleTyped(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className={cn(inputClass, "pr-10", pending && "ring-tertiary-container ring-1")}
          autoComplete="off"
          {...comboboxProps}
          aria-haspopup="listbox"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy(control)}
        />
        {pending && (
          // bg-on-tertiary is a foreground token used as a background deliberately: the container
          // pairing inverts it to dark-on-light, where amber-950/amber-400 read light-on-dark.
          <span
            id={pendingBadgeId}
            className="text-label-sm bg-on-tertiary text-tertiary absolute -top-2 right-1 rounded px-1.5 py-0.5 font-mono"
          >
            needs address
          </span>
        )}
        {canSave && !isSaved && (
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
            className="border-outline-variant/60 bg-surface-container-high shadow-popover fixed z-[100] overflow-hidden rounded-xl border"
          >
            {dropdownContent}
          </div>,
          document.body,
        )}
    </div>
  );

  if (label === undefined) return picker();
  return (
    <Field label={label} hint={hint} error={typeof error === "string" ? error : null}>
      {picker}
    </Field>
  );
}
