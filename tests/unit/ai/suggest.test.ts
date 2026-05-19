import { describe, it, expect } from "vitest";
import { z } from "zod";

const SuggestionSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  message: z.string().min(1),
});

describe("suggestion parsing", () => {
  it("accepts valid suggestions", () => {
    const valid = [
      { severity: "error", message: "Recipients share the same address" },
      { severity: "warning", message: "Basis points sum to 8,000" },
      { severity: "info", message: "Consider adding a label" },
    ];
    for (const s of valid) {
      expect(SuggestionSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects invalid severity", () => {
    const result = SuggestionSchema.safeParse({ severity: "critical", message: "oops" });
    expect(result.success).toBe(false);
  });

  it("rejects empty message", () => {
    const result = SuggestionSchema.safeParse({ severity: "error", message: "" });
    expect(result.success).toBe(false);
  });

  it("filters mixed valid/invalid suggestions", () => {
    const raw = [
      { severity: "error", message: "Same address" },
      { severity: "warning", message: "Low bps" },
      { bad: true },
      { severity: "info" },
    ];
    const parsed = raw
      .map((s) => {
        const p = SuggestionSchema.safeParse(s);
        return p.success ? p.data : null;
      })
      .filter(Boolean);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ severity: "error", message: "Same address" });
    expect(parsed[1]).toMatchObject({ severity: "warning", message: "Low bps" });
  });
});
