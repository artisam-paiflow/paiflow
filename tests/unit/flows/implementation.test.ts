import { describe, expect, it } from "vitest";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";
import {
  BlockBindingSchema,
  PipelineImplementationSchema,
  implementationIssues,
  implementationLabel,
} from "@/lib/flows/implementation";

const ACCOUNT = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const OTHER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const asset = { kind: "native" } as const;
const pay = {
  id: "p",
  type: "pay",
  config: { asset, recipient: ACCOUNT, mode: "fixed", amountStroops: "100", fullAmount: false },
};
const receive = { id: "t", type: "on_receive", config: { asset } };
const edge = { id: "tp", source: "t", target: "p" };
const graph = (trigger = receive, action = pay, devMode = false): FlowGraph =>
  FlowGraphSchema.parse({ nodes: [trigger, action], edges: [edge], devMode });

describe("compiler implementation bindings", () => {
  it("preserves Dev Split's existing external fiat contract recipient without inventing a child", () => {
    const external = "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L";
    const g = FlowGraphSchema.parse({
      devMode: true,
      nodes: [
        receive,
        {
          id: "p",
          type: "split",
          config: {
            asset,
            recipients: [{ address: external, payoutMode: "fiat", mode: "percentage", bps: 10000 }],
          },
        },
      ],
      edges: [edge],
    });
    const pipeline = flowToPipeline(g);
    expect(validateFlow(g).ok).toBe(true);
    expect(pipeline.map((node) => node.templateKind)).toEqual(["DEPOSIT_TRIGGER", "SPLITTER_DEV"]);
    expect(pipeline[1]?.params).toMatchObject({
      recipients: [{ address: external, isCashOut: true }],
    });
    expect(implementationIssues(g, pipeline)).toEqual([]);
  });

  it.each([false, true])("records separate Receive and Pay implementations (dev=%s)", (devMode) => {
    const g = graph(receive, pay, devMode);
    const pipeline = flowToPipeline(g);
    expect(pipeline.map((n) => n.implementation)).toEqual([
      { version: 1, bindings: [{ blockId: "t", blockType: "on_receive", role: "trigger" }] },
      { version: 1, bindings: [{ blockId: "p", blockType: "pay", role: "action" }] },
    ]);
    expect(implementationIssues(g, pipeline)).toEqual([]);
    expect(pipeline[1]?.templateKind).toBe(devMode ? "PAYER_DEV" : "PAYER");
  });

  it.each([false, true])("records Schedule and Split sharing one Streamer (dev=%s)", (devMode) => {
    const g = FlowGraphSchema.parse({
      devMode,
      nodes: [
        {
          id: "t",
          type: "on_schedule",
          config: { startsAt: "2030-01-01T00:00:00Z", intervalAmount: 1, intervalUnit: "hour" },
        },
        {
          id: "p",
          type: "split",
          config: {
            asset,
            amountPerIntervalStroops: "100",
            recipients: [{ address: ACCOUNT, mode: "percentage", bps: 10000 }],
          },
        },
      ],
      edges: [edge],
    });
    const pipeline = flowToPipeline(g);
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]).toMatchObject({
      nodeId: "p",
      templateKind: "STREAMER",
      implementation: {
        version: 1,
        bindings: [
          { blockId: "t", blockType: "on_schedule", role: "schedule" },
          { blockId: "p", blockType: "split", role: "distribution" },
        ],
      },
    });
    expect(implementationIssues(g, pipeline)).toEqual([]);
    expect(implementationLabel(pipeline[0]?.implementation)).toBe("Schedule + Split");
    expect(validateFlow(g).ok).toBe(true);
  });

  it.each([false, true])("records Subscription and Pay separately (dev=%s)", (devMode) => {
    const g = FlowGraphSchema.parse({
      devMode,
      nodes: [
        {
          id: "t",
          type: "subscription",
          config: {
            asset,
            subscriber: ACCOUNT,
            amountPerPeriodStroops: "100",
            intervalAmount: 1,
            intervalUnit: "day",
          },
        },
        pay,
      ],
      edges: [edge],
    });
    const pipeline = flowToPipeline(g);
    expect(pipeline[0]?.implementation?.bindings).toEqual([
      { blockId: "t", blockType: "subscription", role: "trigger" },
    ]);
    expect(pipeline[1]?.implementation?.bindings).toEqual([
      { blockId: "p", blockType: "pay", role: "action" },
    ]);
    expect(implementationIssues(g, pipeline)).toEqual([]);
  });

  it.each(["time_before", "time_after"])(
    "records Hold as a strict-lock rule for %s and preserves Return's visual type",
    (kind) => {
      const g = FlowGraphSchema.parse({
        devMode: true,
        nodes: [
          receive,
          { id: "c", type: "condition", config: { kind, at: "2030-01-01T00:00:00Z" } },
          { id: "h", type: "hold", config: {} },
          { id: "r", type: "return_to_owner", config: {} },
        ],
        edges: [
          { id: "tc", source: "t", target: "c" },
          {
            id: "ch",
            source: "c",
            target: "h",
            sourceHandle: kind === "time_before" ? "true" : "false",
          },
          {
            id: "cr",
            source: "c",
            target: "r",
            sourceHandle: kind === "time_before" ? "false" : "true",
          },
        ],
      });
      const pipeline = flowToPipeline(g, undefined, undefined, { ownerAddress: ACCOUNT });
      expect(pipeline.map((n) => n.nodeId)).toEqual(["t", "c", "r"]);
      expect(pipeline[1]?.implementation?.bindings).toEqual([
        { blockId: "c", blockType: "condition", role: "condition" },
        { blockId: "h", blockType: "hold", role: "strict_lock" },
      ]);
      expect(pipeline[2]).toMatchObject({
        templateKind: "PAYER",
        implementation: {
          version: 1,
          bindings: [{ blockId: "r", blockType: "return_to_owner", role: "action" }],
        },
        params: { recipient: ACCOUNT },
      });
      expect(implementationIssues(g, pipeline)).toEqual([]);
      expect(implementationLabel(pipeline[1]?.implementation)).toBe(
        "Condition + Hold until deadline",
      );
    },
  );

  it("records an oracle condition's absorbed distribution without inventing a Pay contract", () => {
    const g = FlowGraphSchema.parse({
      nodes: [
        receive,
        {
          id: "c",
          type: "condition",
          config: { kind: "oracle_gte", oracle: ACCOUNT, key: "price", threshold: "100" },
        },
        pay,
      ],
      edges: [
        { id: "tc", source: "t", target: "c" },
        { id: "cp", source: "c", target: "p" },
      ],
    });
    const pipeline = flowToPipeline(g);
    expect(pipeline.map((n) => n.nodeId)).toEqual(["t", "c"]);
    expect(pipeline[1]?.implementation?.bindings).toEqual([
      { blockId: "c", blockType: "condition", role: "condition" },
      { blockId: "p", blockType: "pay", role: "distribution" },
    ]);
    expect(implementationIssues(g, pipeline)).toEqual([]);
  });

  it.each(["PENDING:bank", "CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L"])(
    "records generated payout origins when the fiat input is %s",
    (fiatInput) => {
      const g = FlowGraphSchema.parse({
        nodes: [
          receive,
          {
            id: "p",
            type: "split",
            config: {
              asset,
              recipients: [
                { address: ACCOUNT, mode: "percentage", bps: 4000 },
                {
                  address: fiatInput,
                  mode: "percentage",
                  bps: 6000,
                  payoutMode: "fiat",
                  accountName: "Fixture",
                  accountNumber: "123",
                  bankCode: "TEST",
                },
              ],
            },
          },
        ],
        edges: [edge],
      });
      const pipeline = flowToPipeline(g, OTHER, OTHER);
      expect(pipeline[2]).toMatchObject({
        nodeId: "p-cashout-1",
        templateKind: "CASH_OUT",
        implementation: {
          version: 1,
          bindings: [{ blockId: "p", blockType: "split", role: "payout_sink", recipientIndex: 1 }],
        },
        params: { parentNodeId: "p" },
      });
      expect(implementationIssues(g, pipeline)).toEqual([]);
      expect(implementationLabel(pipeline[2]?.implementation)).toBe("Split recipient 2 payout");
      expect(
        implementationIssues(g, pipeline.slice(0, 2)).some((issue) =>
          /missing its contract/.test(issue.message),
        ),
      ).toBe(true);
      const child = pipeline[2]!;
      if (child.params.kind !== "cash_out") throw new Error("Expected generated cash-out fixture");
      const wrongParent = { ...child, params: { ...child.params, parentNodeId: "t" } };
      expect(
        implementationIssues(g, [...pipeline.slice(0, 2), wrongParent]).some((issue) =>
          /invalid recipient binding/.test(issue.message),
        ),
      ).toBe(true);
      const duplicate = { ...child, nodeId: "unreferenced-child" };
      expect(
        implementationIssues(g, [...pipeline, duplicate]).some((issue) =>
          /invalid recipient binding/.test(issue.message),
        ),
      ).toBe(true);
      expect(
        implementationIssues(g, [...pipeline, duplicate]).some((issue) =>
          /exactly one generated/.test(issue.message),
        ),
      ).toBe(true);
      const parent = pipeline[1]!;
      if (parent.params.kind !== "splitter") throw new Error("Expected splitter fixture");
      const missingFlag = {
        ...parent,
        params: {
          ...parent.params,
          recipients: parent.params.recipients.map((recipient) => ({
            ...recipient,
            isCashOut: false,
          })),
        },
      };
      expect(
        implementationIssues(g, [pipeline[0]!, missingFlag]).some((issue) =>
          /exactly one generated/.test(issue.message),
        ),
      ).toBe(true);
    },
  );

  it("refuses coverage gaps for actions, triggers and conditions", () => {
    const g = graph();
    const pipeline = flowToPipeline(g);
    expect(implementationIssues(g, pipeline.slice(1)).map((i) => i.nodeId)).toContain("t");
    expect(implementationIssues(g, pipeline.slice(0, 1)).map((i) => i.nodeId)).toContain("p");
    const dropped = FlowGraphSchema.parse({
      ...g,
      nodes: [
        ...g.nodes,
        { id: "c", type: "condition", config: { kind: "amount_gt", amountStroops: "1" } },
      ],
    });
    expect(implementationIssues(dropped, pipeline).map((i) => i.nodeId)).toContain("c");
  });
});

describe("mapping boundary validation", () => {
  const binding = { blockId: "p", blockType: "pay", role: "action" };
  it.each([
    null,
    {},
    { version: 2, bindings: [binding] },
    { version: 1, bindings: [] },
    { version: 1, bindings: [{ ...binding, blockId: "" }] },
    { version: 1, bindings: [{ ...binding, blockType: "imaginary" }] },
    { version: 1, bindings: [{ ...binding, role: "payout_sink" }] },
    { version: 1, bindings: [{ ...binding, role: "payout_sink", recipientIndex: -1 }] },
    { version: 1, bindings: [{ ...binding, role: "payout_sink", recipientIndex: 0.5 }] },
    { version: 1, bindings: [{ ...binding, recipientIndex: 0 }] },
  ])("rejects malformed or unsupported metadata: %j", (value) => {
    expect(PipelineImplementationSchema.safeParse(value).success).toBe(false);
    expect(implementationLabel(value)).toBeNull();
  });
  it("accepts a generated-recipient binding", () => {
    expect(
      BlockBindingSchema.parse({
        blockId: "p",
        blockType: "pay",
        role: "payout_sink",
        recipientIndex: 0,
      }),
    ).toMatchObject({ recipientIndex: 0 });
  });
  it.each([
    { ...binding, blockId: "absent" },
    { ...binding, blockType: "split" },
    { ...binding, role: "strict_lock" },
    { ...binding, role: "schedule" },
    { ...binding, role: "payout_sink", recipientIndex: 0 },
  ])("reports an invalid compiler binding: %j", (badBinding) => {
    const g = graph();
    const pipeline = flowToPipeline(g);
    pipeline[1] = {
      ...pipeline[1]!,
      implementation: { version: 1, bindings: [badBinding] } as never,
    };
    expect(implementationIssues(g, pipeline).length).toBeGreaterThan(0);
  });
  it("reports duplicate contracts and duplicate bindings", () => {
    const g = graph();
    const pipeline = flowToPipeline(g);
    expect(
      implementationIssues(g, [...pipeline, pipeline[0]!]).some((i) =>
        /same pipeline ID/.test(i.message),
      ),
    ).toBe(true);
    const node = pipeline[1]!;
    node.implementation!.bindings.push(node.implementation!.bindings[0]!);
    expect(implementationIssues(g, pipeline).some((i) => /repeats/.test(i.message))).toBe(true);
  });
  it("leaves associations unavailable for legacy snapshots", () => {
    expect(implementationLabel(undefined)).toBeNull();
  });
});
