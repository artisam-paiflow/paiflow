import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { FlowGraphSchema } from "@/lib/flows/schema";
import {
  MUTATION_V1_WASM_HASHES,
  executionArtifactMetadata,
} from "@/lib/stellar/execution-artifacts";
import { MutationIntentSchema, type MutationIntent } from "@/lib/mutations/schema";
import { mutationV1Args } from "@/lib/stellar/execution-v1";
import type { ConfirmedNodeConfiguration } from "@/lib/flows/field-policies";
export const admin = Keypair.random(),
  recipient = Keypair.random().publicKey(),
  nextRecipient = Keypair.random().publicKey();
export const root = StrKey.encodeContract(Buffer.alloc(32, 70)),
  pay = StrKey.encodeContract(Buffer.alloc(32, 71));
export const asset = Asset.native().contractId(Networks.TESTNET);
export const graph = FlowGraphSchema.parse({
  nodes: [
    { id: "root", type: "on_receive", config: { asset: { kind: "native" } } },
    {
      id: "pay",
      type: "pay",
      config: {
        asset: { kind: "native" },
        recipient,
        fullAmount: false,
        amountStroops: "100",
        mode: "fixed",
      },
    },
  ],
  edges: [{ id: "e", source: "root", target: "pay" }],
  fieldPolicies: {
    version: 1,
    nodes: [{ kind: "pay", nodeId: "pay", recipient: "mutable", payoutValue: "mutable" }],
  },
});
export const snapshot = [
  {
    nodeId: "root",
    contractAddress: root,
    templateKind: "DEPOSIT_TRIGGER",
    wasmHash: MUTATION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
    artifactCapabilities: executionArtifactMetadata(
      "DEPOSIT_TRIGGER",
      MUTATION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
    ),
  },
  {
    nodeId: "pay",
    contractAddress: pay,
    templateKind: "PAYER",
    wasmHash: MUTATION_V1_WASM_HASHES.PAYER,
    artifactCapabilities: executionArtifactMetadata("PAYER", MUTATION_V1_WASM_HASHES.PAYER),
  },
];
export const configuration: ConfirmedNodeConfiguration = {
  version: 1,
  nodeId: "pay",
  contractAddress: pay,
  confirmedLedger: 100,
  revision: "0",
  policy: { nodeId: "pay", kind: "pay", recipient: "mutable", payoutValue: "mutable" },
  configuration: { kind: "pay", recipient, payoutValue: { kind: "fixed", amountStroops: "100" } },
};
export function current(deployment: Deployment) {
  return {
    supported: true as const,
    policyVersion: 1 as const,
    deploymentId: deployment.id,
    network: "testnet" as const,
    confirmedLedger: 100,
    rootContract: root,
    assetContract: asset,
    minAmountStroops: "0",
    policies: graph.fieldPolicies!,
    nodes: snapshot.map((n, i) => ({
      nodeId: n.nodeId,
      contractAddress: n.contractAddress,
      expectedRevision: "0",
      capabilities: n.artifactCapabilities,
    })),
    configurations: [structuredClone(configuration)],
    admin: admin.publicKey(),
    mutationSupported: true as const,
    obligations: [{ nodeId: "pay", obligationsStroops: "0" }],
  };
}
export function intent(deployment: Deployment): MutationIntent {
  return MutationIntentSchema.parse({
    version: 1,
    deploymentId: deployment.id,
    network: "testnet",
    admin: admin.publicKey(),
    rootContract: root,
    nodes: snapshot.map((n) => ({
      nodeId: n.nodeId,
      contractAddress: n.contractAddress,
      expectedRevision: "0",
    })),
    arguments: {
      version: 1,
      changes: [{ kind: "pay", nodeId: "pay", expectedRevision: "0", recipient: nextRecipient }],
    },
    artifacts: snapshot.map(({ nodeId, contractAddress, wasmHash }) => ({
      nodeId,
      contractAddress,
      wasmHash,
    })),
  });
}
export function transaction(mutation: MutationIntent) {
  return new TransactionBuilder(new Account(mutation.admin, "10"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(mutation.rootContract).call(
        "mutate_v1",
        ...mutationV1Args(mutation.nodes, mutation.arguments),
      ),
    )
    .setTimeout(180)
    .build();
}
