import { z } from "zod";

// No server-only import: the builder's numeric inputs (#608) share these bounds.

/** Largest i128: the ceiling for any stroops amount a contract call encodes. */
export const I128_MAX = (1n << 127n) - 1n;

// 39 digits is i128's width; the length cap keeps BigInt() off megabyte strings.
const DIGITS = /^\d{1,39}$/;

/**
 * Whole stroops, greater than zero, and small enough to encode as an i128.
 * One refine with one message, so each caller keeps its own wording — and
 * BigInt() never sees a string the regex refused.
 */
export function stroopsSchema({ message }: { message: string }) {
  return z
    .string()
    .refine((s) => DIGITS.test(s) && BigInt(s) > 0n && BigInt(s) <= I128_MAX, message);
}

export const TOTAL_BPS = 10_000;

/**
 * Basis points, 0 to 100%. `coerce` for query strings; each caller adds its own
 * default.
 */
export function bpsSchema({ coerce = false }: { coerce?: boolean } = {}) {
  return (coerce ? z.coerce.number() : z.number()).int().min(0).max(TOTAL_BPS);
}
