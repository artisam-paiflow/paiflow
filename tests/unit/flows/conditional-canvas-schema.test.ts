import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import { OrdinaryFlowGraphSchema, OrdinaryFlowSaveSchema } from "@/lib/flows/ordinary-schema";
import { FlowGraphSchema, FlowSaveSchema } from "@/lib/flows/schema";
import { ConditionalDeploymentReviewSchema } from "@/lib/deployments/conditional-review-schema";
import {
  conditionalAcceptancePlan,
  conditionalOwner,
  conditionalPayer,
} from "@/tests/fixtures/conditional-v2-acceptance";

const legacy = {
  nodes: [{ id: "receive", type: "on_receive", config: { asset: { kind: "native" } } }],
  edges: [],
};
function draft() {
  return {
    ...legacy,
    generation: "conditional-v2",
    nodes: [
      ...legacy.nodes,
      { id: "condition", type: "condition", config: { kind: "amount_gt", amountStroops: "100" } },
    ],
    conditionalPolicies: {
      version: 2,
      nodes: [],
      condition: { nodeId: "condition", thresholdMode: "constant" },
    },
    positions: { receive: { x: 10, y: 20 } },
    notify: { mode: "off", sendTo: "" },
  };
}

describe("explicit conditional canvas generation", () => {
  it("preserves draft declarations/layout without broadening retained v1/template inputs", () => {
    const value = draft();
    expect(ConditionalCanvasSchema.parse(value)).toEqual(value);
    expect(OrdinaryFlowGraphSchema.parse(value)).toEqual(value);
    expect(OrdinaryFlowSaveSchema.parse({ name: "Conditional", graph: value }).graph).toEqual(
      value,
    );
    expect(FlowGraphSchema.safeParse(value).success).toBe(false);
    expect(FlowSaveSchema.safeParse({ name: "Conditional", graph: value }).success).toBe(false);
    expect(OrdinaryFlowGraphSchema.parse(legacy)).toEqual(FlowGraphSchema.parse(legacy));
  });
  it("allows an explicitly tagged incomplete draft without inventing a threshold declaration", () => {
    const value = {
      generation: "conditional-v2",
      nodes: [],
      edges: [],
      conditionalPolicies: { version: 2, nodes: [] },
    };
    expect(ConditionalCanvasSchema.parse(value)).toEqual(value);
    expect(FlowGraphSchema.safeParse(value).success).toBe(false);
  });
  it.each(["conditional-v1", "conditional-v3", "", 2])(
    "refuses unknown generation %s rather than stripping it",
    (generation) => {
      const value = { ...draft(), generation };
      expect(OrdinaryFlowGraphSchema.safeParse(value).success).toBe(false);
      expect(FlowGraphSchema.safeParse(value).success).toBe(false);
    },
  );
  it("refuses mixed/untagged policies, per-payment threshold and unknown declarations", () => {
    const value = draft();
    for (const bad of [
      { ...value, generation: undefined },
      { ...value, fieldPolicies: { version: 1, nodes: [] } },
      { ...value, conditionalPolicies: { ...value.conditionalPolicies, version: 1 } },
      {
        ...value,
        conditionalPolicies: {
          ...value.conditionalPolicies,
          condition: { nodeId: "condition", thresholdMode: "execution" },
        },
      },
      { ...value, conditionalPolicies: { ...value.conditionalPolicies, unknownMode: true } },
      {
        ...value,
        conditionalPolicies: {
          ...value.conditionalPolicies,
          condition: { nodeId: "missing", thresholdMode: "mutable" },
        },
      },
    ])
      expect(OrdinaryFlowGraphSchema.safeParse(bad).success).toBe(false);
    expect(
      FlowGraphSchema.safeParse({ ...legacy, conditionalPolicies: value.conditionalPolicies })
        .success,
    ).toBe(false);
  });
  it("refuses duplicate identities and policy references to nonpayment nodes", () => {
    const value = draft();
    expect(
      ConditionalCanvasSchema.safeParse({ ...value, nodes: [...value.nodes, value.nodes[0]] })
        .success,
    ).toBe(false);
    expect(
      ConditionalCanvasSchema.safeParse({
        ...value,
        conditionalPolicies: {
          ...value.conditionalPolicies,
          nodes: [
            { nodeId: "condition", kind: "pay", recipient: "constant", payoutValue: "constant" },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("refuses deferred condition kinds in the new generation", () => {
    const value = draft();
    const bad = {
      ...value,
      nodes: [
        value.nodes[0],
        {
          id: "condition",
          type: "condition",
          config: { kind: "time_after", at: "2030-01-01T00:00:00.000Z" },
        },
      ],
    };
    expect(ConditionalCanvasSchema.safeParse(bad).success).toBe(false);
  });
});

describe("original conditional deployment review", () => {
  function review() {
    const plan = conditionalAcceptancePlan();
    return {
      version: 2,
      deploymentId: "12271227-1227-4227-8227-122712271227",
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      sourceAccount: conditionalOwner,
      txHash: "ab".repeat(32),
      envelope: {
        version: 2,
        generation: "conditional-v2",
        definition: plan.definition,
        manifest: plan.manifest,
        nodes: plan.nodes,
      },
    };
  }
  it("binds full semantic construction to exact original wallet/network/hash evidence", () => {
    const value = review();
    expect(ConditionalDeploymentReviewSchema.parse(value)).toEqual(value);
    for (const key of Object.keys(value)) {
      const missing: Record<string, unknown> = { ...value };
      delete missing[key];
      expect(ConditionalDeploymentReviewSchema.safeParse(missing).success).toBe(false);
    }
    for (const bad of [
      { sourceAccount: conditionalPayer },
      { network: "mainnet" },
      { txHash: "AB".repeat(32) },
      { networkPassphrase: Networks.PUBLIC },
      { privateContact: "private" },
    ])
      expect(ConditionalDeploymentReviewSchema.safeParse({ ...value, ...bad }).success).toBe(false);
    expect(
      ConditionalDeploymentReviewSchema.safeParse({
        ...value,
        network: "mainnet",
        networkPassphrase: Networks.PUBLIC,
      }).success,
    ).toBe(true);
  });
  it("rejects missing inactive branch and semantic owner-return substitution", () => {
    const value = review();
    expect(
      ConditionalDeploymentReviewSchema.safeParse({
        ...value,
        envelope: { ...value.envelope, nodes: value.envelope.nodes.slice(0, -1) },
      }).success,
    ).toBe(false);
    const bad = structuredClone(value);
    bad.envelope.definition.owner = conditionalPayer;
    expect(ConditionalDeploymentReviewSchema.safeParse(bad).success).toBe(false);
  });
});
