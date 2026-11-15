import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  ConditionalDefinitionSchema,
  ConditionalExecutionArgumentsSchema,
  ConditionalExecutionIntentSchema,
  ConditionalMutationArgumentsSchema,
  NonnegativeStroopsSchema,
  conditionalBindingsSchema,
  conditionalExecutionArgumentsSchema,
  conditionalMutationArgumentsSchema,
  conditionalNodeOrder,
  selectConditionalBranch,
  type ConditionalDefinition,
  type ConditionalPayNode,
  type ConditionalSplitNode,
} from "@/lib/flows/conditional-v2";
import { REUSABLE_LIMITS } from "@/lib/flows/field-policies";

const wallet = (value: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, value));
const contract = (value: number) => StrKey.encodeContract(Buffer.alloc(32, value));
const owner = wallet(1),
  payer = wallet(2),
  platform = wallet(3),
  worker = wallet(4);
function pay(
  nodeId: string,
  mode: "constant" | "execution" | "mutable" = "constant",
): ConditionalPayNode {
  return {
    nodeId,
    kind: "pay",
    policy: { nodeId, kind: "pay", recipient: mode, payoutValue: "constant" },
    configuration: {
      kind: "pay",
      ...(mode === "execution" ? {} : { recipient: worker }),
      payoutValue: { kind: "full" },
    },
  };
}
function split(
  nodeId: string,
  allocationMode: "percentage" | "fixed" = "percentage",
): ConditionalSplitNode {
  return {
    nodeId,
    kind: "split",
    policy: {
      nodeId,
      kind: "split",
      allocationMode,
      rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
      additionalRecipients: "execution",
    },
    configuration: {
      kind: "split",
      configuredRows: [
        {
          rowId: "platform",
          recipient: platform,
          allocation:
            allocationMode === "percentage"
              ? { kind: "percentage", bps: 1000 }
              : { kind: "fixed", amountStroops: "10" },
        },
      ],
      additionalRecipients: [],
    },
  };
}
function definition(): ConditionalDefinition {
  return {
    version: 2,
    owner,
    assetContract: contract(1),
    root: { nodeId: "receive", minAmountStroops: "0" },
    prefix: [],
    condition: {
      nodeId: "condition",
      kind: "amount_gt",
      thresholdStroops: "100",
      thresholdMode: "constant",
    },
    trueBranch: pay("true-pay", "execution"),
    falseBranch: { kind: "return_to_owner", nodeId: "false-return" },
  };
}
function bindings(graph = definition()) {
  return conditionalNodeOrder(graph).map((nodeId, index) => ({
    nodeId,
    contractAddress: contract(index + 2),
    expectedRevision: "0",
    wasmHash: "a".repeat(64),
  }));
}
function intent(graph = definition(), amountStroops = "101") {
  return {
    version: 2,
    deploymentId: "6c1709db-ecc1-4c68-b9db-66f6f5aca2f1",
    networkPassphraseHash: "b".repeat(64),
    rootContract: contract(2),
    assetContract: graph.assetContract,
    payer,
    amountStroops,
    nonce: "c".repeat(64),
    expiresAtLedger: 1000,
    definition: graph,
    nodes: bindings(graph),
    arguments: {
      version: 2,
      inputs:
        amountStroops === "101" ? [{ kind: "pay", nodeId: "true-pay", recipient: worker }] : [],
    },
    ...selectConditionalBranch(graph, amountStroops),
  };
}

describe("conditional v2 normalized domain", () => {
  it("accepts strict normalized topology, constant defaults, and immutable owner return", () => {
    const raw = definition();
    const parsed = ConditionalDefinitionSchema.parse({
      ...raw,
      root: { nodeId: "receive" },
      condition: { nodeId: "condition", kind: "amount_lt", thresholdStroops: "0" },
    });
    expect(parsed.root.minAmountStroops).toBe("0");
    expect(parsed.condition.thresholdMode).toBe("constant");
    expect(parsed.falseBranch).toEqual({ kind: "return_to_owner", nodeId: "false-return" });
    expect(parsed.owner).not.toBe(payer);
  });
  it.each([0, 1, 3, "2", null])("rejects generation %j", (version) => {
    expect(ConditionalDefinitionSchema.safeParse({ ...definition(), version }).success).toBe(false);
  });
  it.each(["edges", "joins", "nestedCondition", "nextSteps", "extra"])(
    "rejects arbitrary topology key %s",
    (key) => {
      expect(ConditionalDefinitionSchema.safeParse({ ...definition(), [key]: [] }).success).toBe(
        false,
      );
    },
  );
  it("refuses immutable return destinations, invalid kinds, nested branches and duplicate IDs", () => {
    const graph = definition();
    for (const falseBranch of [
      { ...graph.falseBranch, recipient: payer },
      { ...graph.falseBranch, owner: payer },
      { ...graph.falseBranch, next: pay("extra") },
      { ...graph.falseBranch, kind: "hold" },
      { ...graph.falseBranch, nodeId: graph.root.nodeId },
    ])
      expect(ConditionalDefinitionSchema.safeParse({ ...graph, falseBranch }).success).toBe(false);
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        condition: { ...graph.condition, thresholdMode: "execution" },
      }).success,
    ).toBe(false);
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        condition: { ...graph.condition, kind: "amount_gte" },
      }).success,
    ).toBe(false);
  });
  it("checks policy identity, execution placeholders, row identity and constant invariants", () => {
    const graph = definition();
    const branch = pay("terminal", "execution");
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        trueBranch: { ...branch, nodeId: "other" },
      }).success,
    ).toBe(false);
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        trueBranch: { ...branch, configuration: { ...branch.configuration, recipient: payer } },
      }).success,
    ).toBe(false);
    const roster = split("terminal");
    roster.policy.rows[0]!.rowId = "changed";
    expect(ConditionalDefinitionSchema.safeParse({ ...graph, trueBranch: roster }).success).toBe(
      false,
    );
  });
  it("rejects impossible stored Split totals on either branch before route selection", () => {
    const graph = definition();
    const terminal = split("split", "fixed");
    terminal.policy.additionalRecipients = "mutable";
    terminal.configuration.configuredRows[0]!.allocation = {
      kind: "fixed",
      amountStroops: REUSABLE_LIMITS.maxStroops,
    };
    terminal.configuration.additionalRecipients = [
      { rowId: "worker", recipient: worker, allocation: { kind: "fixed", amountStroops: "1" } },
    ];
    expect(ConditionalDefinitionSchema.safeParse({ ...graph, falseBranch: terminal }).success).toBe(
      false,
    );
    const percentage = split("split");
    percentage.configuration.configuredRows[0]!.allocation = { kind: "percentage", bps: 10000 };
    percentage.policy.rows.push({
      rowId: "required",
      recipient: "execution",
      allocation: "execution",
    });
    percentage.configuration.configuredRows.push({ rowId: "required" });
    expect(
      ConditionalDefinitionSchema.safeParse({ ...graph, falseBranch: percentage }).success,
    ).toBe(false);
  });
  it("bounds total graph nodes including both branches and condition", () => {
    const graph = definition();
    const prefix = Array.from({ length: 36 }, (_, index) => ({
      ...pay(`pay-${index}`),
      configuration: {
        kind: "pay" as const,
        recipient: worker,
        payoutValue: { kind: "fixed" as const, amountStroops: "1" },
      },
    }));
    expect(ConditionalDefinitionSchema.safeParse({ ...graph, prefix }).success).toBe(true);
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        prefix: [...prefix, { ...prefix[0], nodeId: "extra" }],
      }).success,
    ).toBe(false);
    expect(ConditionalDefinitionSchema.safeParse({ ...graph, prefix: [pay("full")] }).success).toBe(
      false,
    );
    expect(
      ConditionalDefinitionSchema.safeParse({
        ...graph,
        prefix: [
          {
            ...pay("percentage"),
            configuration: {
              kind: "pay",
              recipient: worker,
              payoutValue: { kind: "percentage", bps: 10000 },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it.each([
    "-1",
    "00",
    "01",
    "+1",
    "1e3",
    "1.0",
    "",
    " 1",
    "1 ",
    `${BigInt(REUSABLE_LIMITS.maxStroops) + 1n}`,
    1,
    null,
  ])("rejects noncanonical or unbounded threshold %j", (value) => {
    expect(NonnegativeStroopsSchema.safeParse(value).success).toBe(false);
  });
  it.each(["0", "1", REUSABLE_LIMITS.maxStroops])("accepts threshold boundary %s", (value) => {
    expect(NonnegativeStroopsSchema.parse(value)).toBe(value);
  });
});

describe("strict routing and conserved prefix amounts", () => {
  it.each([
    ["amount_gt", "99", "false"],
    ["amount_gt", "100", "false"],
    ["amount_gt", "101", "true"],
    ["amount_lt", "99", "true"],
    ["amount_lt", "100", "false"],
    ["amount_lt", "101", "false"],
  ] as const)("%s selects %s as %s at threshold100", (kind, amount, expected) => {
    const graph = definition();
    graph.condition.kind = kind;
    expect(selectConditionalBranch(graph, amount)).toEqual({
      selectedBranch: expected,
      amountAtConditionStroops: amount,
    });
  });
  it("compares after sequential fixed and percentage deductions using integer floor", () => {
    const graph = definition();
    graph.prefix = [
      {
        ...pay("fee"),
        configuration: {
          kind: "pay",
          recipient: platform,
          payoutValue: { kind: "fixed", amountStroops: "10" },
        },
      },
      {
        ...pay("percentage"),
        configuration: {
          kind: "pay",
          recipient: platform,
          payoutValue: { kind: "percentage", bps: 1000 },
        },
      },
    ];
    expect(selectConditionalBranch(graph, "121")).toEqual({
      selectedBranch: "false",
      amountAtConditionStroops: "100",
    });
    expect(selectConditionalBranch(graph, "122")).toEqual({
      selectedBranch: "true",
      amountAtConditionStroops: "101",
    });
    expect(conditionalNodeOrder(graph)).toEqual([
      "receive",
      "fee",
      "percentage",
      "condition",
      "true-pay",
      "false-return",
    ]);
  });
  it("handles zero and i128 max thresholds without greater-than overflow adjustment", () => {
    const graph = definition();
    graph.condition.thresholdStroops = REUSABLE_LIMITS.maxStroops;
    expect(selectConditionalBranch(graph, REUSABLE_LIMITS.maxStroops).selectedBranch).toBe("false");
    graph.condition.kind = "amount_lt";
    expect(selectConditionalBranch(graph, "1").selectedBranch).toBe("true");
    expect(selectConditionalBranch(graph, REUSABLE_LIMITS.maxStroops).selectedBranch).toBe("false");
    graph.condition.thresholdStroops = "0";
    expect(selectConditionalBranch(graph, "1").selectedBranch).toBe("false");
    graph.condition.kind = "amount_gt";
    expect(selectConditionalBranch(graph, "1").selectedBranch).toBe("true");
    graph.prefix = [
      {
        ...pay("percentage"),
        configuration: {
          kind: "pay",
          recipient: platform,
          payoutValue: { kind: "percentage", bps: 9999 },
        },
      },
    ];
    expect(
      BigInt(selectConditionalBranch(graph, REUSABLE_LIMITS.maxStroops).amountAtConditionStroops),
    ).toBeGreaterThan(0n);
  });
  it("rejects zero funding, root underfunding and prefix exhaustion", () => {
    const graph = definition();
    expect(() => selectConditionalBranch(graph, "0")).toThrow();
    graph.root.minAmountStroops = "10";
    expect(() => selectConditionalBranch(graph, "9")).toThrow();
    graph.prefix = [
      {
        ...pay("fee"),
        configuration: {
          kind: "pay",
          recipient: platform,
          payoutValue: { kind: "fixed", amountStroops: "10" },
        },
      },
    ];
    expect(() => selectConditionalBranch(graph, "10")).toThrow();
  });
});

describe("selected-only inputs and complete review bindings", () => {
  it("requires selected inputs and refuses inactive, missing, duplicated and constant overrides", () => {
    const graph = definition();
    const input = { kind: "pay", nodeId: "true-pay", recipient: worker };
    const selected = conditionalExecutionArgumentsSchema(graph, "101");
    expect(selected.safeParse({ version: 2, inputs: [input] }).success).toBe(true);
    for (const inputs of [
      [],
      [input, input],
      [{ ...input, nodeId: "false-return" }],
      [{ ...input, nodeId: "unknown" }],
      [{ ...input, payoutValue: { kind: "full" } }],
    ])
      expect(selected.safeParse({ version: 2, inputs }).success).toBe(false);
    expect(
      conditionalExecutionArgumentsSchema(graph, "100").safeParse({ version: 2, inputs: [] })
        .success,
    ).toBe(true);
    expect(
      conditionalExecutionArgumentsSchema(graph, "100").safeParse({ version: 2, inputs: [input] })
        .success,
    ).toBe(false);
    expect(ConditionalExecutionArgumentsSchema.safeParse({ version: 1, inputs: [] }).success).toBe(
      false,
    );
    expect(
      ConditionalExecutionArgumentsSchema.safeParse({
        version: 2,
        inputs: [],
        selectedBranch: "false",
      }).success,
    ).toBe(false);
    graph.trueBranch = pay("true-pay");
    expect(
      conditionalExecutionArgumentsSchema(graph, "101").safeParse({ version: 2, inputs: [input] })
        .success,
    ).toBe(false);
  });
  it("requires canonical prefix/selected node and configured-row input order", () => {
    const graph = definition();
    const fee = pay("fee", "execution");
    fee.configuration.payoutValue = { kind: "fixed", amountStroops: "1" };
    graph.prefix = [fee];
    const input = { kind: "pay", nodeId: "true-pay", recipient: worker },
      prefix = { kind: "pay", nodeId: "fee", recipient: platform };
    const schema = conditionalExecutionArgumentsSchema(graph, "102");
    expect(schema.safeParse({ version: 2, inputs: [prefix, input] }).success).toBe(true);
    expect(schema.safeParse({ version: 2, inputs: [input, prefix] }).success).toBe(false);
    graph.trueBranch = {
      kind: "split",
      nodeId: "split",
      policy: {
        kind: "split",
        nodeId: "split",
        allocationMode: "percentage",
        rows: ["a", "b"].map((rowId) => ({
          rowId,
          recipient: "execution",
          allocation: "constant",
        })),
        additionalRecipients: "constant",
      },
      configuration: {
        kind: "split",
        configuredRows: ["a", "b"].map((rowId) => ({
          rowId,
          allocation: { kind: "percentage", bps: 5000 },
        })),
        additionalRecipients: [],
      },
    };
    const rowInput = {
      kind: "split",
      nodeId: "split",
      rows: [
        { rowId: "b", recipient: worker },
        { rowId: "a", recipient: payer },
      ],
    };
    expect(
      conditionalExecutionArgumentsSchema(graph, "102").safeParse({
        version: 2,
        inputs: [prefix, rowInput],
      }).success,
    ).toBe(false);
  });
  it("checks final percentages, unique recipients and exact execution-aware fixed funding", () => {
    const graph = definition();
    graph.trueBranch = split("split");
    const args = {
      version: 2,
      inputs: [
        {
          kind: "split",
          nodeId: "split",
          rows: [],
          additionalRecipients: [
            { rowId: "worker", recipient: worker, allocation: { kind: "percentage", bps: 9000 } },
          ],
        },
      ],
    };
    expect(conditionalExecutionArgumentsSchema(graph, "101").safeParse(args).success).toBe(true);
    const wrongTotal = structuredClone(args);
    wrongTotal.inputs[0]!.additionalRecipients[0]!.allocation.bps = 8999;
    expect(conditionalExecutionArgumentsSchema(graph, "101").safeParse(wrongTotal).success).toBe(
      false,
    );
    const duplicateRecipient = structuredClone(args);
    duplicateRecipient.inputs[0]!.additionalRecipients[0]!.recipient = platform;
    expect(
      conditionalExecutionArgumentsSchema(graph, "101").safeParse(duplicateRecipient).success,
    ).toBe(false);
    graph.trueBranch = split("split", "fixed");
    for (const amountStroops of ["90", "91", "92"]) {
      const fixedArgs = {
        version: 2,
        inputs: [
          {
            kind: "split",
            nodeId: "split",
            rows: [],
            additionalRecipients: [
              { rowId: "worker", recipient: worker, allocation: { kind: "fixed", amountStroops } },
            ],
          },
        ],
      };
      expect(conditionalExecutionArgumentsSchema(graph, "101").safeParse(fixedArgs).success).toBe(
        amountStroops === "91",
      );
    }
  });
  it("preserves constant-only fixed Split accumulation while refusing terminal Pay underfunding", () => {
    const graph = definition();
    const terminal = split("split", "fixed");
    terminal.policy.additionalRecipients = "constant";
    terminal.configuration.configuredRows[0]!.allocation = { kind: "fixed", amountStroops: "200" };
    graph.trueBranch = terminal;
    expect(
      conditionalExecutionArgumentsSchema(graph, "101").safeParse({ version: 2, inputs: [] })
        .success,
    ).toBe(true);
    graph.trueBranch = {
      ...pay("pay"),
      configuration: {
        kind: "pay",
        recipient: worker,
        payoutValue: { kind: "fixed", amountStroops: "200" },
      },
    };
    expect(
      conditionalExecutionArgumentsSchema(graph, "101").safeParse({ version: 2, inputs: [] })
        .success,
    ).toBe(false);
  });
  it("includes prefix and inactive branch in complete order; forbids duplicate addresses and changed fixed revisions", () => {
    const graph = definition();
    const all = bindings(graph);
    const schema = conditionalBindingsSchema(graph);
    expect(schema.safeParse(all).success).toBe(true);
    for (const nodes of [
      all.slice(0, -1),
      [all[0], all[1], all[3], all[2]],
      [...all, all[3]],
      all.map((node) => ({ ...node, contractAddress: contract(2) })),
    ])
      expect(schema.safeParse(nodes).success).toBe(false);
    const badReturn = structuredClone(all);
    badReturn[3]!.expectedRevision = "1";
    expect(schema.safeParse(badReturn).success).toBe(false);
    const badRoot = structuredClone(all);
    badRoot[0]!.expectedRevision = "1";
    expect(schema.safeParse(badRoot).success).toBe(false);
    const badHash = structuredClone(all);
    badHash[2]!.wasmHash = "z".repeat(64);
    expect(schema.safeParse(badHash).success).toBe(false);
  });
  it("freezes amount-derived routing and binds a distinct owner rather than payer for return", () => {
    const packet = intent();
    expect(ConditionalExecutionIntentSchema.safeParse(packet).success).toBe(true);
    for (const patch of [
      { selectedBranch: "false" },
      { amountAtConditionStroops: "102" },
      { rootContract: contract(50) },
      { assetContract: contract(51) },
      { expiresAtLedger: 0 },
      { nonce: "f".repeat(63) },
      { version: 1 },
    ])
      expect(ConditionalExecutionIntentSchema.safeParse({ ...packet, ...patch }).success).toBe(
        false,
      );
    const returned = ConditionalExecutionIntentSchema.parse(intent(definition(), "100"));
    expect(returned.selectedBranch).toBe("false");
    expect(returned.definition.owner).toBe(owner);
    expect(returned.definition.owner).not.toBe(returned.payer);
    expect(returned.nodes).toHaveLength(4);
  });
});

describe("conditional grouped mutation domain", () => {
  it("permits an explicitly mutable threshold including zero and i128 max", () => {
    const graph = definition();
    graph.condition.thresholdMode = "mutable";
    for (const thresholdStroops of ["0", "1", REUSABLE_LIMITS.maxStroops])
      expect(
        conditionalMutationArgumentsSchema(graph, bindings(graph)).safeParse({
          version: 2,
          changes: [
            { kind: "condition", nodeId: "condition", expectedRevision: "0", thresholdStroops },
          ],
        }).success,
      ).toBe(true);
  });
  it("refuses immutable threshold, comparison/routing/owner overrides, noop, stale and exhausted revisions", () => {
    const graph = definition(),
      all = bindings(graph);
    const change = {
      kind: "condition",
      nodeId: "condition",
      expectedRevision: "0",
      thresholdStroops: "200",
    };
    expect(
      conditionalMutationArgumentsSchema(graph, all).safeParse({ version: 2, changes: [change] })
        .success,
    ).toBe(false);
    graph.condition.thresholdMode = "mutable";
    const schema = conditionalMutationArgumentsSchema(graph, all);
    for (const patch of [
      { thresholdStroops: "100" },
      { expectedRevision: "1" },
      { kind: "amount_lt" },
      { comparison: "amount_lt" },
      { recipient: payer },
      { nodeId: "false-return" },
      { thresholdStroops: "00" },
    ])
      expect(schema.safeParse({ version: 2, changes: [{ ...change, ...patch }] }).success).toBe(
        false,
      );
    expect(schema.safeParse({ version: 2, changes: [change, change] }).success).toBe(false);
    all[1]!.expectedRevision = REUSABLE_LIMITS.maxRevision;
    expect(
      conditionalMutationArgumentsSchema(graph, all).safeParse({
        version: 2,
        changes: [{ ...change, expectedRevision: REUSABLE_LIMITS.maxRevision }],
      }).success,
    ).toBe(false);
    expect(
      ConditionalMutationArgumentsSchema.safeParse({ version: 1, changes: [change] }).success,
    ).toBe(false);
    expect(ConditionalMutationArgumentsSchema.safeParse({ version: 2, changes: [] }).success).toBe(
      false,
    );
  });
  it("validates eligible Pay changes on either branch and rejects constants, modes and noops", () => {
    const graph = definition();
    graph.trueBranch = pay("true-pay", "mutable");
    graph.falseBranch = pay("false-pay", "mutable");
    const schema = conditionalMutationArgumentsSchema(graph, bindings(graph));
    const changes = ["true-pay", "false-pay"].map((nodeId) => ({
      kind: "pay",
      nodeId,
      expectedRevision: "0",
      recipient: payer,
    }));
    expect(schema.safeParse({ version: 2, changes }).success).toBe(true);
    expect(
      schema.safeParse({ version: 2, changes: [{ ...changes[0], recipient: worker }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        version: 2,
        changes: [{ ...changes[0], payoutValue: { kind: "fixed", amountStroops: "1" } }],
      }).success,
    ).toBe(false);
    expect(graph.trueBranch.configuration.recipient).toBe(worker);
  });
  it("merges whole Split groups atomically and preserves configured row identities and totals", () => {
    const graph = definition();
    graph.trueBranch = {
      kind: "split",
      nodeId: "split",
      policy: {
        kind: "split",
        nodeId: "split",
        allocationMode: "percentage",
        rows: ["a", "b"].map((rowId) => ({ rowId, recipient: "constant", allocation: "mutable" })),
        additionalRecipients: "constant",
      },
      configuration: {
        kind: "split",
        configuredRows: [
          { rowId: "a", recipient: platform, allocation: { kind: "percentage", bps: 1000 } },
          { rowId: "b", recipient: worker, allocation: { kind: "percentage", bps: 9000 } },
        ],
        additionalRecipients: [],
      },
    };
    graph.condition.thresholdMode = "mutable";
    const schema = conditionalMutationArgumentsSchema(graph, bindings(graph));
    const change = {
      kind: "split",
      nodeId: "split",
      expectedRevision: "0",
      rows: [
        { rowId: "a", allocation: { kind: "percentage", bps: 2000 } },
        { rowId: "b", allocation: { kind: "percentage", bps: 8000 } },
      ],
    };
    expect(
      schema.safeParse({
        version: 2,
        changes: [
          {
            kind: "condition",
            nodeId: "condition",
            expectedRevision: "0",
            thresholdStroops: "200",
          },
          change,
        ],
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ version: 2, changes: [{ ...change, rows: change.rows.slice(0, 1) }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        version: 2,
        changes: [
          {
            ...change,
            rows: [{ rowId: "unknown", allocation: { kind: "percentage", bps: 10000 } }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(graph.condition.thresholdStroops).toBe("100");
  });
});
