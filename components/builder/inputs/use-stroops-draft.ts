"use client";

import { useEffect, useState } from "react";
import { formatStroops } from "@/lib/utils";
import { parseDraft, refusalNote, STROOP_DECIMALS } from "./numeric.utils";

function display(stroops: string | undefined): string {
  return stroops ? formatStroops(stroops) : "";
}

/** What `tokenAmountToStroops` gave for an accepted draft: `"0"` when it holds no digits. */
function draftStroops(draft: string): string {
  const parsed = parseDraft(draft, STROOP_DECIMALS);
  return parsed.kind === "value" ? parsed.units.toString() : "0";
}

/** Preserve the builder's immediate amount commits, including zero on clear, without clamping. */
export function useStroopsDraft(value: string | undefined, onChange: (stroops: string) => void) {
  const [draft, setDraft] = useState(() => display(value));
  const [note, setNote] = useState<string | null>(null);

  // Reset the draft only once it no longer reads as the stored amount: an
  // outside change (undo, another node, a deleted split row shifting up). The
  // echo of our own commit reads the same, so `1.` survives it. `draft` is
  // left out of the deps on purpose: typing must never trigger a reset.
  useEffect(() => {
    if (draftStroops(draft) === (value ?? "")) return;
    setDraft(display(value));
    setNote(null);
  }, [value]);

  const inputProps = {
    type: "text",
    inputMode: "decimal",
    autoComplete: "off",
    spellCheck: false,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      const parsed = parseDraft(next, STROOP_DECIMALS);
      if (parsed.kind === "refused") {
        setNote(refusalNote(parsed.reason, STROOP_DECIMALS));
        return;
      }
      setDraft(next);
      setNote(null);
      const stroops = draftStroops(next);
      if (stroops !== (value ?? "")) onChange(stroops);
    },
    onBlur: () => {
      setDraft(display(value));
      setNote(null);
    },
  } as const;
  return { inputProps, note };
}
