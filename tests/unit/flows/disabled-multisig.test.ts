import { describe, expect, it } from "vitest";
import { ALL_FEATURES_ON } from "@/lib/feature-flags";
import { assertNoHiddenSurfaces, assertPreparedDeploymentAllowed } from "@/lib/features";
import { validateFlow } from "@/lib/flows/validate";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { hasDisabledMultisigInput } from "@/lib/flows/disabled-multisig";
import { instanceDefinition } from "@/tests/fixtures/instance-acceptance";

describe("Multisig release exclusion", () => {
  const graph = instanceDefinition("multisig").graph;
  it("keeps historical definitions readable while refusing new use with every switch on", () => {
    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
    expect(validateFlow(graph).ok).toBe(true); // Structural/compiler evidence remains readable.
    const result = validateFlow(graph, { features: ALL_FEATURES_ON });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected release exclusion");
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "FEATURE_DISABLED", nodeId: "condition" }),
    );
    expect(() => assertNoHiddenSurfaces(graph, [], ALL_FEATURES_ON)).toThrow(
      /Multisig.*unavailable/,
    );
  });
  it("rejects compiled MULTISIG even when no graph node names it", () => {
    expect(() =>
      assertNoHiddenSurfaces({ nodes: [], edges: [] }, ["PAYER", "MULTISIG"], ALL_FEATURES_ON),
    ).toThrow(/Multisig.*unavailable/);
  });
  it.each([
    [graph, [], null],
    [null, [{ templateKind: "MULTISIG" }], null],
    [{ nodes: "unparseable" }, [], [{ templateKind: "MULTISIG" }]],
    [null, null, [{ params: { kind: "multisig" } }]],
    [{ nodes: [{ type: "condition", config: { kind: "multisig" } }] }, [], null],
  ])(
    "rejects unsent snapshots without relying on successful graph parsing (%#)",
    (g, p, params) => {
      expect(() => assertPreparedDeploymentAllowed(g, p, ALL_FEATURES_ON, params)).toThrow(
        /Multisig.*unavailable/,
      );
    },
  );
  it.each(["immediate", "schedule", "subscription", "time-condition"] as const)(
    "keeps enabled %s definitions eligible",
    (kind) => {
      const enabled = instanceDefinition(kind).graph;
      // The schedule fixture's old date is irrelevant to this release guard.
      expect(() => assertNoHiddenSurfaces(enabled, [], ALL_FEATURES_ON)).not.toThrow();
      expect(() => assertPreparedDeploymentAllowed(enabled, [], ALL_FEATURES_ON)).not.toThrow();
    },
  );
  it("ignores names/labels and handles cyclic original snapshots safely", () => {
    const harmless = { label: "multisig", name: "MULTISIG", child: {} };
    harmless.child = harmless;
    expect(hasDisabledMultisigInput(harmless)).toBe(false);
    expect(hasDisabledMultisigInput({ ...harmless, params: { kind: "multisig" } })).toBe(true);
  });
});
