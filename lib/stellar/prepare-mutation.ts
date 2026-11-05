import "server-only";
import { BASE_FEE, Contract, TransactionBuilder, rpc, type Account } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { MutationIntentSchema, type MutationIntent } from "@/lib/mutations/schema";
import { AppError } from "@/lib/errors";
import { assertControlTransaction } from "@/lib/api/v1/control-intent";
import { mutationV1Args } from "./execution-v1";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";
import { observeRpcPhase } from "./rpc-phase";

export async function prepareMutationTransaction(raw: MutationIntent, sourceAccount?: Account) {
  const intent = MutationIntentSchema.parse(raw),
    server = sorobanRpc();
  const source =
    sourceAccount ??
    (await observeRpcPhase("mutation.account", intent.deploymentId, () =>
      loadPaymentAccount(server, intent.admin),
    ));
  if (source.accountId() !== intent.admin)
    throw new AppError("VALIDATION", "Mutation source must match its developer admin");
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
  const simulation = await observeRpcPhase("mutation.simulation", intent.deploymentId, () =>
    server.simulateTransaction(tx),
  );
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
