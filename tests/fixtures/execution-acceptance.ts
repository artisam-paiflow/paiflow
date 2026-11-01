import { createHash } from "node:crypto";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  StrKey,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";
import { FlowGraphSchema, type FlowGraph } from "@/lib/flows/schema";
import {
  ExecutionIntentSchema,
  type ExecutionArguments,
  type ExecutionIntent,
} from "@/lib/flows/field-policies";
import { flowToPipeline } from "@/lib/flows/to-params";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
import { executionV1Args } from "@/lib/stellar/execution-v1";

/** Public synthetic identities and unsigned ScVal data only. Never network fixtures. */
export const acceptanceWallet = (byte: number) =>
  Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte));
export const admin = acceptanceWallet(1).publicKey();
export const platform = acceptanceWallet(3).publicKey();
export const addresses: Record<string, string> = {
  root: StrKey.encodeContract(Buffer.alloc(32, 101)),
  fee: StrKey.encodeContract(Buffer.alloc(32, 102)),
  split: StrKey.encodeContract(Buffer.alloc(32, 103)),
  pay: StrKey.encodeContract(Buffer.alloc(32, 104)),
};
export const asset = Asset.native().contractId(Networks.TESTNET);
const deploymentId = "11631163-1163-4163-8163-116311631163";
type Payout = { recipient: string; amountStroops: string };
export type AcceptanceCall = {
  name: string;
  payerSeed: number;
  execution: ExecutionIntent;
  payouts: Payout[];
  succeeds: boolean;
};
export type AcceptanceScenario = { name: string; graph: FlowGraph; calls: AcceptanceCall[] };
const allocation = (fixed: boolean, amount: number) =>
  fixed
    ? { kind: "fixed" as const, amountStroops: String(amount) }
    : { kind: "percentage" as const, bps: amount };
const payout = (seed: number, amount: number): Payout => ({
  recipient: acceptanceWallet(seed).publicKey(),
  amountStroops: String(amount),
});

function call(
  graph: FlowGraph,
  name: string,
  payerSeed: number,
  amount: number,
  args: ExecutionArguments,
  serial: number,
  payouts: Payout[],
): AcceptanceCall {
  const pipeline = flowToPipeline(graph);
  return {
    name,
    payerSeed,
    payouts,
    succeeds: true,
    execution: ExecutionIntentSchema.parse({
      version: 1,
      deploymentId,
      networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
      rootContract: addresses.root,
      assetContract: asset,
      payer: acceptanceWallet(payerSeed).publicKey(),
      amountStroops: String(amount),
      nonce: serial.toString(16).padStart(64, "0"),
      expiresAtLedger: 730,
      nodes: pipeline.map((node) => ({
        nodeId: node.nodeId,
        contractAddress: addresses[node.nodeId],
        expectedRevision: "0",
      })),
      arguments: args,
    }),
  };
}
function rosterGraph(fixed: boolean) {
  return FlowGraphSchema.parse({
    nodes: [
      {
        id: "root",
        type: "on_receive",
        config: { asset: { kind: "native" }, minAmountStroops: "1" },
      },
      {
        id: "split",
        type: "split",
        config: {
          asset: { kind: "native" },
          recipients: [
            fixed
              ? { rowId: "platform", address: platform, mode: "fixed", amountStroops: "15" }
              : { rowId: "platform", address: platform, mode: "percentage", bps: 1500 },
          ],
        },
      },
    ],
    edges: [{ id: "root-split", source: "root", target: "split" }],
    fieldPolicies: {
      version: 1,
      nodes: [
        {
          kind: "split",
          nodeId: "split",
          allocationMode: fixed ? "fixed" : "percentage",
          rows: [{ rowId: "platform" }],
          additionalRecipients: "execution",
        },
      ],
    },
  });
}
function rosterArgs(fixed: boolean, rows: Array<[number, number]>): ExecutionArguments {
  return {
    version: 1,
    inputs: [
      {
        kind: "split",
        nodeId: "split",
        rows: [],
        additionalRecipients: rows.map(([seed, amount], index) => ({
          rowId: `worker-${index}`,
          recipient: acceptanceWallet(seed).publicKey(),
          allocation: allocation(fixed, amount),
        })),
      },
    ],
  };
}
function attacks(original: AcceptanceCall): AcceptanceCall[] {
  const altered = (name: string, change: (execution: ExecutionIntent) => void) => {
    const execution = structuredClone(original.execution);
    execution.nonce = createHash("sha256").update(name).digest("hex");
    change(execution);
    return { ...original, name, execution, payouts: [], succeeds: false };
  };
  return [
    altered("missing-input", (execution) => {
      execution.arguments.inputs = [];
    }),
    altered("unknown-node", (execution) => {
      execution.arguments.inputs[0]!.nodeId = "unknown";
      execution.nodes.push({
        nodeId: "unknown",
        contractAddress: StrKey.encodeContract(Buffer.alloc(32, 120)),
        expectedRevision: "0",
      });
    }),
    altered("stale-revision", (execution) => {
      execution.nodes.at(-1)!.expectedRevision = "1";
    }),
    { ...original, name: "replayed-nonce", payouts: [], succeeds: false },
  ];
}
function rosterScenario(fixed: boolean): AcceptanceScenario {
  const graph = rosterGraph(fixed);
  const first = call(
    graph,
    fixed ? "fixed-workers" : "percentage-workers",
    7,
    fixed ? 100 : 101,
    rosterArgs(
      fixed,
      fixed
        ? [
            [4, 35],
            [5, 50],
          ]
        : [
            [4, 3000],
            [5, 5500],
          ],
    ),
    1,
    fixed
      ? [payout(3, 15), payout(4, 35), payout(5, 50)]
      : [payout(3, 15), payout(4, 30), payout(5, 56)],
  );
  const second = call(
    graph,
    "another-payer-different-roster",
    8,
    fixed ? 115 : 200,
    rosterArgs(fixed, [[6, fixed ? 100 : 8500]]),
    2,
    fixed ? [payout(3, 15), payout(6, 100)] : [payout(3, 30), payout(6, 170)],
  );
  const repeated = call(
    graph,
    "same-payer-next-payment",
    7,
    100,
    rosterArgs(fixed, [[9, fixed ? 85 : 8500]]),
    3,
    [payout(3, 15), payout(9, 85)],
  );
  const bad = attacks(first);
  const boundary: AcceptanceCall[] = [];
  if (!fixed) {
    boundary.push(
      call(
        graph,
        "twenty-combined-recipients",
        10,
        1000,
        rosterArgs(
          false,
          Array.from({ length: 19 }, (_, index): [number, number] => [
            20 + index,
            index === 18 ? 1300 : 400,
          ]),
        ),
        4,
        [
          payout(3, 150),
          ...Array.from({ length: 19 }, (_, index) => payout(20 + index, index === 18 ? 130 : 40)),
        ],
      ),
    );
    const excess = call(
      graph,
      "twenty-one-combined-recipients",
      10,
      1000,
      rosterArgs(
        false,
        Array.from({ length: 20 }, (_, index): [number, number] => [
          20 + index,
          index === 19 ? 900 : 400,
        ]),
      ),
      5,
      [],
    );
    excess.succeeds = false;
    bad.push(excess);
  }
  const override = structuredClone(first);
  override.name = "constant-platform-override";
  override.execution.nonce = "ca".repeat(32);
  const input = override.execution.arguments.inputs[0]!;
  if (input.kind !== "split") throw new Error("Split fixture expected");
  input.rows.push({
    rowId: "platform",
    recipient: acceptanceWallet(9).publicKey(),
    allocation: allocation(fixed, 1),
  });
  override.succeeds = false;
  override.payouts = [];
  const wrongMode = structuredClone(first);
  wrongMode.name = "allocation-mode-change";
  wrongMode.execution.nonce = "cc".repeat(32);
  const wrongInput = wrongMode.execution.arguments.inputs[0]!;
  if (wrongInput.kind !== "split") throw new Error("Expected Split fixture");
  wrongInput.additionalRecipients![0]!.allocation = allocation(!fixed, fixed ? 8500 : 85);
  wrongMode.succeeds = false;
  wrongMode.payouts = [];
  if (fixed) {
    for (const amount of [99, 101]) {
      const invalid = structuredClone(first);
      invalid.name = `fixed-${amount < 100 ? "underfunding" : "excess"}`;
      invalid.execution.amountStroops = String(amount);
      invalid.execution.nonce = amount.toString(16).padStart(64, "0");
      invalid.succeeds = false;
      invalid.payouts = [];
      bad.push(invalid);
    }
  }
  return {
    name: fixed ? "remittance-exact-fixed-roster" : "bayanihan-constant-15-percent",
    graph,
    calls: [first, second, repeated, ...boundary, ...bad, override, wrongMode],
  };
}
function remittance(): AcceptanceScenario {
  const graph = FlowGraphSchema.parse({
    nodes: [
      { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
      {
        id: "fee",
        type: "pay",
        config: {
          asset: { kind: "native" },
          recipient: platform,
          mode: "percentage",
          percentage: 15,
        },
      },
      {
        id: "pay",
        type: "pay",
        config: { asset: { kind: "native" }, recipient: "", fullAmount: true },
      },
    ],
    edges: [
      { id: "root-fee", source: "root", target: "fee" },
      { id: "fee-pay", source: "fee", target: "pay" },
    ],
    fieldPolicies: { version: 1, nodes: [{ kind: "pay", nodeId: "pay", recipient: "execution" }] },
  });
  const args = (seed: number): ExecutionArguments => ({
    version: 1,
    inputs: [{ kind: "pay", nodeId: "pay", recipient: acceptanceWallet(seed).publicKey() }],
  });
  const first = call(graph, "first-beneficiary", 7, 200, args(4), 1, [
    payout(3, 30),
    payout(4, 170),
  ]);
  const second = call(graph, "another-beneficiary", 8, 100, args(5), 2, [
    payout(3, 15),
    payout(5, 85),
  ]);
  const constantOverride = structuredClone(first);
  constantOverride.name = "constant-fee-recipient-override";
  constantOverride.execution.nonce = "cb".repeat(32);
  constantOverride.execution.arguments.inputs.push({
    kind: "pay",
    nodeId: "fee",
    recipient: acceptanceWallet(9).publicKey(),
  });
  constantOverride.succeeds = false;
  constantOverride.payouts = [];
  return {
    name: "senda-variable-pay-constant-15-percent",
    graph,
    calls: [first, second, ...attacks(first), constantOverride],
  };
}
export const acceptanceScenarios: AcceptanceScenario[] = [
  rosterScenario(false),
  rosterScenario(true),
  remittance(),
];

/** Structural schema ceiling, deliberately NOT a claim of network feasibility. */
export const structuralCeilingScenario: AcceptanceScenario = (() => {
  const graph = rosterGraph(false);
  const split = graph.nodes.pop()!;
  graph.edges = [];
  let parent = "root";
  for (let index = 0; index < 38; index++) {
    const id = `ceiling-fee-${index}`;
    addresses[id] = StrKey.encodeContract(Buffer.alloc(32, 140 + index));
    graph.nodes.push({
      id,
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient: platform,
        mode: "fixed",
        amountStroops: "1",
        fullAmount: false,
      },
    });
    graph.edges.push({ id: `${parent}-${id}`, source: parent, target: id });
    parent = id;
  }
  graph.nodes.push(split);
  graph.edges.push({ id: `${parent}-split`, source: parent, target: "split" });
  const normalized = FlowGraphSchema.parse(graph);
  return {
    name: "structural-ceiling-40-nodes-20-recipients",
    graph: normalized,
    calls: [
      call(
        normalized,
        "structural-ceiling-probe",
        7,
        1038,
        rosterArgs(
          false,
          Array.from({ length: 19 }, (_, index): [number, number] => [
            20 + index,
            index === 18 ? 1300 : 400,
          ]),
        ),
        90,
        [
          payout(3, 188),
          ...Array.from({ length: 19 }, (_, index) => payout(20 + index, index === 18 ? 130 : 40)),
        ],
      ),
    ],
  };
})();

export function constructors(scenario: AcceptanceScenario) {
  return flowToPipeline(scenario.graph).map((node) => {
    const parent = scenario.graph.edges.find((edge) => edge.target === node.nodeId)?.source;
    return {
      ...node,
      address: addresses[node.nodeId]!,
      args: pipelineNodeConstructorArgs(
        node.params,
        admin,
        parent ? addresses[parent] : undefined,
        addresses,
      ),
    };
  });
}
const addr = (value: string) => new Address(value).toScVal();
const string = (value: string) => nativeToScVal(value, { type: "string" });
const vec = (values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
/** Exact production constructor + execution encodings consumed by Rust unchanged. */
export function acceptancePacket(scenario: AcceptanceScenario) {
  return vec([
    addr(admin),
    addr(asset),
    vec(
      constructors(scenario).map((node) =>
        vec([string(node.nodeId), addr(node.address), string(node.templateKind), vec(node.args)]),
      ),
    ),
    vec(
      scenario.calls.map((call) =>
        vec([
          string(call.name),
          xdr.ScVal.scvBool(call.succeeds),
          vec(executionV1Args(call.execution)),
          vec(
            call.payouts.map((row) =>
              vec([
                addr(row.recipient),
                nativeToScVal(BigInt(row.amountStroops), { type: "i128" }),
              ]),
            ),
          ),
        ]),
      ),
    ),
  ]).toXDR("hex");
}
