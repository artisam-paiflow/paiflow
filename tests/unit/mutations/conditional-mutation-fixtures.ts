import { Account, Contract, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Deployment } from "@prisma/client";
import { ConditionalMutationIntentSchema } from "@/lib/flows/conditional-v2";
import { ConditionalMutationStateSchema } from "@/lib/mutations/conditional-schema";
import { mutationV2Args } from "@/lib/stellar/conditional-v2-codec";
import { CONDITIONAL_V2_WASM_HASHES } from "@/lib/stellar/conditional-artifacts";
import { conditionalAcceptancePlan } from "@/tests/fixtures/conditional-v2-acceptance";
import {
  conditionalMutationDefinition,
  conditionalMutationIntent,
} from "@/tests/fixtures/conditional-v2-mutation-acceptance";
import { admin } from "./fixtures";

export { admin };
export function conditionalMutationFixture(deploymentId = "12261226-1226-4226-8226-122612261226") {
  const definition = conditionalMutationDefinition();
  definition.owner = admin.publicKey();
  const plan = conditionalAcceptancePlan(definition, CONDITIONAL_V2_WASM_HASHES);
  const original = conditionalMutationIntent();
  const mutation = ConditionalMutationIntentSchema.parse({
    ...original,
    deploymentId,
    admin: admin.publicKey(),
    rootContract: plan.bindings[0]!.contractAddress,
    definition,
    nodes: plan.bindings,
  });
  const current = ConditionalMutationStateSchema.parse({
    version: 2,
    supported: true,
    policyVersion: 2,
    deploymentId,
    network: "testnet",
    confirmedLedger: 100,
    definition,
    nodes: plan.bindings,
    statuses: plan.nodes.map((node) => ({ state: node.initialState, obligationsStroops: "0" })),
    admin: admin.publicKey(),
    mutationSupported: true,
  });
  const deployment = {
    id: deploymentId,
    ownerId: "11111111-1111-4111-8111-111111111111",
    status: "CONFIRMED",
    network: "testnet",
    serviceState: "ACTIVE",
    sourceAccount: admin.publicKey(),
    paramsSnapshot: { version: 2, generation: "conditional-v2" },
  } as unknown as Deployment;
  return { mutation, current, deployment, plan };
}
export function conditionalMutationTransaction(
  mutation = conditionalMutationFixture().mutation,
  sequence = "10",
) {
  return new TransactionBuilder(new Account(mutation.admin, sequence), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      new Contract(mutation.rootContract).call("mutate_v2", ...mutationV2Args(mutation)),
    )
    .setTimeout(180)
    .build();
}
