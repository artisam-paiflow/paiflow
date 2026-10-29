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
