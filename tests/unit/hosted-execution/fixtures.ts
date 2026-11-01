import { createHash } from "node:crypto";
import {
  Account,
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { ExecutionDiscoverySchema } from "@/lib/api/v1/execution-schema";
import { ExecutionIntentSchema } from "@/lib/flows/field-policies";
import {
  executionArtifactMetadata,
  EXECUTION_V1_WASM_HASHES,
} from "@/lib/stellar/execution-artifacts";
import { executionV1Args } from "@/lib/stellar/execution-v1";
import { hostedPaymentReview } from "@/lib/hosted-execution/review";
import type { ExecutePrepare } from "@/lib/api/v1/schema";

export const deploymentId = "11111111-1111-4111-8111-111111111111";
export const intentId = "22222222-2222-4222-8222-222222222222";
// Public identity of the test-only seed used by the local sign-only fixture.
export const payer = Keypair.fromPublicKey(
  "GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57",
);
export const alice = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
export const bob = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
export const root = StrKey.encodeContract(Buffer.alloc(32, 1));
export const pay = StrKey.encodeContract(Buffer.alloc(32, 2));
export const state = ExecutionDiscoverySchema.parse({
  supported: true,
  deploymentId,
  network: "testnet",
  policyVersion: 1,
  confirmedLedger: 100,
  rootContract: root,
  assetContract: StrKey.encodeContract(Buffer.alloc(32, 5)),
  minAmountStroops: "0",
  policies: {
    version: 1,
    nodes: [{ nodeId: "pay", kind: "pay", recipient: "execution", payoutValue: "constant" }],
  },
  nodes: [
    {
      nodeId: "root",
      contractAddress: root,
      expectedRevision: "0",
      capabilities: executionArtifactMetadata(
        "DEPOSIT_TRIGGER",
        EXECUTION_V1_WASM_HASHES.DEPOSIT_TRIGGER,
      ),
    },
    {
      nodeId: "pay",
      contractAddress: pay,
      expectedRevision: "0",
      capabilities: executionArtifactMetadata("PAYER", EXECUTION_V1_WASM_HASHES.PAYER),
    },
  ],
  configurations: [
    {
      version: 1,
      nodeId: "pay",
      contractAddress: pay,
      confirmedLedger: 100,
      revision: "0",
      policy: { kind: "pay", nodeId: "pay", recipient: "execution", payoutValue: "constant" },
      configuration: { kind: "pay", payoutValue: { kind: "full" } },
    },
  ],
});
if (!state.supported) throw new Error("Invalid test fixture");
export const hostedState = state;
export function preparation(input: ExecutePrepare, serial = 1) {
  const execution = ExecutionIntentSchema.parse({
    version: 1,
    deploymentId,
    networkPassphraseHash: createHash("sha256").update(Networks.TESTNET).digest("hex"),
    rootContract: root,
    assetContract: hostedState.assetContract,
    payer: input.from,
    amountStroops: input.amount,
    nonce: serial.toString(16).padStart(64, "0"),
    expiresAtLedger: 800,
    nodes: hostedState.nodes.map(({ nodeId, contractAddress, expectedRevision }) => ({
      nodeId,
      contractAddress,
      expectedRevision,
    })),
    arguments: input.arguments ?? { version: 1, inputs: [] },
  });
  const tx = new TransactionBuilder(new Account(input.from, `${serial}`), {
    networkPassphrase: Networks.TESTNET,
    fee: "100",
  })
    .addOperation(new Contract(root).call("execute_v1", ...executionV1Args(execution)))
    .setTimeout(180)
    .build();
  const prepared = {
    intent: intentId,
    xdr: tx.toXDR(),
    txHash: tx.hash().toString("hex"),
    walletAddress: input.from,
    network: "testnet" as const,
    networkPassphrase: Networks.TESTNET,
    expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
    execution,
  };
  return { prepared, feeStroops: tx.fee, ...hostedPaymentReview(hostedState, execution) };
}
export const payment = {
  from: payer.publicKey(),
  amount: "100",
  arguments: {
    version: 1 as const,
    inputs: [{ kind: "pay" as const, nodeId: "pay", recipient: alice }],
  },
};
