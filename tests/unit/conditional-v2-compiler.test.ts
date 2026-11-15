import { describe, expect, it } from "vitest";
import {
  ConditionalGraphManifestSchema,
  compileConditionalPipeline,
} from "@/lib/flows/conditional-v2-compiler";
import { conditionalNodeOrder } from "@/lib/flows/conditional-v2";
import {
  conditionalAcceptanceDefinition,
  conditionalAcceptancePlan,
  conditionalAcceptanceScenarios,
  conditionalOwner,
} from "@/tests/fixtures/conditional-v2-acceptance";

describe("isolated conditional-v2 compiler", () => {
  it.each(conditionalAcceptanceScenarios)(
    "compiles both branches for $name in complete canonical order",
    (scenario) => {
      const plan = conditionalAcceptancePlan(scenario.definition);
      expect(plan.nodes.map((node) => node.nodeId)).toEqual([
        "receive",
        "fee",
        "condition",
        "yes",
        "no",
      ]);
      expect(plan.nodes.map((node) => node.nodeId)).toEqual(
        conditionalNodeOrder(scenario.definition),
      );
      expect(plan.nodes[0]!.templateKind).toBe("DEPOSIT_TRIGGER");
      expect(plan.nodes[2]!.templateKind).toBe("ROUTER");
      expect(plan.manifest.nodes.map((node) => node.state.revision)).toEqual([
        "0",
        "0",
        "0",
        "0",
        "0",
      ]);
      expect(plan.manifest.nodes.map((node) => node.wasmHash)).toEqual(
        plan.bindings.map((binding) => binding.wasmHash),
      );
      expect(plan.nodes[2]!.initialState.nextContracts).toEqual([
        plan.bindings[3]!.contractAddress,
        plan.bindings[4]!.contractAddress,
      ]);
      for (const node of plan.nodes.slice(3)) {
        expect(node.initialState.parentContract).toBe(plan.bindings[2]!.contractAddress);
        expect(node.initialState.nextContracts).toEqual([]);
      }
    },
  );
  it("retains authored owner-return semantics despite lowering to PAYER", () => {
    const plan = conditionalAcceptancePlan();
    const returned = plan.nodes[4]!;
    expect(returned.templateKind).toBe("PAYER");
    expect(returned.implementation).toEqual({
      version: 1,
      bindings: [{ blockId: "no", blockType: "return_to_owner", role: "action" }],
    });
    expect(returned.initialState.configuration).toEqual({
      kind: "return_to_owner",
      recipient: conditionalOwner,
    });
    expect(plan.manifest.admin).toBe(conditionalOwner);
  });
  it.each(["stale", "missing-inactive", "duplicate-address", "reordered", "extra"])(
    "refuses %s initial bindings",
    (attack) => {
      const plan = conditionalAcceptancePlan();
      const nodes = structuredClone(plan.bindings);
      if (attack === "stale") nodes[3]!.expectedRevision = "1";
      if (attack === "missing-inactive") nodes.pop();
      if (attack === "duplicate-address") nodes[4]!.contractAddress = nodes[3]!.contractAddress;
      if (attack === "reordered") [nodes[3], nodes[4]] = [nodes[4]!, nodes[3]!];
      if (attack === "extra") nodes.push({ ...nodes[4]!, nodeId: "extra" });
      expect(() => compileConditionalPipeline(plan.definition, nodes)).toThrow();
    },
  );
  it.each([
    "root",
    "asset",
    "admin",
    "inactive-parent",
    "reversed-branches",
    "state-revision",
    "state-extra-key",
    "family",
    "missing-condition",
  ])("rejects %s immutable manifest corruption", (attack) => {
    const plan = conditionalAcceptancePlan();
    const manifest = structuredClone(plan.manifest);
    if (attack === "root") manifest.rootContract = manifest.nodes[1]!.state.contractAddress;
    if (attack === "asset")
      manifest.nodes[4]!.state.assetContract = manifest.nodes[0]!.state.contractAddress;
    if (attack === "admin")
      manifest.nodes[4]!.state.admin = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    if (attack === "inactive-parent")
      manifest.nodes[4]!.state.parentContract = manifest.nodes[3]!.state.contractAddress;
    if (attack === "reversed-branches") manifest.nodes[2]!.state.nextContracts.reverse();
    if (attack === "state-revision") manifest.nodes[3]!.state.revision = "1";
    if (attack === "state-extra-key") Object.assign(manifest.nodes[3]!.state, { upgrade: true });
    if (attack === "family")
      manifest.nodes[3]!.state.configuration = manifest.nodes[2]!.state.configuration;
    if (attack === "missing-condition") manifest.nodes.splice(2, 1);
    expect(ConditionalGraphManifestSchema.safeParse(manifest).success).toBe(false);
  });
  it("retains explicit threshold zero/max and avoids legacy greater-than adjustment", () => {
    for (const thresholdStroops of ["0", (2n ** 127n - 1n).toString()]) {
      const graph = conditionalAcceptanceDefinition();
      graph.condition.thresholdStroops = thresholdStroops;
      const plan = conditionalAcceptancePlan(graph);
      expect(plan.nodes[2]!.initialState.configuration).toMatchObject({
        comparison: "amount_gt",
        thresholdStroops,
      });
    }
  });
  it("never mutates caller definition or binding evidence", () => {
    const base = conditionalAcceptancePlan();
    const plan = compileConditionalPipeline(base.definition, base.bindings);
    plan.definition.condition.thresholdStroops = "200";
    plan.bindings[2]!.expectedRevision = "1";
    expect(base.definition.condition.thresholdStroops).toBe("100");
    expect(base.bindings[2]!.expectedRevision).toBe("0");
  });
});
