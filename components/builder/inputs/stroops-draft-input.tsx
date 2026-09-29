"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  // The last string handed to `onChange`, so its echo is not mistaken for an
  // outside change (another node's edit, undo, a node switch) that resets the draft.
  const committed = useRef(value ?? "");
  const noteId = useId();

  useEffect(() => {
    if ((value ?? "") === committed.current) return;
    committed.current = value ?? "";
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
          const stroops = parsed.kind === "value" ? parsed.units.toString() : "0";
          if (stroops === (value ?? "")) return;
          committed.current = stroops;
          onChange(stroops);
        }}
        onBlur={() => setDraft(display(value))}
      />
      <span
        id={noteId}
        aria-live="polite"
        className={note ? "text-[11px] text-zinc-400" : "sr-only"}
      >
        {note ?? ""}
      </span>
    </>
  );
}
