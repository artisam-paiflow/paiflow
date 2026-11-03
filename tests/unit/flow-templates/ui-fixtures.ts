import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { FlowGraphSchema } from "@/lib/flows/schema";
import type { TemplateVersion } from "@/lib/flow-templates/client-schema";
import type { InstanceState } from "@/lib/flow-instances/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { InstanceCompiledTermsSchema } from "@/lib/flow-instances/compiled-review-schema";

export const ownerId = "11111111-1111-4111-8111-111111111111";
export const templateId = "22222222-2222-4222-8222-222222222222";
export const versionId = "33333333-3333-4333-8333-333333333333";
export const instanceId = "44444444-4444-4444-8444-444444444444";
export const payer = Keypair.fromPublicKey(
  "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
);
export const recipient = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
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
        mode: "fixed",
        amountStroops: "100",
      },
    },
  ],
  edges: [{ id: "e", source: "root", target: "pay" }],
});
export const compiledTerms = InstanceCompiledTermsSchema.parse(
  flowToPipeline(graph, undefined, { ownerAddress: payer.publicKey() }),
);
export const artifacts = {
  version: 1 as const,
  compilerAbi: 1 as const,
  factoryAddress: StrKey.encodeContract(Buffer.alloc(32, 1)),
  factoryWasmHash: "b".repeat(64),
  nodes: [
    {
      nodeId: "root",
      templateKind: "DEPOSIT_TRIGGER" as const,
      wasmHash: "a".repeat(64),
      abiHash: "c".repeat(64),
      policyVersion: 0 as const,
    },
    {
      nodeId: "pay",
      templateKind: "PAYER" as const,
      wasmHash: "a".repeat(64),
      abiHash: "c".repeat(64),
      policyVersion: 0 as const,
    },
  ],
};
export const version: TemplateVersion = {
  id: versionId,
  templateId,
  version: 1,
  network: "testnet",
  contentHash: "d".repeat(64),
  retiredAt: null,
  expiresAt: null,
  artifacts,
  definition: {
    schemaVersion: 1,
    graph,
    inputs: [
      {
        inputId: "recipient",
        label: "Customer wallet",
        type: "wallet",
        target: { nodeId: "pay", field: "recipient" },
      },
    ],
  },
};
export function receipt(): InstanceState {
  const tx = new TransactionBuilder(new Account(payer.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: "fixture", value: "instance" }))
    .setTimeout(180)
    .build();
  return {
    deploymentId: instanceId,
    templateId,
    templateVersionId: versionId,
    network: "testnet",
    sourceAccount: payer.publicKey(),
    status: "PENDING_SIGNATURE",
    serviceState: "ACTIVE",
    txHash: tx.hash().toString("hex"),
    contractAddress: null,
    pipeline: [],
    prepared: {
      xdr: tx.toXDR(),
      networkPassphrase: Networks.TESTNET,
      txHash: tx.hash().toString("hex"),
      expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
      feeStroops: tx.fee,
    },
  };
}
