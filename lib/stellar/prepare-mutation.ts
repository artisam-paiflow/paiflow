import "server-only";
import { BASE_FEE, Contract, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { MutationIntentSchema, type MutationIntent } from "@/lib/mutations/schema";
import { AppError } from "@/lib/errors";
import { assertControlTransaction } from "@/lib/api/v1/control-intent";
import { mutationV1Args } from "./execution-v1";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";

export async function prepareMutationTransaction(raw: MutationIntent) {
  const intent = MutationIntentSchema.parse(raw),
    server = sorobanRpc();
  const source = await loadPaymentAccount(server, intent.admin);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(
      new Contract(intent.rootContract).call(
        "mutate_v1",
        ...mutationV1Args(intent.nodes, intent.arguments),
      ),
    )
    .setTimeout(180)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  if (!rpc.Api.isSimulationSuccess(simulation))
    throw new AppError("UPSTREAM_RPC", "Mutation simulation unavailable");
  const prepared = rpc.assembleTransaction(tx, simulation).build();
  // Unexpected address credentials must never be mistaken for source authorization.
  assertControlTransaction(prepared, {
    deploymentId: intent.deploymentId,
    network: intent.network,
    nodeId: intent.nodes[0]!.nodeId,
    contractAddress: intent.rootContract,
    walletAddress: intent.admin,
    action: "configuration.mutate",
    txHash: prepared.hash().toString("hex"),
    maxTime: prepared.timeBounds!.maxTime,
  });
  return prepared.toXDR();
}
