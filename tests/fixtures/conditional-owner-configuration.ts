import { Account, Contract, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { ConditionalCanvasSchema } from "@/lib/flows/conditional-canvas-schema";
import {
  ConditionalMutationStateSchema,
  ConditionalMutationPreparedSchema,
  ConditionalMutationPrepareSchema,
} from "@/lib/mutations/conditional-schema";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { mutationV2Args } from "@/lib/stellar/conditional-v2-codec";
import { ConditionalMutationIntentSchema } from "@/lib/flows/conditional-v2";
import { conditionalAcceptancePlan } from "./conditional-v2-acceptance";
import { conditionalMutationDefinition } from "./conditional-v2-mutation-acceptance";
export const conditionalEditorAdmin = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 71));
export const conditionalEditorRecipient = Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 72),
).publicKey();
export function conditionalOwnerFixture() {
  const definition = conditionalMutationDefinition();
  definition.owner = conditionalEditorAdmin.publicKey();
  const plan = conditionalAcceptancePlan(definition, CONDITIONAL_V2_WASM_HASHES);
  const deploymentId = "12271227-1227-4227-8227-122712271227";
  const state = ConditionalMutationStateSchema.parse({
    version: 2,
    supported: true,
    policyVersion: 2,
    mutationSupported: true,
    deploymentId,
    network: "testnet",
    admin: definition.owner,
    definition,
    nodes: plan.bindings,
    confirmedLedger: 100,
    statuses: plan.manifest.nodes.map(({ state }) => ({ state, obligationsStroops: "0" })),
  });
  const graph = ConditionalCanvasSchema.parse({
    generation: "conditional-v2",
    nodes: [],
    edges: [],
    conditionalPolicies: { version: 2, nodes: [], condition: undefined },
  });
  const request = ConditionalMutationPrepareSchema.parse({
    admin: definition.owner,
    arguments: {
      version: 2,
      changes: [
        {
          kind: "pay",
          nodeId: "fee",
          expectedRevision: "0",
          recipient: conditionalEditorRecipient,
        },
      ],
    },
  });
  function receipt(raw: unknown = request) {
    const input = ConditionalMutationPrepareSchema.parse(raw);
    const mutation = ConditionalMutationIntentSchema.parse({
      version: 2,
      deploymentId,
      admin: definition.owner,
      networkPassphraseHash: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
      rootContract: state.nodes[0]!.contractAddress,
      definition,
      nodes: state.nodes,
      arguments: input.arguments,
    });
    const tx = new TransactionBuilder(new Account(definition.owner, "10"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(mutation.rootContract).call("mutate_v2", ...mutationV2Args(mutation)),
      )
      .setTimeout(180)
      .build();
    return ConditionalMutationPreparedSchema.parse({
      intent: "22222222-2222-4222-8222-222222222222",
      txHash: tx.hash().toString("hex"),
      walletAddress: definition.owner,
      xdr: tx.toXDR(),
      expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
      network: "testnet",
      networkPassphrase: Networks.TESTNET,
      feeStroops: tx.fee,
      mutation,
    });
  }
  return { state, graph, request, receipt, plan };
}
