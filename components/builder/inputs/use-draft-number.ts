"use client";

import { useEffect, useRef, useState } from "react";
import { clampUnits, formatUnits, parseDraft, refusalNote } from "./numeric.utils";

type Options = {
  /** The committed value, in `10^-decimals` units; `null` when there is none. */
  value: bigint | null;
  onChange: (units: bigint) => void;
  decimals: number;
  min: bigint;
  max: bigint;
  /** A value as the user reads it, with its unit, for the notes: "0.3%". */
  describe: (units: bigint) => string;
  /** The note when a cleared field blurs, given `describe(value)`; defaults to "the flow still uses". */
  emptyNote?: (described: string) => string;
};

/**
 * Draft-then-commit for a numeric field. The input shows a draft string; the
 * owner only ever receives a value that parses, sits within `[min, max]` and
 * differs from `value`. Anything else — `1.`, a cleared field, `0` on the way
 * to `0.5` against a floor of 0.3 — stays in the draft. Blur normalises the
 * draft and clamps it, and a note says whenever that changed the value.
 *
 * `onChange` is only ever called from the input's event handlers, never from
 * an effect. In the builder it is `updateNode`, a plain function re-created on
 * every render: an effect that listed it would re-run on every render, and one
 * that committed would loop. The one effect below re-syncs the draft and does
 * not touch `onChange`.
 */
export function useDraftNumber({
  value,
  onChange,
  decimals,
  min,
  max,
  describe,
  emptyNote = (described) => `Empty — the flow still uses ${described}.`,
}: Options) {
  const format = (units: bigint | null) => (units === null ? "" : formatUnits(units, decimals));
  const [draft, setDraft] = useState(() => format(value));
  const [note, setNote] = useState<string | null>(null);
  // The last value this field handed to `onChange`, so the owner echoing it
  // back is not mistaken for an outside change that should reset the draft.
  const committed = useRef(value);

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft(value === null ? "" : formatUnits(value, decimals));
    setNote(null);
  }, [value, decimals]);

  const commit = (units: bigint) => {
    if (units === value) return;
    committed.current = units;
    onChange(units);
  };

  const inputProps = {
    type: "text",
    inputMode: "decimal",
    autoComplete: "off",
    spellCheck: false,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      const parsed = parseDraft(next, decimals);
      if (parsed.kind === "refused") {
        setNote(refusalNote(parsed.reason, decimals));
        return;
      }
      setDraft(next);
      setNote(null);
      if (parsed.kind === "value" && parsed.units >= min && parsed.units <= max) {
        commit(parsed.units);
      }
    },
    onBlur: () => {
      const parsed = parseDraft(draft, decimals);
      if (parsed.kind === "value") {
        const { units, clamped } = clampUnits(parsed.units, min, max);
        commit(units);
        setDraft(formatUnits(units, decimals));
        if (clamped === "min") setNote(`Raised to the minimum, ${describe(units)}.`);
        if (clamped === "max") setNote(`Lowered to the maximum, ${describe(units)}.`);
        return;
      }
      if (parsed.kind === "refused") return; // unreachable: a refused edit never becomes the draft
      if (parsed.kind === "partial") setDraft("");
      if (value !== null) setNote(emptyNote(describe(value)));
    },
  } as const;

  return { draft, note, inputProps };
}
