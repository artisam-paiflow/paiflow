import { randomUUID } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { bindTemplateVersion, validateTemplateDefinition } from "@/lib/flow-templates/binder";
import {
  CreateFlowTemplateSchema,
  TemplateDefinitionSchema,
  UpdateFlowTemplateSchema,
  PublishFlowTemplateSchema,
  RetireFlowTemplateSchema,
  FlowTemplateListQuerySchema,
  TemplateArtifactsSchema,
  type CreationDeclaration,
  type TemplateDefinition,
} from "@/lib/flow-templates/schema";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import type { CreationValue } from "@/lib/flows/field-policies";
import { flowToPipeline } from "@/lib/flows/to-params";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const C = Keypair.random().publicKey();
const asset = { kind: "native" } as const;
const versionId = randomUUID();
const receive = { id: "t", type: "on_receive", config: { asset } };
const pay = {
  id: "p",
  type: "pay",
  config: { asset, recipient: A, fullAmount: false, mode: "fixed", amountStroops: "100" },
};
function graph(nodes: unknown[]): FlowGraph {
  const edges = nodes.slice(1).map((_, index) => ({
    id: `e${index}`,
    source: (nodes[index] as { id: string }).id,
    target: (nodes[index + 1] as { id: string }).id,
  }));
  const condition = nodes.find((node) => (node as { type: string }).type === "condition") as
    | { id: string; config: { kind: string } }
    | undefined;
  const branch =
    condition?.config.kind === "time_after"
      ? { id: "fallback", type: "hold", config: {} }
      : condition?.config.kind === "amount_gt"
        ? { ...pay, id: "fallback", config: { ...pay.config, recipient: B } }
        : undefined;
  return FlowGraphSchema.parse({
    nodes: branch ? [...nodes, branch] : nodes,
    edges: branch
      ? [...edges, { id: "false", source: condition!.id, target: branch.id, sourceHandle: "false" }]
      : edges,
  });
}
function input(
  field: CreationDeclaration["target"]["field"] = "recipient",
  type: CreationValue["type"] = "wallet",
  nodeId = "p",
  index?: number,
): CreationDeclaration {
  return {
    inputId: "customer",
    label: "Customer",
    target: { nodeId, field, ...(index === undefined ? {} : { index }) },
    type,
  };
}
function definition(g = graph([receive, pay]), inputs = [input()]): TemplateDefinition {
  return { schemaVersion: 1, graph: g, inputs };
}
function bindings(
  values: { inputId: string; value: CreationValue }[] = [
    { inputId: "customer", value: { type: "wallet", value: B } },
  ],
) {
  return { version: 1, templateVersionId: versionId, values };
}

function untargeted(g: FlowGraph, declaration: CreationDeclaration) {
  const copy = structuredClone(g);
  const node = copy.nodes.find((node) => node.id === declaration.target.nodeId)!;
  const config: Record<string, unknown> = node.config;
  const field = declaration.target.field;
  if (field === "signer" && node.type === "condition" && node.config.kind === "multisig")
    node.config.signers[declaration.target.index!] = "<bound>";
  else if (field.startsWith("split") && node.type === "split") {
    const row = node.config.recipients[declaration.target.index!]!;
    const record: Record<string, unknown> = row;
    delete record[
      field === "splitRecipient" ? "address" : field === "splitBps" ? "bps" : "amountStroops"
    ];
  } else
    delete config[field === "oracleKey" ? "key" : field === "percentageBps" ? "percentage" : field];
  return copy;
}

function encodedConstructors(g: FlowGraph) {
  const pipeline = flowToPipeline(g, undefined, { forValidation: true });
  const addresses = Object.fromEntries(
    pipeline.map((node, index) => [
      node.nodeId,
      StrKey.encodeContract(Buffer.alloc(32, index + 1)),
    ]),
  );
  return pipeline.map((node, index) =>
    pipelineNodeConstructorArgs(
      node.params,
      A,
      index === 0 ? undefined : addresses[pipeline[index - 1]!.nodeId],
      addresses,
    ).map((arg) => arg.toXDR("base64")),
  );
}

describe("private creation binder", () => {
  it("changes exactly a declared constant leaf without mutating the definition, routing or policies", () => {
    const original = definition();
    const copy = structuredClone(original);
    const result = bindTemplateVersion(original, versionId, bindings());
    expect(original).toEqual(copy);
    const expected = structuredClone(original.graph);
    const p = expected.nodes[1]!;
    if (p.type === "pay") p.config.recipient = B;
    expect(result.graph).toEqual(expected);
    expect(result.bindings.values).toEqual(bindings().values);
  });
  it("requires every input without implicit exemplar fallback and rejects unknown/duplicate/version-mismatched bindings", () => {
    expect(() => bindTemplateVersion(definition(), versionId, bindings([]))).toThrow(/Missing/);
    expect(() =>
      bindTemplateVersion(definition(), versionId, {
        ...bindings(),
        templateVersionId: randomUUID(),
      }),
    ).toThrow(/different/);
    expect(() =>
      bindTemplateVersion(
        definition(),
        versionId,
        bindings([{ inputId: "other", value: { type: "wallet", value: B } }]),
      ),
    ).toThrow(/Unknown/);
    expect(() =>
      bindTemplateVersion(
        definition(),
        versionId,
        bindings([...bindings().values, ...bindings().values]),
      ),
    ).toThrow(/Duplicate/);
  });
  it.each([
    { type: "text", value: B },
    { type: "wallet", value: "PENDING:customer" },
    { type: "wallet", value: Keypair.random().secret() },
    { type: "stroops", value: 100 },
  ])("rejects wrong/unsafe scalar %j", (value) => {
    expect(() =>
      bindTemplateVersion(definition(), versionId, {
        ...bindings(),
        values: [{ inputId: "customer", value }],
      }),
    ).toThrow();
  });
  it("resolves only explicit typed defaults and checks bounds without number coercion", () => {
    const amount = {
      ...input("amountStroops", "stroops"),
      defaultValue: { type: "stroops", value: "100" } as const,
      constraints: {
        min: { type: "stroops", value: "50" } as const,
        max: { type: "stroops", value: "200" } as const,
      },
    };
    const d = definition(undefined, [amount]);
    expect(bindTemplateVersion(d, versionId, bindings([])).bindings.values[0]!.value).toEqual(
      amount.defaultValue,
    );
    expect(() =>
      bindTemplateVersion(
        d,
        versionId,
        bindings([{ inputId: "customer", value: { type: "stroops", value: "201" } }]),
      ),
    ).toThrow(/maximum/);
    expect(() =>
      validateTemplateDefinition({
        ...d,
        inputs: [{ ...amount, defaultValue: { type: "stroops", value: "1" } }],
      }),
    ).toThrow(/minimum/);
    expect(() =>
      validateTemplateDefinition({
        ...d,
        inputs: [
          {
            ...amount,
            constraints: {
              min: { type: "stroops", value: "200" },
              max: { type: "stroops", value: "50" },
            },
          },
        ],
      }),
    ).toThrow(/bounds/);
  });
  it("checks defaults against the actual target schema and rejects invalid intervals at publication", () => {
    const d = definition(
      graph([
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2035-01-01T00:00:00Z",
            occurrences: 2,
          },
        },
        pay,
      ]),
      [
        {
          ...input("intervalUnit", "text", "t"),
          defaultValue: { type: "text", value: "fortnight" },
        },
      ],
    );
    expect(() => validateTemplateDefinition(d, true)).toThrow();
  });
  it.each([
    "mode",
    "fullAmount",
    "fieldPolicies",
    "__proto__",
    "asset",
    "nextStepNodeIds",
    "owner",
    "admin",
  ])("rejects structural/authority field %s", (field) => {
    expect(() =>
      validateTemplateDefinition({
        ...definition(),
        inputs: [{ ...input(), target: { nodeId: "p", field } }],
      }),
    ).toThrow();
  });
  it("rejects duplicate declarations/targets including reordered target keys and irrelevant indices", () => {
    expect(() =>
      validateTemplateDefinition({
        ...definition(),
        inputs: [
          input(),
          { ...input(), inputId: "other", target: { field: "recipient", nodeId: "p" } },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateTemplateDefinition({
        ...definition(),
        inputs: [input("recipient", "wallet", "p", 0)],
      }),
    ).toThrow(/index/);
    expect(() =>
      validateTemplateDefinition({ ...definition(), inputs: [input("recipient", "wallet", "t")] }),
    ).toThrow(/unsupported/);
    expect(() =>
      validateTemplateDefinition({ ...definition(), inputs: [input("recipient", "text")] }),
    ).toThrow(/type/);
  });
  it("binds Pay percentage bps exactly and refuses irrelevant full-amount payout leaves", () => {
    const g = graph([
      receive,
      { ...pay, config: { ...pay.config, mode: "percentage", percentage: 50 } },
    ]);
    const d = definition(g, [input("percentageBps", "bps")]);
    const result = bindTemplateVersion(
      d,
      versionId,
      bindings([{ inputId: "customer", value: { type: "bps", value: 1235 } }]),
    );
    expect(result.graph.nodes[1]).toMatchObject({
      config: { percentage: 12.35, mode: "percentage", recipient: A },
    });
    const full = graph([receive, { ...pay, config: { ...pay.config, fullAmount: true } }]);
    expect(() =>
      validateTemplateDefinition(definition(full, [input("amountStroops", "stroops")])),
    ).toThrow(/irrelevant/);
  });
  it("keeps exact fixed Split row identity and does not turn creation values into execution permissions", () => {
    const g = graph([
      receive,
      {
        id: "p",
        type: "split",
        config: {
          asset,
          recipients: [
            { rowId: "a", address: A, mode: "fixed", amountStroops: "100" },
            { rowId: "b", address: B, mode: "fixed", amountStroops: "200" },
          ],
        },
      },
    ]);
    const d = definition(g, [input("splitAmountStroops", "stroops", "p", 0)]);
    const result = bindTemplateVersion(
      d,
      versionId,
      bindings([{ inputId: "customer", value: { type: "stroops", value: "300" } }]),
    );
    expect(result.graph.nodes[1]).toMatchObject({
      config: {
        recipients: [
          { rowId: "a", address: A, mode: "fixed", amountStroops: "300" },
          { rowId: "b", address: B, mode: "fixed", amountStroops: "200" },
        ],
      },
    });
    expect(result.graph.fieldPolicies).toBeUndefined();
  });
  it("rejects inappropriate type/constraint combinations and secret text defaults", () => {
    const d = definition();
    for (const constraints of [
      { min: { type: "wallet", value: A } },
      { maxLength: 20 },
      { min: { type: "integer", value: 1 } },
    ])
      expect(() =>
        validateTemplateDefinition({ ...d, inputs: [{ ...input(), constraints }] }),
      ).toThrow();
    const oracle = definition(
      graph([{ id: "t", type: "oracle", config: { asset, threshold: "0" } }, pay]),
      [input("threshold", "text", "t")],
    );
    for (const value of ["-1", "01", "1.5", (2n ** 127n).toString(), Keypair.random().secret()])
      expect(() =>
        bindTemplateVersion(
          oracle,
          versionId,
          bindings([{ inputId: "customer", value: { type: "text", value } }]),
        ),
      ).toThrow();
  });
  it("uses immutable Split slots and validates the combined allocation instead of rewriting modes or membership", () => {
    const split = graph([
      receive,
      {
        id: "p",
        type: "split",
        config: {
          asset,
          recipients: [
            { rowId: "a", address: A, mode: "percentage", bps: 6000 },
            { rowId: "b", address: B, mode: "percentage", bps: 4000 },
          ],
        },
      },
    ]);
    const d = definition(split, [
      input("splitRecipient", "wallet", "p", 0),
      { ...input("splitBps", "bps", "p", 0), inputId: "shareA" },
      { ...input("splitBps", "bps", "p", 1), inputId: "shareB" },
    ]);
    const result = bindTemplateVersion(
      d,
      versionId,
      bindings([
        { inputId: "customer", value: { type: "wallet", value: C } },
        { inputId: "shareA", value: { type: "bps", value: 7000 } },
        { inputId: "shareB", value: { type: "bps", value: 3000 } },
      ]),
    );
    expect(result.graph.nodes[1]).toMatchObject({
      config: {
        recipients: [
          { rowId: "a", address: C, mode: "percentage", bps: 7000 },
          { rowId: "b", address: B, mode: "percentage", bps: 3000 },
        ],
      },
    });
    expect(() =>
      bindTemplateVersion(
        d,
        versionId,
        bindings([
          { inputId: "customer", value: { type: "wallet", value: C } },
          { inputId: "shareA", value: { type: "bps", value: 8000 } },
          { inputId: "shareB", value: { type: "bps", value: 3000 } },
        ]),
      ),
    ).toThrow(/100|10,000|10000|sum|total/);
    expect(() =>
      validateTemplateDefinition(definition(split, [input("splitBps", "bps", "p", 19)])),
    ).toThrow(/row/);
    expect(() =>
      validateTemplateDefinition(
        definition(split, [input("splitAmountStroops", "stroops", "p", 0)]),
      ),
    ).toThrow(/irrelevant/);
    expect(() =>
      validateTemplateDefinition(definition(split, [input("amountPerIntervalStroops", "stroops")])),
    ).toThrow(/irrelevant/);
  });
  it("preserves lifetime policies and refuses to fill declared execution-only leaves", () => {
    const g = graph([receive, pay]);
    g.fieldPolicies = {
      version: 1,
      nodes: [{ nodeId: "p", kind: "pay", recipient: "constant", payoutValue: "constant" }],
    };
    const result = bindTemplateVersion(definition(g), versionId, bindings());
    expect(result.graph.fieldPolicies).toEqual(g.fieldPolicies);
    const policy = g.fieldPolicies.nodes[0]!;
    if (policy.kind === "pay") policy.recipient = "execution";
    const p = g.nodes[1]!;
    if (p.type === "pay") p.config.recipient = "";
    expect(() => validateTemplateDefinition(definition(g))).toThrow(/runtime-only/);
  });
  it("revalidates pending/invalid/cyclic/incomplete flows before publication and binding", () => {
    const d = definition();
    const p = d.graph.nodes[1]!;
    if (p.type === "pay") p.config.recipient = "PENDING:customer";
    expect(() => validateTemplateDefinition(d)).not.toThrow();
    expect(() => validateTemplateDefinition(d, true)).toThrow(/unresolved/);
    expect(bindTemplateVersion(d, versionId, bindings()).graph.nodes[1]).toMatchObject({
      config: { recipient: B },
    });
    const cyclic = definition();
    cyclic.graph.edges.push({ id: "cycle", source: "p", target: "t" });
    expect(() => validateTemplateDefinition(cyclic, true)).toThrow();
  });
  it("rejects compiler-ignored UI, termination, derived-pull and absorbed percentage declarations", () => {
    const scheduled = {
      id: "t",
      type: "on_schedule",
      config: {
        intervalAmount: 1,
        intervalUnit: "day",
        startsAt: "2035-01-01T00:00:00Z",
        endsAt: "2036-01-01T00:00:00Z",
        occurrences: 2,
      },
    };
    expect(() =>
      validateTemplateDefinition(
        definition(graph([scheduled, pay]), [input("occurrences", "integer", "t")]),
      ),
    ).toThrow(/irrelevant/);
    const ended = { ...scheduled, config: { ...scheduled.config, endsAt: undefined } };
    expect(() =>
      validateTemplateDefinition(
        definition(graph([ended, pay]), [input("endsAt", "timestamp", "t")]),
      ),
    ).toThrow(/termination/);
    expect(() =>
      validateTemplateDefinition({
        ...definition(),
        inputs: [{ ...input(), target: { nodeId: "t", field: "timeZone" } }],
      }),
    ).toThrow();
    const subscription = {
      id: "t",
      type: "subscription",
      config: {
        asset,
        subscriber: A,
        amountPerPeriodStroops: "100",
        intervalAmount: 1,
        intervalUnit: "day",
        occurrences: 2,
      },
    };
    const split = {
      id: "p",
      type: "split",
      config: { asset, recipients: [{ address: A, mode: "fixed", amountStroops: "100" }] },
    };
    expect(() =>
      validateTemplateDefinition(
        definition(graph([subscription, split]), [input("amountPerPeriodStroops", "stroops", "t")]),
      ),
    ).toThrow(/derived/);
    const percentage = { ...pay, config: { ...pay.config, mode: "percentage", percentage: 50 } };
    expect(() =>
      validateTemplateDefinition(
        definition(graph([scheduled, percentage]), [input("percentageBps", "bps")]),
        true,
      ),
    ).toThrow(/irrelevant/);
    const conditional = {
      id: "c",
      type: "condition",
      config: { kind: "oracle_gte", oracle: A, key: "XLMUSD", threshold: "100" },
    };
    expect(() =>
      validateTemplateDefinition(
        definition(graph([receive, conditional, percentage]), [input("percentageBps", "bps")]),
        true,
      ),
    ).toThrow(/irrelevant/);
  });
  it("refuses a legacy Receive → Pay minimum that cannot change the actual constructors", () => {
    const minimumReceive = { ...receive, config: { ...receive.config, minAmountStroops: "100" } };
    const d = definition(graph([minimumReceive, pay]), [input("minAmountStroops", "stroops", "t")]);
    const changed = structuredClone(d.graph);
    const root = changed.nodes[0]!;
    if (root.type === "on_receive") root.config.minAmountStroops = "200";
    // The legacy root has no minimum argument and Payer only sees its fixed
    // configured payout. A changed JSON field is not an on-chain minimum.
    expect(flowToPipeline(changed, undefined, { forValidation: true })).toEqual(
      flowToPipeline(d.graph, undefined, { forValidation: true }),
    );
    expect(encodedConstructors(changed)).toEqual(encodedConstructors(d.graph));
    expect(() => validateTemplateDefinition(d, true)).toThrow(/minimum is not enforced/);
    expect(() =>
      bindTemplateVersion(
        d,
        versionId,
        bindings([{ inputId: "customer", value: { type: "stroops", value: "200" } }]),
      ),
    ).toThrow(/minimum is not enforced/);
  });
  it("does not mistake a later Split minimum for a root minimum after a Pay", () => {
    const minimumReceive = { ...receive, config: { ...receive.config, minAmountStroops: "100" } };
    const split = {
      id: "s",
      type: "split",
      config: { asset, recipients: [{ address: B, mode: "percentage", bps: 10000 }] },
    };
    const d = definition(graph([minimumReceive, pay, split]), [
      input("minAmountStroops", "stroops", "t"),
    ]);
    expect(
      flowToPipeline(d.graph, undefined, { forValidation: true }).find(
        (node) => node.params.kind === "splitter",
      )?.params,
    ).toMatchObject({ minAmountStroops: "100" });
    expect(() => validateTemplateDefinition(d, true)).toThrow(/minimum is not enforced/);
    expect(() =>
      bindTemplateVersion(
        d,
        versionId,
        bindings([{ inputId: "customer", value: { type: "stroops", value: "200" } }]),
      ),
    ).toThrow(/minimum is not enforced/);
  });
  it("refuses legacy Receive → Split minimum binding despite changing stored constructor bytes", () => {
    const minimumReceive = { ...receive, config: { ...receive.config, minAmountStroops: "100" } };
    const split = {
      id: "p",
      type: "split",
      config: { asset, recipients: [{ address: A, mode: "percentage", bps: 10000 }] },
    };
    const d = definition(graph([minimumReceive, split]), [
      input("minAmountStroops", "stroops", "t"),
    ]);
    const changed = structuredClone(d.graph);
    const root = changed.nodes[0]!;
    if (root.type === "on_receive") root.config.minAmountStroops = "200";
    // Storage/constructor changes alone are insufficient: legacy pipeline
    // deposit -> execute_step never takes Splitter's guarded distribute path.
    expect(encodedConstructors(changed)).not.toEqual(encodedConstructors(d.graph));
    expect(() => validateTemplateDefinition(d, true)).toThrow(/minimum is not enforced/);
    expect(() =>
      bindTemplateVersion(
        d,
        versionId,
        bindings([{ inputId: "customer", value: { type: "stroops", value: "200" } }]),
      ),
    ).toThrow(/minimum is not enforced/);
  });
  it("binds Receive minimum only through the policy-aware execution root", () => {
    const minimumReceive = { ...receive, config: { ...receive.config, minAmountStroops: "100" } };
    const g = graph([minimumReceive, pay]);
    g.fieldPolicies = { version: 1, nodes: [] };
    const d = definition(g, [input("minAmountStroops", "stroops", "t")]);
    expect(() => validateTemplateDefinition(d, true)).not.toThrow();
    const result = bindTemplateVersion(
      d,
      versionId,
      bindings([{ inputId: "customer", value: { type: "stroops", value: "200" } }]),
    );
    const root = flowToPipeline(result.graph, undefined, { forValidation: true })[0]!;
    expect(root.params).toMatchObject({
      kind: "deposit_trigger",
      executionNodeId: "t",
      minAmountStroops: "200",
    });
    expect(result.graph.fieldPolicies).toEqual(g.fieldPolicies);
    expect(encodedConstructors(result.graph)).not.toEqual(encodedConstructors(d.graph));
  });
  it("binds fresh declared deadlines after the immutable exemplar has expired", () => {
    const d = definition(
      graph([
        {
          id: "t",
          type: "on_schedule",
          config: {
            intervalAmount: 1,
            intervalUnit: "day",
            startsAt: "2030-01-01T00:00:00Z",
            endsAt: "2030-06-01T00:00:00Z",
          },
        },
        pay,
      ]),
      [input("endsAt", "timestamp", "t")],
    );
    validateTemplateDefinition(d, true);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
    try {
      const result = bindTemplateVersion(
        d,
        versionId,
        bindings([
          { inputId: "customer", value: { type: "timestamp", value: "2032-01-01T00:00:00Z" } },
        ]),
      );
      expect(result.graph.nodes[0]).toMatchObject({ config: { endsAt: "2032-01-01T00:00:00Z" } });
      expect(() => bindTemplateVersion({ ...d, inputs: [] }, versionId, bindings([]))).toThrow(
        /end time/,
      );
    } finally {
      clock.mockRestore();
    }
  });
  const schedule = {
    id: "t",
    type: "on_schedule",
    config: {
      intervalAmount: 1,
      intervalUnit: "day",
      startsAt: "2035-01-01T00:00:00Z",
      occurrences: 2,
    },
  };
  const cases: {
    name: string;
    nodes: unknown[];
    declaration: CreationDeclaration;
    value: CreationValue;
    expectedKind: string;
  }[] = [
    {
      name: "schedule",
      nodes: [schedule, pay],
      declaration: input("intervalAmount", "integer", "t"),
      value: { type: "integer", value: 2 },
      expectedKind: "STREAMER",
    },
    {
      name: "subscription",
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset,
            subscriber: A,
            amountPerPeriodStroops: "100",
            intervalAmount: 1,
            intervalUnit: "day",
            occurrences: 2,
          },
        },
        pay,
      ],
      declaration: input("subscriber", "wallet", "t"),
      value: { type: "wallet", value: B },
      expectedKind: "SUBSCRIPTION",
    },
    {
      name: "webhook",
      nodes: [{ id: "t", type: "webhook", config: { asset, relayer: A } }, pay],
      declaration: input("relayer", "wallet", "t"),
      value: { type: "wallet", value: B },
      expectedKind: "WEBHOOK",
    },
    {
      name: "http webhook",
      nodes: [{ id: "t", type: "web2_webhook", config: { asset } }, pay],
      declaration: input(),
      value: { type: "wallet", value: B },
      expectedKind: "WEBHOOK",
    },
    {
      name: "oracle trigger",
      nodes: [{ id: "t", type: "oracle", config: { asset, threshold: "100" } }, pay],
      declaration: input("threshold", "text", "t"),
      value: { type: "text", value: "0" },
      expectedKind: "ORACLE",
    },
    {
      name: "time condition",
      nodes: [
        receive,
        { id: "c", type: "condition", config: { kind: "time_after", at: "2035-01-01T00:00:00Z" } },
        pay,
      ],
      declaration: input("at", "timestamp", "c"),
      value: { type: "timestamp", value: "2036-01-01T00:00:00Z" },
      expectedKind: "TIMELOCK",
    },
    {
      name: "amount condition",
      nodes: [
        receive,
        { id: "c", type: "condition", config: { kind: "amount_gt", amountStroops: "10" } },
        pay,
      ],
      declaration: input("amountStroops", "stroops", "c"),
      value: { type: "stroops", value: "20" },
      expectedKind: "ROUTER",
    },
    {
      name: "oracle condition",
      nodes: [
        receive,
        {
          id: "c",
          type: "condition",
          config: { kind: "oracle_gte", oracle: A, key: "XLMUSD", threshold: "100" },
        },
        pay,
      ],
      declaration: input("oracleKey", "text", "c"),
      value: { type: "text", value: "BTCUSD" },
      expectedKind: "CONDITIONAL",
    },
    {
      name: "multisig",
      nodes: [
        receive,
        { id: "c", type: "condition", config: { kind: "multisig", signers: [A, B], threshold: 1 } },
        pay,
      ],
      declaration: input("signer", "wallet", "c", 0),
      value: { type: "wallet", value: C },
      expectedKind: "MULTISIG",
    },
    {
      name: "yield",
      nodes: [
        { id: "t", type: "web2_webhook", config: { asset } },
        { id: "p", type: "yield", config: { asset, vault: A } },
      ],
      declaration: input("vault", "wallet"),
      value: { type: "wallet", value: B },
      expectedKind: "YIELD",
    },
    {
      name: "swap",
      nodes: [
        receive,
        {
          id: "s",
          type: "swap",
          config: {
            assetIn: asset,
            assetOut: { kind: "known", symbol: "USDC" },
            slippageBps: 100,
            deadlineSecs: 300,
          },
        },
        { ...pay, config: { ...pay.config, asset: { kind: "known", symbol: "USDC" } } },
      ],
      declaration: input("slippageBps", "bps", "s"),
      value: { type: "bps", value: 200 },
      expectedKind: "SWAPPER",
    },
  ];
  it.each(cases)(
    "supports standard $name agreements and preserves the rest of the graph",
    ({ nodes, declaration, value, expectedKind }) => {
      const d = definition(graph(nodes), [declaration]);
      const before = structuredClone(d);
      const result = bindTemplateVersion(d, versionId, bindings([{ inputId: "customer", value }]));
      expect(d).toEqual(before);
      expect(result.graph).not.toEqual(d.graph);
      expect(untargeted(result.graph, declaration)).toEqual(untargeted(d.graph, declaration));
      expect(result.graph.edges).toEqual(d.graph.edges);
      expect(result.graph.fieldPolicies).toEqual(d.graph.fieldPolicies);
      expect(result.graph.nodes.map((node) => ({ id: node.id, type: node.type }))).toEqual(
        d.graph.nodes.map((node) => ({ id: node.id, type: node.type })),
      );
      expect(
        flowToPipeline(result.graph, undefined, { forValidation: true }).map(
          (node) => node.templateKind,
        ),
      ).toContain(expectedKind);
    },
  );
});

describe("template request schemas", () => {
  it("accepts complete typed input and rejects unknown/missing/coerced authority", () => {
    expect(
      CreateFlowTemplateSchema.safeParse({ name: "Template", definition: definition() }).success,
    ).toBe(true);
    for (const value of [
      { name: "", definition: definition() },
      { name: "t", definition: definition(), ownerId: randomUUID() },
      {
        name: "t",
        definition: { ...definition(), inputs: [{ ...input(), path: "nodes.1.config.recipient" }] },
      },
    ])
      expect(CreateFlowTemplateSchema.safeParse(value).success).toBe(false);
    expect(TemplateDefinitionSchema.safeParse({ ...definition(), schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(
      UpdateFlowTemplateSchema.safeParse({ expectedRevision: 1, name: "Updated" }).success,
    ).toBe(true);
    expect(UpdateFlowTemplateSchema.safeParse({ expectedRevision: 1 }).success).toBe(false);
    expect(UpdateFlowTemplateSchema.safeParse({ expectedRevision: "1", name: "a" }).success).toBe(
      false,
    );
    expect(
      PublishFlowTemplateSchema.safeParse({
        expectedRevision: 1,
        expiresAt: "2035-01-01T00:00:00Z",
      }).success,
    ).toBe(true);
    expect(
      PublishFlowTemplateSchema.safeParse({ expectedRevision: 1, network: "mainnet" }).success,
    ).toBe(false);
    expect(RetireFlowTemplateSchema.safeParse({ confirm: "retire" }).success).toBe(true);
    expect(RetireFlowTemplateSchema.safeParse({ confirm: true }).success).toBe(false);
    expect(FlowTemplateListQuerySchema.parse({}).limit).toBe(20);
    expect(FlowTemplateListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(
      TemplateArtifactsSchema.safeParse({
        version: 1,
        compilerAbi: 1,
        factoryAddress: A,
        factoryWasmHash: "a".repeat(64),
        nodes: [],
      }).success,
    ).toBe(false);
  });
});
