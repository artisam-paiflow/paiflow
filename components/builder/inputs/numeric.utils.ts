import { formatStroops } from "@/lib/utils";

// Fixed-point throughout: a decimal string is read as a whole number of
// `10^-decimals` units (stroops for amounts, basis points for percent with
// decimals = 2), so no value on this path is ever a float.

export const STROOP_DECIMALS = 7;

// 39 digits is i128's width (lib/flows/primitives.ts); the cap keeps BigInt()
// off a pasted megabyte of digits. Bounds are applied separately.
const MAX_WHOLE_DIGITS = 39;

// ASCII digits only (no `u` flag), at most one point, no sign or exponent.
const SHAPE = /^(\d*)(?:\.(\d*))?$/;

export type DraftParse =
  | { kind: "empty" }
  | { kind: "partial" }
  | { kind: "value"; units: bigint }
  | { kind: "refused"; reason: Refusal };

export type Refusal = "shape" | "decimals" | "length";

/**
 * Reads what the user typed. Anything that is not digits and at most one `.`
 * is refused rather than cleaned up: `1,5` could mean 1.5 or 15, and a money
 * field must not guess. Excess decimals are refused, never rounded.
 */
export function parseDraft(draft: string, decimals: number): DraftParse {
  const trimmed = draft.trim();
  if (trimmed === "") return { kind: "empty" };
  const m = SHAPE.exec(trimmed);
  if (!m) return { kind: "refused", reason: "shape" };
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (whole.length > MAX_WHOLE_DIGITS) return { kind: "refused", reason: "length" };
  if (frac.length > decimals) return { kind: "refused", reason: "decimals" };
  if (whole === "" && frac === "") return { kind: "partial" };
  return { kind: "value", units: BigInt((whole || "0") + frac.padEnd(decimals, "0")) };
}

/** The canonical text for a value: no trailing point, no leading zeros. */
export function formatUnits(units: bigint, decimals: number): string {
  return formatStroops(units, decimals);
}

export function clampUnits(
  units: bigint,
  min: bigint,
  max: bigint,
): { units: bigint; clamped: "min" | "max" | null } {
  if (units < min) return { units: min, clamped: "min" };
  if (units > max) return { units: max, clamped: "max" };
  return { units, clamped: null };
}

export function refusalNote(reason: Refusal, decimals: number): string {
  if (reason === "length") return "That number is too long.";
  if (reason === "decimals") {
    return decimals === 0
      ? "Whole numbers only."
      : `At most ${decimals} decimal place${decimals === 1 ? "" : "s"}.`;
  }
  return "Use digits and one decimal point, like 1.5.";
}
