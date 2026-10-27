import "@/instrumentation-client";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

describe("browser schema startup", () => {
  it("disables runtime code generation before object parsing", () => {
    expect(z.config().jitless).toBe(true);
    const probe = vi.spyOn(globalThis, "Function").mockImplementation(() => {
      throw new Error("Runtime code generation is forbidden by CSP");
    });
    try {
      const schema = z.object({ label: z.string().min(1) });
      expect(schema.parse({ label: "ready" })).toEqual({ label: "ready" });
      expect(schema.safeParse({ label: 1 }).success).toBe(false);
      expect(probe).not.toHaveBeenCalled();
    } finally {
      probe.mockRestore();
    }
  });
});
