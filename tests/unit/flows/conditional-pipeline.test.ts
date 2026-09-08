/**
 * A receive -> oracle_gte -> pay/split flow must survive the whole way to the
 * unsigned transaction, not just validateFlow.
 *
 * The oracle_gte branch of flowToPipeline sets `terminal`: the CONDITIONAL owns
 * the recipients and pays them from `release()`, so the pay/split node is never
 * emitted. It used to be handed the graph's children as next steps anyway, and
 * because that absorbed action has no deployed contract, serializing the target
 * threw "Missing computed address for node p" inside preparePipelineDeployTx —
 * a 500 on a flow the builder said was valid. The contract stores next_steps
 * and never reads them, so the fix is to pass none.
 */
import { describe, expect, it, vi } from "vitest";
import { scValToNative } from "@stellar/stellar-sdk";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
import { flowToPipeline } from "@/lib/flows/to-params";
import { validateFlow } from "@/lib/flows/validate";

vi.mock("@/lib/stellar/assets", () => ({
  assetContractId: vi.fn(() => "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
}));

const ADMIN = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const RECIPIENT = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER = "GC5Q654OUY2FMR6TVBCTQYNGZLGX4ZCGUJ5XDE2UMBSLYYHTNIN3L6O6";
const ORACLE = "GDUY7J7A33TQWOSOQGDO776GGLM3UQERL4J3SPT56F6YS4ID7MLDERI4";
const PARENT = "CDEEJZG6DYN65DTZLS6WU7YJ3I4RJ4TSOHF5VXEFO7PTTHWRNREPDOOU";
const NODE_ADDRS = [
  "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD",
  "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS",
  "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
];

const XLM = { kind: "native" } as const;

const trigger = { id: "t", type: "on_receive", config: { asset: XLM } };
const condition = {
  id: "c",
  type: "condition",
  config: { kind: "oracle_gte", oracle: ORACLE, key: "XLMUSD", threshold: "100" },
};
const pay = {
  id: "p",
  type: "pay",
  config: {
    recipient: RECIPIENT,
    asset: XLM,
    mode: "fixed",
    amountStroops: "5000000",
    fullAmount: false,
  },
};
const split = {
  id: "p",
  type: "split",
  config: {
    asset: XLM,
    recipients: [
      { address: RECIPIENT, mode: "percentage", bps: 5000, label: "A" },
      { address: OTHER, mode: "percentage", bps: 5000, label: "B" },
    ],
  },
};
const edges = [
  { id: "e1", source: "t", target: "c" },
  { id: "e2", source: "c", target: "p" },
];

/** What buildPipelinePlan() in lib/stellar/deploy.ts hands the serializer: an
 *  address for every node the factory actually deploys, and nothing else. */
function serializeAll(graph: Parameters<typeof flowToPipeline>[0]) {
  const pipeline = flowToPipeline(graph);
  const nodeAddresses: Record<string, string> = {};
  for (const [i, p] of pipeline.entries()) {
    nodeAddresses[p.nodeId] = NODE_ADDRS[i]!;
  }
  return pipeline.map((p) => pipelineNodeConstructorArgs(p.params, ADMIN, PARENT, nodeAddresses));
}

describe("a conditional that absorbs its action still serializes", () => {
  it("builds constructor args for receive -> oracle_gte -> pay", () => {
    const graph = { nodes: [trigger, condition, pay], edges } as never;
    expect(() => serializeAll(graph)).not.toThrow();
  });

  it("builds constructor args for receive -> oracle_gte -> split", () => {
    const graph = { nodes: [trigger, condition, split], edges } as never;
    expect(() => serializeAll(graph)).not.toThrow();
  });

  it("gives the conditional no next steps, since release() pays the recipients itself", () => {
    const args = serializeAll({ nodes: [trigger, condition, pay], edges } as never);
    // conditional ctor: admin, recipients, asset, amount, condition, next_steps, parent
    const nextSteps = scValToNative(args[1]![5]!);
    expect(nextSteps).toEqual([]);
    const recipients = scValToNative(args[1]![1]!) as Array<{ address: string }>;
    expect(recipients.map((r) => r.address)).toEqual([RECIPIENT]);
  });
});

describe("only the action the conditional absorbs is exempt from the not-deployed guard", () => {
  it("rejects a second pay the conditional cannot carry", () => {
    const v = validateFlow({
      nodes: [
        trigger,
        condition,
        pay,
        { ...pay, id: "p2", config: { ...pay.config, recipient: OTHER } },
      ],
      edges: [...edges, { id: "e3", source: "t", target: "p2" }],
    } as never);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.some((e) => /wouldn't reach the chain/.test(e.friendlyMessage))).toBe(true);
  });
});
