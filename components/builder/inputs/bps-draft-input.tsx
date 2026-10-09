"use client";

import { useId } from "react";
import { TOTAL_BPS } from "@/lib/flows/schema";
import { formatPercent } from "./percent-bps-input";
import { useDraftNumber } from "./use-draft-number";

// Percent to two decimals, read as fixed-point, is basis points: "12.5" is
// 1250. See percent-bps-input.tsx.
const PERCENT_DECIMALS = 2;

type Props = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur" | "type" | "inputMode"
> & {
  /** Integer basis points, as the flow stores them. */
  value: number;
  /** Integer basis points in [0, 10000]. Never called for a cleared or half-typed field. */
  onChange: (bps: number) => void;
};

/**
 * A share `<input>` with its `%` suffix for the hand-rolled split panel, which
 * keeps its own label and error markup — the sibling of `StroopsDraftInput`
 * (#615) for a percentage stored as bps (#583).
 *
 * Built on `useDraftNumber`: the field shows what was typed, and the owner only
 * ever receives an integer bps that parses and sits in [0, 10000]. A cleared
 * field stays empty instead of committing 0 (the old input wrote `bps: 0`,
 * which the shape schema refused, so every autosave 422d), and `12.` keeps its
 * point on the way to `12.5` instead of re-rendering as `12`. Blurring a
 * cleared field leaves the stored share alone and says so. Over 100% is
 * clamped on blur, with a note; a
 * character other than a digit or one `.`, or a third decimal, is refused with
 * a note rather than stripped or rounded.
 *
 * A typed `0` does commit: it is a value the user chose, and `validateFlow`
 * reports it on the recipients list before anything deploys.
 */
export function BpsDraftInput({ value, onChange, ...rest }: Props) {
  const noteId = useId();
  const { note, inputProps } = useDraftNumber({
    value: Number.isSafeInteger(value) ? BigInt(value) : null,
    // Safe: the hook only commits within [0, TOTAL_BPS].
    onChange: (units) => onChange(Number(units)),
    decimals: PERCENT_DECIMALS,
    min: 0n,
    max: BigInt(TOTAL_BPS),
    describe: formatPercent,
  });

  const describedBy =
    [rest["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined;

  return (
    <>
      <div className="relative">
        <input {...rest} {...inputProps} aria-describedby={describedBy} />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[11px] text-zinc-500"
        >
          %
        </span>
      </div>
      {/* A label wrapping this would read the note as part of the input's name,
          so it is hidden from the label's text and read via aria-describedby. */}
      <span id={noteId} aria-hidden className={note ? "text-[11px] text-zinc-400" : "hidden"}>
        {note ?? ""}
      </span>
    </>
  );
}
