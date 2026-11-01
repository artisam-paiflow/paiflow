import { describe, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  ArtifactCapabilitiesSchema,
  ConfigurationRevisionSchema,
  ConfirmedNodeConfigurationSchema,
  CreationBindingsSchema,
  ExecutionArgumentsSchema,
  ExecutionIntentSchema,
  FlowFieldPoliciesSchema,
  MutationArgumentsSchema,
  REUSABLE_LIMITS,
  StroopsSchema,
  executionArgumentsSchema,
} from "@/lib/flows/field-policies";
import { FlowGraphSchema, FlowSaveSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";

const alice = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const bob = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 3));
const asset = { kind: "native" };
const graph = {
  nodes: [
    { id: "start", type: "on_receive", config: { asset } },
    {
      id: "pay",
      type: "pay",
      config: { asset, recipient: alice, mode: "fixed", amountStroops: "100" },
    },
  ],
  edges: [{ id: "edge", source: "start", target: "pay" }],
};
const payPolicies = (recipient = "execution", payoutValue = "constant") => ({
  version: 1,
  nodes: [{ nodeId: "pay", kind: "pay", recipient, payoutValue }],
});
const splitPolicy = {
  nodeId: "split",
  kind: "split",
  allocationMode: "percentage",
  rows: [
    { rowId: "platform" },
    { rowId: "worker", recipient: "execution", allocation: "execution" },
  ],
  additionalRecipients: "execution",
};
const splitPolicies = () => FlowFieldPoliciesSchema.parse({ version: 1, nodes: [splitPolicy] });
const splitInput = () => ({
  version: 1,
  inputs: [
    {
      kind: "split",
      nodeId: "split",
      rows: [{ rowId: "worker", recipient: bob, allocation: { kind: "percentage", bps: 6000 } }],
      additionalRecipients: [
        { rowId: "extra", recipient: alice, allocation: { kind: "percentage", bps: 3000 } },
      ],
    },
  ],
});

describe("versioned lifetime field policies", () => {
  it("preserves mode-less legacy graphs without misrepresenting legacy artifacts as policy-aware", () => {
    const legacy = FlowGraphSchema.parse(graph);
    const constant = FlowGraphSchema.parse({ ...graph, fieldPolicies: payPolicies("constant") });
    expect(legacy.fieldPolicies).toBeUndefined();
    expect(validateFlow(legacy).ok).toBe(true);
    expect(validateFlow(constant).ok).toBe(true);
    expect(flowToPipeline(legacy)).toHaveLength(2);
    expect(flowToPipeline(constant)[1]?.params).toHaveProperty("fieldPolicy");
    expect(
      FlowFieldPoliciesSchema.parse({ version: 1, nodes: [{ kind: "pay", nodeId: "pay" }] })
        .nodes[0],
    ).toMatchObject({ recipient: "constant", payoutValue: "constant" });
  });
  it.each(["execution", "mutable"])(
    "preserves %s policies and only compiles implemented execution semantics",
    (mode) => {
      const saved = FlowSaveSchema.parse({
        name: "Draft",
        graph: { ...graph, fieldPolicies: payPolicies(mode) },
      });
      expect(saved.graph.fieldPolicies?.nodes[0]).toMatchObject({ recipient: mode });
      const result = validateFlow(saved.graph);
      expect(result.ok).toBe(mode === "execution");
      if (!result.ok)
        expect(result.errors).toContainEqual(
          expect.objectContaining({ code: "FIELD_POLICY_UNSUPPORTED" }),
        );
      if (mode === "mutable") expect(() => flowToPipeline(saved.graph)).toThrow("not implemented");
      else
        expect(flowToPipeline(saved.graph)[1]?.params).toHaveProperty(
          "fieldPolicy.recipient",
          "execution",
        );
    },
  );
  it.each([
    { version: 2, nodes: [] },
    { version: 1, nodes: [], future: true },
    payPolicies("dynamic"),
    payPolicies("constant", "execution"),
    { version: 1, nodes: [{ kind: "pay", nodeId: "pay", asset: "mutable" }] },
    { version: 1, nodes: [{ kind: "schedule", nodeId: "start" }] },
    { version: 1, nodes: [payPolicies().nodes[0], payPolicies().nodes[0]] },
  ])(
    "rejects unknown/unsupported declarations before they can strip to constants: %j",
    (fieldPolicies) => {
      expect(FlowGraphSchema.safeParse({ ...graph, fieldPolicies }).success).toBe(false);
    },
  );
  it("rejects wrong target, duplicate graph IDs and irrelevant full-amount mutation", () => {
    expect(
      FlowGraphSchema.safeParse({
        ...graph,
        fieldPolicies: { version: 1, nodes: [{ kind: "pay", nodeId: "start" }] },
      }).success,
    ).toBe(false);
    expect(
      FlowGraphSchema.safeParse({ ...graph, nodes: [...graph.nodes, graph.nodes[1]] }).success,
    ).toBe(false);
    expect(
      FlowGraphSchema.safeParse({
        ...graph,
        nodes: [
          graph.nodes[0],
          { ...graph.nodes[1], config: { asset, recipient: alice, fullAmount: true } },
        ],
        fieldPolicies: payPolicies("constant", "mutable"),
      }).success,
    ).toBe(false);
  });
  it("binds Split constant row membership and order to configured IDs and mode", () => {
    const g = {
      ...graph,
      nodes: [
        graph.nodes[0],
        {
          id: "split",
          type: "split",
          config: {
            asset,
            recipients: [
              { rowId: "platform", address: alice, mode: "percentage", bps: 1000 },
              { rowId: "worker", address: bob, mode: "percentage", bps: 9000 },
            ],
          },
        },
      ],
      fieldPolicies: { version: 1, nodes: [splitPolicy] },
    };
    expect(FlowGraphSchema.safeParse(g).success).toBe(true);
    for (const rows of [
      splitPolicy.rows.slice(1),
      [...splitPolicy.rows].reverse(),
      [splitPolicy.rows[0], splitPolicy.rows[0]],
    ]) {
      expect(
        FlowGraphSchema.safeParse({
          ...g,
          fieldPolicies: { version: 1, nodes: [{ ...splitPolicy, rows }] },
        }).success,
      ).toBe(false);
    }
    expect(
      FlowGraphSchema.safeParse({
        ...g,
        fieldPolicies: { version: 1, nodes: [{ ...splitPolicy, allocationMode: "fixed" }] },
      }).success,
    ).toBe(false);
  });
  it("rejects mixed execution and mutable allocation-group authorities", () => {
    expect(
      FlowFieldPoliciesSchema.safeParse({
        version: 1,
        nodes: [{ ...splitPolicy, additionalRecipients: "mutable" }],
      }).success,
    ).toBe(false);
  });
});

describe("execution inputs are complete and cannot override constants", () => {
  it("accepts constant platform row plus an execution worker and variable roster", () => {
    expect(executionArgumentsSchema(splitPolicies()).safeParse(splitInput()).success).toBe(true);
  });
  it("requires declared Pay recipient without saved-value fallback", () => {
    const schema = executionArgumentsSchema(FlowFieldPoliciesSchema.parse(payPolicies()));
    expect(schema.safeParse({ version: 1, inputs: [] }).success).toBe(false);
    expect(
      schema.safeParse({ version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: bob }] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        version: 1,
        inputs: [{ kind: "pay", nodeId: "pay", recipient: bob, amountStroops: "1" }],
      }).success,
    ).toBe(false);
  });
  it("refuses execution arguments for constant or mutable recipients", () => {
    for (const mode of ["constant", "mutable"]) {
      const schema = executionArgumentsSchema(FlowFieldPoliciesSchema.parse(payPolicies(mode)));
      expect(
        schema.safeParse({ version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: bob }] })
          .success,
      ).toBe(false);
    }
  });
  it("rejects missing, irrelevant, duplicate and constant-override Split inputs", () => {
    const schema = executionArgumentsSchema(splitPolicies());
    const base = splitInput().inputs[0]!;
    const variants = [
      { ...base, nodeId: "unknown" },
      { ...base, rows: [] },
      { ...base, rows: [{ rowId: "worker", recipient: bob }] },
      { ...base, rows: [{ rowId: "platform", recipient: bob }] },
      { ...base, rows: [...base.rows, ...base.rows] },
      { ...base, additionalRecipients: undefined },
      { ...base, additionalRecipients: [{ ...base.additionalRecipients[0], rowId: "platform" }] },
      {
        ...base,
        rows: [
          { rowId: "worker", recipient: bob, allocation: { kind: "fixed", amountStroops: "100" } },
        ],
      },
      {
        ...base,
        rows: [
          {
            rowId: "worker",
            recipient: "PENDING:bob",
            allocation: { kind: "percentage", bps: 9000 },
          },
        ],
      },
    ];
    for (const input of variants)
      expect(schema.safeParse({ version: 1, inputs: [input] }).success).toBe(false);
    expect(schema.safeParse({ version: 1, inputs: [base, base] }).success).toBe(false);
  });
  it("requires separately declared recipient and allocation fields only", () => {
    const policy = FlowFieldPoliciesSchema.parse({
      version: 1,
      nodes: [
        {
          ...splitPolicy,
          rows: [{ rowId: "worker", recipient: "execution" }],
          additionalRecipients: "constant",
        },
      ],
    });
    const schema = executionArgumentsSchema(policy);
    expect(
      schema.safeParse({
        version: 1,
        inputs: [{ kind: "split", nodeId: "split", rows: [{ rowId: "worker", recipient: bob }] }],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        version: 1,
        inputs: [
          {
            kind: "split",
            nodeId: "split",
            rows: [
              { rowId: "worker", recipient: bob, allocation: { kind: "percentage", bps: 10000 } },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("enforces the combined fixed and additional row resource limit", () => {
    const input = splitInput();
    input.inputs[0]!.additionalRecipients = Array.from({ length: 19 }, (_, i) => ({
      rowId: `extra${i}`,
      recipient: alice,
      allocation: { kind: "percentage", bps: 1 },
    }));
    expect(executionArgumentsSchema(splitPolicies()).safeParse(input).success).toBe(false);
  });
  it("supports fixed allocations without accepting fractional or numeric money", () => {
    const policies = FlowFieldPoliciesSchema.parse({
      version: 1,
      nodes: [{ ...splitPolicy, allocationMode: "fixed" }],
    });
    const input = {
      version: 1,
      inputs: [
        {
          kind: "split",
          nodeId: "split",
          rows: [
            {
              rowId: "worker",
              recipient: bob,
              allocation: { kind: "fixed", amountStroops: "9007199254740993" },
            },
          ],
          additionalRecipients: [],
        },
      ],
    };
    expect(executionArgumentsSchema(policies).safeParse(input).success).toBe(true);
    for (const value of ["1.1", "-1", "01", "0", 100, "9".repeat(100)])
      expect(StroopsSchema.safeParse(value).success).toBe(false);
    expect(StroopsSchema.parse(REUSABLE_LIMITS.maxStroops)).toBe(REUSABLE_LIMITS.maxStroops);
    expect(
      StroopsSchema.safeParse((BigInt(REUSABLE_LIMITS.maxStroops) + 1n).toString()).success,
    ).toBe(false);
  });
});

describe("distinct immutable intents, creation bindings and stored mutations", () => {
  const intent = () => ({
    version: 1,
    deploymentId: "00000000-0000-4000-8000-000000000001",
    networkPassphraseHash: "a".repeat(64),
    rootContract: contract,
    assetContract: contract,
    payer: alice,
    amountStroops: "100",
    nonce: "b".repeat(64),
    expiresAtLedger: 500,
    nodes: [{ nodeId: "pay", contractAddress: contract, expectedRevision: "0" }],
    arguments: { version: 1, inputs: [{ kind: "pay", nodeId: "pay", recipient: bob }] },
  });
  it("requires payer, contract, amount, expiry and revision bindings without coercion", () => {
    expect(ExecutionIntentSchema.safeParse(intent()).success).toBe(true);
    for (const key of ["payer", "amountStroops", "nonce", "expiresAtLedger", "nodes"]) {
      const value: Record<string, unknown> = { ...intent() };
      delete value[key];
      expect(ExecutionIntentSchema.safeParse(value).success).toBe(false);
    }
    expect(ExecutionIntentSchema.safeParse({ ...intent(), nodes: [] }).success).toBe(false);
    expect(
      ExecutionIntentSchema.safeParse({
        ...intent(),
        nodes: [...intent().nodes, ...intent().nodes],
      }).success,
    ).toBe(false);
    expect(
      ExecutionIntentSchema.safeParse({
        ...intent(),
        nodes: [{ ...intent().nodes[0], nodeId: "other" }],
      }).success,
    ).toBe(false);
    expect(ConfigurationRevisionSchema.parse(REUSABLE_LIMITS.maxRevision)).toBe(
      REUSABLE_LIMITS.maxRevision,
    );
    expect(
      ConfigurationRevisionSchema.safeParse((BigInt(REUSABLE_LIMITS.maxRevision) + 1n).toString())
        .success,
    ).toBe(false);
  });
  it("does not confuse creation bindings or mutations with execution arguments", () => {
    const bindings = {
      version: 1,
      templateVersionId: intent().deploymentId,
      values: [{ inputId: "customer", value: { type: "wallet", value: alice } }],
    };
    const mutation = {
      version: 1,
      changes: [
        {
          kind: "pay",
          nodeId: "pay",
          expectedRevision: "1",
          payoutValue: { kind: "fixed", amountStroops: "200" },
        },
      ],
    };
    expect(CreationBindingsSchema.safeParse(bindings).success).toBe(true);
    expect(MutationArgumentsSchema.safeParse(mutation).success).toBe(true);
    expect(ExecutionArgumentsSchema.safeParse(bindings).success).toBe(false);
    expect(ExecutionArgumentsSchema.safeParse(mutation).success).toBe(false);
    expect(
      CreationBindingsSchema.safeParse({
        ...bindings,
        values: [...bindings.values, ...bindings.values],
      }).success,
    ).toBe(false);
    expect(
      MutationArgumentsSchema.safeParse({
        ...mutation,
        changes: [{ ...mutation.changes[0], asset: contract }],
      }).success,
    ).toBe(false);
    expect(MutationArgumentsSchema.safeParse({ version: 1, changes: [] }).success).toBe(false);
    const duplicateRow = { rowId: "worker", recipient: bob };
    expect(
      MutationArgumentsSchema.safeParse({
        version: 1,
        changes: [
          {
            kind: "split",
            nodeId: "split",
            expectedRevision: "0",
            rows: [duplicateRow, duplicateRow],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("distinguishes legacy, execution-only and mutation-capable pinned artifacts", () => {
    const legacy = {
      policyVersion: 0,
      wasmHash: "a".repeat(64),
      execution: false,
      mutation: false,
    };
    expect(ArtifactCapabilitiesSchema.safeParse(legacy).success).toBe(true);
    expect(ArtifactCapabilitiesSchema.safeParse({ ...legacy, execution: true }).success).toBe(
      false,
    );
    const current = {
      ...legacy,
      policyVersion: 1,
      execution: true,
      immutablePolicies: true,
      revisionBinding: true,
      executionAbi: 1,
    };
    expect(ArtifactCapabilitiesSchema.safeParse(current).success).toBe(true);
    expect(ArtifactCapabilitiesSchema.safeParse({ ...current, mutation: true }).success).toBe(true);
    expect(
      ArtifactCapabilitiesSchema.safeParse({ ...current, revisionBinding: false }).success,
    ).toBe(false);
    expect(ArtifactCapabilitiesSchema.safeParse({ ...current, policyVersion: 2 }).success).toBe(
      false,
    );
  });
});

describe("confirmed configuration getters", () => {
  const envelope = {
    version: 1,
    nodeId: "pay",
    contractAddress: contract,
    confirmedLedger: 500,
    revision: "0",
  };
  it("does not materialize an execution recipient as a saved default", () => {
    const policy = FlowFieldPoliciesSchema.parse(payPolicies()).nodes[0];
    const configuration = { kind: "pay", payoutValue: { kind: "fixed", amountStroops: "100" } };
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({ ...envelope, policy, configuration }).success,
    ).toBe(true);
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({
        ...envelope,
        policy,
        configuration: { ...configuration, recipient: alice },
      }).success,
    ).toBe(false);
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({
        ...envelope,
        nodeId: "wrong",
        policy,
        configuration,
      }).success,
    ).toBe(false);
  });
  it("checks stored Split fields against policy and requires absent execution values", () => {
    const policy = splitPolicies().nodes[0];
    const configuration = {
      kind: "split",
      configuredRows: [
        { rowId: "platform", recipient: alice, allocation: { kind: "percentage", bps: 1000 } },
        { rowId: "worker" },
      ],
      additionalRecipients: [],
    };
    const snapshot = { ...envelope, nodeId: "split", policy, configuration };
    expect(ConfirmedNodeConfigurationSchema.safeParse(snapshot).success).toBe(true);
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({
        ...snapshot,
        configuration: {
          ...configuration,
          configuredRows: [...configuration.configuredRows].reverse(),
        },
      }).success,
    ).toBe(false);
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({
        ...snapshot,
        configuration: {
          ...configuration,
          additionalRecipients: splitInput().inputs[0]!.additionalRecipients,
        },
      }).success,
    ).toBe(false);
    const constantPolicy = {
      ...splitPolicy,
      rows: [{ rowId: "platform" }],
      additionalRecipients: "constant",
    };
    expect(
      ConfirmedNodeConfigurationSchema.safeParse({
        ...snapshot,
        policy: constantPolicy,
        configuration: { ...configuration, configuredRows: [configuration.configuredRows[0]] },
      }).success,
    ).toBe(false);
  });
});
