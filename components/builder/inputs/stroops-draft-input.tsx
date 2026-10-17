"use client";

import { useId } from "react";
import { useStroopsDraft } from "./use-stroops-draft";

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur" | "type" | "inputMode"
> & {
  /** Stroops as the flow stores them; `undefined` or `""` when unset. */
  value: string | undefined;
  /** Stroops. A cleared field, or a lone `.`, commits `"0"`. */
  onChange: (stroops: string) => void;
};

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
 * Migrated panels use AmountInput with commit="draft" and the same hook.
 * This bare control remains for the excluded legacy and Dev/fiat forms.
 */
export function StroopsDraftInput({ value, onChange, ...rest }: Props) {
  const { inputProps, note } = useStroopsDraft(value, onChange);
  const noteId = useId();

  const describedBy =
    [rest["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <input {...rest} {...inputProps} aria-describedby={describedBy} />
      {/* Callers wrap this in a <label>, so the note is hidden from the label's
          text (it would join the input's name) and read via aria-describedby. */}
      <span id={noteId} aria-hidden className={note ? "text-[11px] text-zinc-400" : "hidden"}>
        {note ?? ""}
      </span>
    </>
  );
}
