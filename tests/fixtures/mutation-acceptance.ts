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
import { flowToPipeline } from "@/lib/flows/to-params";
import {
  ExecutionIntentSchema,
  type ExecutionIntent,
  type MutationArguments,
} from "@/lib/flows/field-policies";
import { MutationIntentSchema, type MutationIntent } from "@/lib/mutations/schema";
import { pipelineNodeConstructorArgs } from "@/lib/stellar/scval";
import { executionV1Args, mutationV1Args } from "@/lib/stellar/execution-v1";
import { MUTATION_V1_WASM_HASHES } from "@/lib/stellar/execution-artifacts";

/** Deterministic test identities, unsigned ScVals and synthetic balances only. */
export const mutationWallet = (byte: number) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte));
export const mutationAdmin = mutationWallet(1).publicKey();
export const mutationPayer = mutationWallet(2).publicKey();
export const mutationPlatform = mutationWallet(3).publicKey();
export const mutationWorker = mutationWallet(4).publicKey();
export const mutationReplacement = mutationWallet(5).publicKey();
export const mutationAsset = Asset.native().contractId(Networks.TESTNET);
export const mutationAddresses: Record<string, string> = {
  root: StrKey.encodeContract(Buffer.alloc(32, 101)),
  fee: StrKey.encodeContract(Buffer.alloc(32, 102)),
  split: StrKey.encodeContract(Buffer.alloc(32, 103)),
};
export const mutationDeploymentId = "11711171-1171-4171-8171-117111711171";
export type MutationScenario = { name: string; fixed: boolean; graph: FlowGraph };

function scenario(fixed: boolean): MutationScenario {
  return {
    name: fixed ? "fixed-accounted-obligations" : "percentage-grouped-update",
    fixed,
    graph: FlowGraphSchema.parse({
      nodes: [
        {
          id: "root",
          type: "on_receive",
          config: { asset: { kind: "native" }, minAmountStroops: "1" },
        },
        {
          id: "fee",
          type: "pay",
          config: {
            asset: { kind: "native" },
            recipient: mutationPlatform,
            mode: "fixed",
            amountStroops: "10",
            fullAmount: false,
          },
        },
        {
          id: "split",
          type: "split",
          config: {
            asset: { kind: "native" },
            recipients: [
              fixed
                ? {
                    rowId: "platform",
                    address: mutationPlatform,
                    mode: "fixed",
                    amountStroops: "15",
                  }
                : { rowId: "platform", address: mutationPlatform, mode: "percentage", bps: 1500 },
            ],
            additionalRecipients: [
              {
                rowId: "worker",
                recipient: mutationWorker,
                allocation: fixed
                  ? { kind: "fixed", amountStroops: "85" }
                  : { kind: "percentage", bps: 8500 },
              },
            ],
          },
        },
      ],
      edges: [
        { id: "root-fee", source: "root", target: "fee" },
        { id: "fee-split", source: "fee", target: "split" },
      ],
      fieldPolicies: {
        version: 1,
        nodes: [
          { kind: "pay", nodeId: "fee", recipient: "mutable", payoutValue: "mutable" },
          {
            kind: "split",
            nodeId: "split",
            allocationMode: fixed ? "fixed" : "percentage",
            rows: [{ rowId: "platform", recipient: "constant", allocation: "constant" }],
            additionalRecipients: "mutable",
          },
        ],
      },
    }),
  };
}
export const mutationScenarios = [scenario(false), scenario(true)];

export function mutationConstructors(item: MutationScenario) {
  const pipeline = flowToPipeline(item.graph);
  return pipeline.map((node, index) => ({
    ...node,
    address: mutationAddresses[node.nodeId]!,
    wasmHash: MUTATION_V1_WASM_HASHES[node.templateKind as keyof typeof MUTATION_V1_WASM_HASHES],
    args: pipelineNodeConstructorArgs(
      node.params,
      mutationAdmin,
      index === 0 ? undefined : mutationAddresses[pipeline[index - 1]!.nodeId],
      mutationAddresses,
    ),
  }));
}

export function mutationArguments(item: MutationScenario): MutationArguments {
  return {
    version: 1,
    changes: [
      {
        kind: "pay",
        nodeId: "fee",
        expectedRevision: "0",
        recipient: mutationReplacement,
        payoutValue: { kind: "fixed", amountStroops: "20" },
      },
      {
        kind: "split",
        nodeId: "split",
        expectedRevision: "0",
        rows: [],
        additionalRecipients: [
          {
            rowId: "replacement",
            recipient: mutationReplacement,
            allocation: item.fixed
              ? { kind: "fixed", amountStroops: "85" }
              : { kind: "percentage", bps: 8500 },
          },
        ],
      },
    ],
  };
}
export function mutationIntent(
  item: MutationScenario,
  deploymentId = mutationDeploymentId,
): MutationIntent {
  return MutationIntentSchema.parse({
    version: 1,
    deploymentId,
    network: "testnet",
    admin: mutationAdmin,
    rootContract: mutationAddresses.root,
    nodes: mutationConstructors(item).map((node) => ({
      nodeId: node.nodeId,
      contractAddress: node.address,
      expectedRevision: "0",
    })),
    arguments: mutationArguments(item),
    artifacts: mutationConstructors(item).map((node) => ({
      nodeId: node.nodeId,
      contractAddress: node.address,
      wasmHash: node.wasmHash,
    })),
  });
}
export function mutationPayment(
  item: MutationScenario,
  revision: "0" | "1",
  amountStroops = "120",
  nonce = "03",
): ExecutionIntent {
  return ExecutionIntentSchema.parse({
    version: 1,
    deploymentId: mutationDeploymentId,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: mutationAddresses.root,
    assetContract: mutationAsset,
    payer: mutationPayer,
    amountStroops,
    nonce: nonce.repeat(32),
    expiresAtLedger: 100,
    nodes: mutationConstructors(item).map((node, index) => ({
      nodeId: node.nodeId,
      contractAddress: node.address,
      expectedRevision: index === 0 ? "0" : revision,
    })),
    arguments: { version: 1, inputs: [] },
  });
}

/** Root mutation/payment arguments are production encodings, not test ABI mirrors. */
export function mutationPacket(item: MutationScenario): string {
  const intent = mutationIntent(item);
  const bad = structuredClone(intent.arguments);
  const split = bad.changes[1]!;
  if (split.kind !== "split") throw new Error("Expected Split mutation");
  split.additionalRecipients = undefined;
  split.rows = [{ rowId: "platform", recipient: mutationReplacement }];
  return xdr.ScVal.scvVec([
    nativeToScVal(1, { type: "u32" }),
    nativeToScVal("testnet"),
    new Address(mutationAdmin).toScVal(),
    new Address(mutationPayer).toScVal(),
    new Address(mutationAsset).toScVal(),
    xdr.ScVal.scvVec(
      mutationConstructors(item).map((node) =>
        xdr.ScVal.scvVec([
          nativeToScVal(node.nodeId),
          new Address(node.address).toScVal(),
          nativeToScVal(node.templateKind),
          xdr.ScVal.scvBytes(Buffer.from(node.wasmHash, "hex")),
          xdr.ScVal.scvVec(node.args),
        ]),
      ),
    ),
    xdr.ScVal.scvVec(mutationV1Args(intent.nodes, intent.arguments)),
    xdr.ScVal.scvVec(mutationV1Args(intent.nodes, bad)),
    xdr.ScVal.scvVec(executionV1Args(mutationPayment(item, "0", "60", "01"))),
    xdr.ScVal.scvVec(executionV1Args(mutationPayment(item, "0", "60", "02"))),
    xdr.ScVal.scvVec(executionV1Args(mutationPayment(item, "0"))),
    xdr.ScVal.scvVec(executionV1Args(mutationPayment(item, "1"))),
    xdr.ScVal.scvVec(
      mutationV1Args(intent.nodes, { version: 1, changes: [intent.arguments.changes[0]!] }),
    ),
  ]).toXDR("hex");
}
