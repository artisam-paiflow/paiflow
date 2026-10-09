"use client";

import { useEffect, useId, useState } from "react";
import { formatStroops } from "@/lib/utils";
import { parseDraft, refusalNote, STROOP_DECIMALS } from "./numeric.utils";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur" | "type" | "inputMode"
> & {
  /** Stroops as the flow stores them; `undefined` or `""` when unset. */
  value: string | undefined;
  /** Stroops. A cleared field, or a lone `.`, commits `"0"`. */
  onChange: (stroops: string) => void;
};

function display(stroops: string | undefined): string {
  return stroops ? formatStroops(stroops) : "";
}

/** What `tokenAmountToStroops` gave for an accepted draft: `"0"` when it holds no digits. */
function draftStroops(draft: string): string {
  const parsed = parseDraft(draft, STROOP_DECIMALS);
  return parsed.kind === "value" ? parsed.units.toString() : "0";
}

/**
 * A bare amount `<input>` for the hand-rolled config panels, which keep their
 * own label, echo and error markup (#615). It holds what the user typed as a
 * draft, so `1.` survives the re-render on the way to `1.5` instead of being
 * reformatted to `1` and turning `1.5` into `15`.
 *
 * Every accepted draft commits the same stroop string `tokenAmountToStroops`
 * committed for it before, including `"0"` for a cleared field, so saved flows
 * and `to-params` see no change. What differs is refusal: a character other
 * than a digit or one `.`, or an eighth decimal, is refused with a note rather
 * than stripped or truncated (`1,5` used to commit 15).
 *
 * The full `AmountInput` (min/max clamp, empty-keeps-value) replaces this when
 * the panels adopt the shared inputs (#718).
 */
export function StroopsDraftInput({ value, onChange, ...rest }: Props) {
  const [draft, setDraft] = useState(() => display(value));
  const [note, setNote] = useState<string | null>(null);
  const noteId = useId();

  // Reset the draft only once it no longer reads as the stored amount: an
  // outside change (undo, another node, a deleted split row shifting up). The
  // echo of our own commit reads the same, so `1.` survives it. `draft` is
  // left out of the deps on purpose: typing must never trigger a reset.
  useEffect(() => {
    if (draftStroops(draft) === (value ?? "")) return;
    setDraft(display(value));
    setNote(null);
  }, [value]);

  const describedBy =
    [rest["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        aria-describedby={describedBy}
        onChange={(e) => {
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
        }}
        onBlur={() => {
          setDraft(display(value));
          setNote(null);
        }}
      />
      {/* Callers wrap this in a <label>, so the note is hidden from the label's
          text (it would join the input's name) and read via aria-describedby. */}
      <span id={noteId} aria-hidden className={note ? "text-[11px] text-zinc-400" : "hidden"}>
        {note ?? ""}
      </span>
    </>
  );
}
