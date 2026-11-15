import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Address,
  Asset,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import {
  ConditionalExecutionIntentSchema,
  ConditionalMutationIntentSchema,
  selectConditionalBranch,
  type ConditionalDefinition,
  type ConditionalExecutionIntent,
  type ConditionalMutationIntent,
} from "@/lib/flows/conditional-v2";
import {
  conditionalDeploymentPlan,
  prepareConditionalDeployTransaction,
} from "@/lib/stellar/prepare-conditional-deploy";
import { prepareConditionalExecutionTransaction } from "@/lib/stellar/prepare-conditional-execution";
import { prepareConditionalMutationTransaction } from "@/lib/stellar/prepare-conditional-mutation";
import {
  decodeConditionalNodeState,
  decodeConditionalMutationStatus,
  decodeConditionalConfigurationEvent,
} from "@/lib/stellar/conditional-v2-codec";
import { conditionalMutationResult } from "./conditional-v2-mutation-acceptance";

/** Test-only evidence protocol. Production factory/execute/mutate builders own all ABI encoding. */
export const joinedLayouts = [
  "minimal-gt",
  "minimal-lt",
  "standard",
  "recipients-20",
  "prefix-8",
  "prefix-12",
  "ceiling-40",
] as const;
export type JoinedLayout = (typeof joinedLayouts)[number];
export const joinedFactory = Address.contract(Buffer.alloc(32, 66)).toString();
export const joinedAsset = Asset.native().contractId(Networks.TESTNET);
export const joinedWallet = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
export const joinedPlatform = joinedWallet(3),
  joinedWorker = joinedWallet(4);
const str = (v: string) => nativeToScVal(v, { type: "string" });
const vec = (v: xdr.ScVal[]) => xdr.ScVal.scvVec(v);
const addr = (v: string) => new Address(v).toScVal();
export const joinedSha256 = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");

export function joinedCanvas(layout: JoinedLayout) {
  const standard = layout === "standard",
    many = layout === "recipients-20";
  const prefixCount = standard
    ? 1
    : layout === "prefix-8"
      ? 4
      : layout === "prefix-12"
        ? 8
        : layout === "ceiling-40"
          ? 36
          : 0;
  const prefix = Array.from({ length: prefixCount }, (_, i) => ({
    id: `fee${i}`,
    type: "pay",
    config: {
      asset: { kind: "native" },
      recipient: joinedPlatform,
      mode: "fixed",
      amountStroops: standard ? "10" : "1",
    },
  }));
  return ConditionalCanvasSchema.parse({
    generation: "conditional-v2",
    conditionalPolicies: {
      version: 2,
      nodes: [
        ...(standard
          ? [{ kind: "pay", nodeId: "fee0", recipient: "constant", payoutValue: "mutable" }]
          : []),
        ...(standard || many
          ? [
              {
                kind: "split",
                nodeId: "yes",
                allocationMode: "percentage",
                rows: Array.from({ length: many ? 20 : 1 }, (_, i) => ({
                  rowId: `row${i}`,
                  recipient: "constant",
                  allocation: "constant",
                })),
                additionalRecipients: standard ? "execution" : "constant",
              },
            ]
          : [{ kind: "pay", nodeId: "yes", recipient: "execution", payoutValue: "constant" }]),
        ...(standard
          ? [{ kind: "pay", nodeId: "no", recipient: "execution", payoutValue: "mutable" }]
          : []),
      ],
      condition: { nodeId: "condition", thresholdMode: standard ? "mutable" : "constant" },
    },
    nodes: [
      { id: "receive", type: "on_receive", config: { asset: { kind: "native" } } },
      ...prefix,
      {
        id: "condition",
        type: "condition",
        config: { kind: layout === "minimal-lt" ? "amount_lt" : "amount_gt", amountStroops: "100" },
      },
      standard || many
        ? {
            id: "yes",
            type: "split",
            config: {
              asset: { kind: "native" },
              recipients: Array.from({ length: many ? 20 : 1 }, (_, i) => ({
                rowId: `row${i}`,
                address: many ? joinedWallet(i + 10) : joinedPlatform,
                mode: "percentage",
                bps: many ? 500 : 1000,
              })),
            },
          }
        : {
            id: "yes",
            type: "pay",
            config: { asset: { kind: "native" }, recipient: joinedWorker, fullAmount: true },
          },
      standard
        ? {
            id: "no",
            type: "pay",
            config: {
              asset: { kind: "native" },
              recipient: joinedWorker,
              mode: "fixed",
              amountStroops: "20",
            },
          }
        : { id: "no", type: "return_to_owner", config: {} },
    ],
    edges: [
      ...Array.from({ length: prefixCount + 1 }, (_, i) => ({
        id: `p${i}`,
        source: i === 0 ? "receive" : `fee${i - 1}`,
        target: i === prefixCount ? "condition" : `fee${i}`,
      })),
      { id: "true", source: "condition", target: "yes", sourceHandle: "true" },
      { id: "false", source: "condition", target: "no", sourceHandle: "false" },
    ],
  });
}
function selectedInputs(definition: ConditionalDefinition, amount: string) {
  const branch =
    selectConditionalBranch(definition, amount).selectedBranch === "true"
      ? definition.trueBranch
      : definition.falseBranch;
  if (
    branch.kind === "return_to_owner" ||
    (branch.kind === "split" && branch.policy.additionalRecipients === "constant")
  )
    return [];
  if (branch.kind === "pay")
    return [{ kind: "pay" as const, nodeId: branch.nodeId, recipient: joinedWorker }];
  return [
    {
      kind: "split" as const,
      nodeId: branch.nodeId,
      rows: [],
      additionalRecipients: [
        {
          rowId: "worker",
          recipient: joinedWorker,
          allocation: { kind: "percentage" as const, bps: 9000 },
        },
      ],
    },
  ];
}
function invokeArgs(unsignedXdr: string, method: string) {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, Networks.TESTNET);
  if (!("operations" in tx) || tx.operations.length !== 1)
    throw new Error("Expected one unsigned production operation");
  const op = tx.operations[0]!;
  if (
    op.type !== "invokeHostFunction" ||
    op.func.invokeContract().functionName().toString() !== method ||
    tx.signatures.length
  )
    throw new Error("Unexpected production invocation");
  return op.func.invokeContract().args();
}
export type JoinedOperation = {
  id: string;
  method: "execute_v2" | "mutate_v2";
  expectedSuccess: boolean;
  unsignedXdr: string;
  intent: ConditionalExecutionIntent | ConditionalMutationIntent;
};
export async function createJoinedCapsule(layout: JoinedLayout) {
  // Ephemeral signers stay in this process and are NEVER included in a public capsule.
  const owner = Keypair.random(),
    payer = Keypair.random(),
    deploymentId = randomUUID();
  const graph = joinedCanvas(layout),
    plan = await conditionalDeploymentPlan(graph, owner.publicKey());
  const prepared = await prepareConditionalDeployTransaction(plan, deploymentId);
  const original = {
    id: deploymentId,
    network: "testnet" as const,
    status: "CONFIRMED" as const,
    sourceAccount: owner.publicKey(),
    graphSnapshot: graph,
    paramsSnapshot: plan.envelope,
    pipelineSnapshot: plan.pipeline,
  };
  let definition = plan.envelope.definition,
    nodes = plan.envelope.manifest.nodes.map((n) => ({
      nodeId: n.state.nodeId,
      contractAddress: n.state.contractAddress,
      expectedRevision: n.state.revision,
      wasmHash: n.wasmHash,
    }));
  let serial = 1;
  const operations: JoinedOperation[] = [];
  async function payment(
    id: string,
    amountStroops: string,
    expectedSuccess = true,
    old?: ConditionalExecutionIntent,
  ) {
    const intent =
      old ??
      ConditionalExecutionIntentSchema.parse({
        version: 2,
        deploymentId,
        networkPassphraseHash: joinedSha256(Networks.TESTNET),
        rootContract: nodes[0]!.contractAddress,
        assetContract: joinedAsset,
        payer: payer.publicKey(),
        amountStroops,
        nonce: (serial++).toString(16).padStart(64, "0"),
        expiresAtLedger: 100,
        definition,
        nodes,
        arguments: { version: 2, inputs: selectedInputs(definition, amountStroops) },
        ...selectConditionalBranch(definition, amountStroops),
      });
    const unsigned = await prepareConditionalExecutionTransaction(intent);
    operations.push({
      id,
      method: "execute_v2",
      expectedSuccess,
      unsignedXdr: unsigned.xdr,
      intent,
    });
    return intent;
  }
  if (layout === "standard") {
    const before = await payment("before", "111");
    const staleOriginal = ConditionalExecutionIntentSchema.parse({
      ...before,
      nonce: (serial++).toString(16).padStart(64, "0"),
    });
    const mutation = ConditionalMutationIntentSchema.parse({
      version: 2,
      deploymentId,
      networkPassphraseHash: joinedSha256(Networks.TESTNET),
      rootContract: nodes[0]!.contractAddress,
      admin: owner.publicKey(),
      definition,
      nodes,
      arguments: {
        version: 2,
        changes: [
          {
            kind: "pay",
            nodeId: "fee0",
            expectedRevision: "0",
            payoutValue: { kind: "fixed", amountStroops: "11" },
          },
          { kind: "condition", nodeId: "condition", expectedRevision: "0", thresholdStroops: "99" },
          {
            kind: "pay",
            nodeId: "no",
            expectedRevision: "0",
            payoutValue: { kind: "fixed", amountStroops: "21" },
          },
        ],
      },
    });
    operations.push({
      id: "group",
      method: "mutate_v2",
      expectedSuccess: true,
      unsignedXdr: await prepareConditionalMutationTransaction(mutation),
      intent: mutation,
    });
    ({ definition, nodes } = conditionalMutationResult(mutation));
    await payment("stale", "111", false, staleOriginal);
    await payment("fresh-true", "111");
    await payment("fresh-false", "110");
  } else {
    const prefixAmount = definition.prefix.length;
    for (const [label, n] of [
      ["below", 99],
      ["equal", 100],
      ["above", 101],
    ] as const)
      await payment(label, String(n + prefixAmount));
  }
  const wallets = [
    ...new Set([
      owner.publicKey(),
      payer.publicKey(),
      joinedPlatform,
      joinedWorker,
      ...Array.from({ length: 20 }, (_, i) => joinedWallet(i + 10)),
      ...plan.pipeline.map((n) => n.contractAddress),
    ]),
  ];
  const packet = vec([
    nativeToScVal(Buffer.from(joinedSha256(Networks.TESTNET), "hex"), { type: "bytes" }),
    addr(plan.factoryAddress),
    vec(invokeArgs(prepared.xdr, "deploy_pipeline")),
    addr(owner.publicKey()),
    addr(joinedAsset),
    addr(payer.publicKey()),
    vec(
      plan.pipeline.map((n) =>
        vec([
          str(n.nodeId),
          addr(n.contractAddress),
          str(n.templateKind),
          nativeToScVal(Buffer.from(n.wasmHash, "hex"), { type: "bytes" }),
        ]),
      ),
    ),
    vec(
      operations.map((op) =>
        vec([
          str(op.id),
          str(op.method),
          vec(invokeArgs(op.unsignedXdr, op.method)),
          xdr.ScVal.scvBool(op.expectedSuccess),
        ]),
      ),
    ),
    vec(wallets.map(addr)),
  ]).toXDR("hex");
  const publicEvidence = {
    format: "paiflow.conditional.local-input.v1",
    candidate: {
      baseSha: "17cf0146b468d40b716e5d555cb17f1b9fd1ac9a",
      reviewedParent: "716951b40194ba1fedfb9265500a4bd8c92929adce98b8b8e4da4f9b86421b23",
      producerSourceSha256: joinedSha256(
        await readFile(join(process.cwd(), "tests/fixtures/conditional-v2-joined-acceptance.ts")),
      ),
    },
    layout,
    source:
      "production unsigned transaction builders with local RPC simulation adapter; not network simulation",
    nativeSacFixture: {
      initialClassicWalletStroops: "1000000000",
      initialContractStroops: "0",
      baseReserve: 0,
    },
    original,
    prepared,
    operations,
    wallets,
    packetSha256: joinedSha256(Buffer.from(packet, "hex")),
    sourceArtifactPins: Object.fromEntries(plan.pipeline.map((n) => [n.templateKind, n.wasmHash])),
  };
  return { layout, packet, publicEvidence, owner, payer };
}
export type JoinedCapsule = Awaited<ReturnType<typeof createJoinedCapsule>>;
export async function writeJoinedCapsules(directory: string, capsules: JoinedCapsule[]) {
  await mkdir(directory, { recursive: false });
  for (const c of capsules) {
    await writeFile(join(directory, `${c.layout}.xdr-hex`), `${c.packet}\n`, { flag: "wx" });
    await writeFile(
      join(directory, `${c.layout}.json`),
      `${JSON.stringify(c.publicEvidence, null, 2)}\n`,
      { flag: "wx" },
    );
  }
}
const elements = (v: xdr.ScVal, length?: number) => {
  const a = v.vec();
  if (!a || (length !== undefined && a.length !== length))
    throw new Error("Evidence vector shape mismatch");
  return a;
};
const text = (v: xdr.ScVal) => v.str().toString();
const address = (v: xdr.ScVal) => Address.fromScVal(v).toString();
const choice = (v: xdr.ScVal, allowed: readonly string[]) => {
  const value = text(v);
  if (!allowed.includes(value)) throw new Error("Unknown evidence variant");
  return value;
};
const metric = (v: xdr.ScVal) => {
  const a = elements(v, 3);
  return {
    cpu: a[0]!.u64().toString(),
    memory: a[1]!.u64().toString(),
    feeDebug: text(a[2]!),
  };
};
export function decodeJoinedResult(hex: string, expectedLayout: JoinedLayout) {
  const a = elements(xdr.ScVal.fromXDR(hex.trim(), "hex"), 7);
  if (text(a[0]!) !== "paiflow.conditional.local-result.v1" || text(a[1]!) !== expectedLayout)
    throw new Error("Evidence identity mismatch");
  return {
    layout: expectedLayout,
    factoryOutcome: choice(a[2]!, ["success", "host-error", "sdk-post-fence", "unexpected-panic"]),
    factoryMetrics: metric(a[3]!),
    returnedAddresses: elements(a[4]!).map(address),
    assetMode: choice(a[6]!, ["native-sac", "test-wide-token"]),
    operations: elements(a[5]!).map((v) => {
      const o = elements(v, 7);
      return {
        id: text(o[0]!),
        method: choice(o[1]!, ["execute_v2", "mutate_v2"]),
        outcome: choice(o[2]!, [
          "success",
          "expected-refusal",
          "host-error",
          "sdk-post-fence",
          "unexpected-panic",
        ]),
        metrics: metric(o[3]!),
        balances: elements(o[4]!).map((v) => {
          const b = elements(v, 2);
          return { address: address(b[0]!), amount: String(scValToNative(b[1]!)) };
        }),
        states: elements(o[5]!).map((v) => {
          const s = elements(v, 3);
          return {
            nodeId: text(s[0]!),
            state: decodeConditionalNodeState(s[1]!),
            status: decodeConditionalMutationStatus(s[2]!),
          };
        }),
        events: elements(o[6]!).map((v) => {
          const e = elements(v, 3);
          return {
            contract: address(e[0]!),
            topics: elements(e[1]!),
            data: e[2]!,
            configuration: elements(e[1]!).some((t) => String(scValToNative(t)) === "config_v2")
              ? decodeConditionalConfigurationEvent(e[2]!)
              : null,
          };
        }),
      };
    }),
  };
}
export async function readJoinedSidecars(directory: string, layout: JoinedLayout) {
  const getterHex = await readFile(join(directory, `${layout}.getters.xdr-hex`), "utf8");
  const instanceHex = await readFile(join(directory, `${layout}.instances.xdr-hex`), "utf8");
  return {
    hashes: {
      getters: joinedSha256(Buffer.from(getterHex.trim(), "hex")),
      instances: joinedSha256(Buffer.from(instanceHex.trim(), "hex")),
    },
    getters: elements(xdr.ScVal.fromXDR(getterHex.trim(), "hex")).map((v) => {
      const a = elements(v, 4);
      return { phase: text(a[0]!), nodeId: text(a[1]!), method: text(a[2]!), value: a[3]! };
    }),
    instances: elements(xdr.ScVal.fromXDR(instanceHex.trim(), "hex")).map((v) => {
      const a = elements(v, 4);
      return {
        phase: text(a[0]!),
        key: xdr.LedgerKey.fromXDR(a[1]!.bytes()),
        entry: xdr.LedgerEntry.fromXDR(a[2]!.bytes()),
        liveUntil: a[3]!.switch().name === "scvVoid" ? undefined : a[3]!.u32(),
      };
    }),
  };
}
