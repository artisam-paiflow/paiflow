"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * "New flow" trigger + confirmation dialog. Renders as a plain button styled by
 * the caller (via `className` / `children`) so it can stand in for the various
 * dashboard entry points. A flow is only persisted when the user confirms in
 * the dialog — navigating around no longer creates blank flows (issue #278).
 */
export default function NewFlowButton({
  className,
  children,
  ariaLabel,
}: {
  className?: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Untitled flow");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName("Untitled flow");
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  async function create() {
    // Re-entrancy guard: `disabled={busy}` on the button isn't applied
    // synchronously, and Enter-keydown can fire repeatedly, so without this a
    // fast double-confirm could POST twice and create two flows — the exact
    // dup-creation bug this dialog exists to prevent (#281 review).
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const r = await fetch("/api/flows/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? "Failed to create flow");
      }
      const json = await r.json();
      // Keep the overlay up (busy) through the navigation so the dialog can't be
      // re-submitted while the builder loads.
      router.push(`/flows/${json.data.id}`);
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to create flow");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create a new flow"
            className="bg-background-1 relative flex w-full max-w-md flex-col rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <h3 className="text-label-lg text-on-background font-bold">New flow</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                disabled={busy}
                className="text-on-background/60 hover:text-on-background flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-zinc-800 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="px-5 py-4">
              <label className="group grid gap-1.5">
                <span className="text-label-sm text-on-surface-variant font-mono uppercase">
                  Flow name
                </span>
                <input
                  ref={inputRef}
                  value={name}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void create();
                    }
                  }}
                  maxLength={80}
                  placeholder="Untitled flow"
                  className="border-outline-variant/40 bg-surface-container-lowest text-on-surface focus:border-primary focus:ring-primary rounded border px-3 py-2 font-mono text-[14px] focus:ring-1 focus:outline-none disabled:opacity-50"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="border-outline-variant/40 text-label-sm text-on-surface-variant hover:bg-surface-container-high/40 rounded-lg border px-4 py-2 font-mono transition-colors disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy || !name.trim()}
                className="bg-primary text-label-md text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono font-bold transition-all hover:-translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                {busy ? "CREATING…" : "CREATE FLOW"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
