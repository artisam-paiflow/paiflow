import { z } from "zod";

// Zod 3's integer check used Number.isInteger without imposing the safe-integer
// range. Keep that existing boundary for schemas without an explicit maximum;
// their domain checks still decide which values are usable. Money stays strings.
export const integerNumber = () =>
  z.number().refine(Number.isInteger, { error: "Expected integer, received float" });

export const coercedIntegerNumber = () =>
  z.coerce.number().refine(Number.isInteger, { error: "Expected integer, received float" });
