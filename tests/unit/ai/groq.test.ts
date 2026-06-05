import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/log", () => ({
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

import { stripNulls } from "@/lib/ai/groq";

describe("stripNulls", () => {
  it("removes null keys from objects (regression: clarifyingQuestion: null)", () => {
    const input = {
      mode: "patch",
      explanation: "I need more info",
      patch: [],
      clarifyingQuestion: null,
    };
    const result = stripNulls(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty("clarifyingQuestion");
    expect(result.mode).toBe("patch");
  });

  it("passes valid string clarifyingQuestion through unchanged", () => {
    const input = {
      mode: "patch",
      explanation: "Which recipient?",
      patch: [],
      clarifyingQuestion: "Should I split to Bob or Jack?",
    };
    const result = stripNulls(input) as Record<string, unknown>;
    expect(result.clarifyingQuestion).toBe("Should I split to Bob or Jack?");
  });

  it("preserves array shape when element is null (patch: [null])", () => {
    const input = { patch: [null] };
    const result = stripNulls(input) as { patch: unknown[] };
    expect(Array.isArray(result.patch)).toBe(true);
    expect(result.patch).toHaveLength(1);
    expect(result.patch[0]).toBeUndefined();
  });

  it("preserves partial valid arrays with some null elements", () => {
    const validOp = { op: "addNode", node: { id: "n1" }, edge: null };
    const input = { op: "updateNode", patch: [validOp, null] };
    const result = stripNulls(input) as { patch: unknown[] };
    // validOp has edge: null which becomes undefined and is stripped from the object
    expect(result.patch).toHaveLength(2);
    expect(result.patch[1]).toBeUndefined();
  });

  it("strips nested null values from objects", () => {
    const input = { config: { address: null, asset: { kind: "native" } } };
    const result = stripNulls(input) as { config: Record<string, unknown> };
    expect(result.config).not.toHaveProperty("address");
    expect(result.config.asset).toEqual({ kind: "native" });
  });

  it("passes a valid full response through unchanged", () => {
    const input = {
      mode: "patch",
      explanation: "Updated the split to 50/50",
      patch: [
        {
          op: "updateNode",
          id: "a",
          config: {
            recipients: [
              { address: "GB...", bps: 5000 },
              { address: "GA...", bps: 5000 },
            ],
          },
        },
      ],
    };
    expect(stripNulls(input)).toEqual(input);
  });

  it("converts top-level null to undefined", () => {
    expect(stripNulls(null)).toBeUndefined();
  });

  it("handles deeply nested mixed nulls and values", () => {
    const input = {
      a: null,
      b: { c: null, d: { e: null, f: "keep" } },
      g: [null, { h: null }],
    };
    const result = stripNulls(input) as Record<string, unknown>;
    expect(result).not.toHaveProperty("a");
    expect(result.b as Record<string, unknown>).not.toHaveProperty("c");
    expect((result.b as Record<string, unknown>).d as Record<string, unknown>).toEqual({
      f: "keep",
    });
    expect(result.g).toHaveLength(2);
    expect((result.g as unknown[])[0]).toBeUndefined();
    expect((result.g as unknown[])[1]).toEqual({});
  });

  it("passes primitives through unchanged", () => {
    expect(stripNulls("hello")).toBe("hello");
    expect(stripNulls(42)).toBe(42);
    expect(stripNulls(true)).toBe(true);
    expect(stripNulls([1, 2, 3])).toEqual([1, 2, 3]);
  });
});
