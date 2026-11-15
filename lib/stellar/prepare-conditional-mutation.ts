import "server-only";
import { createHash } from "node:crypto";
import { BASE_FEE, Contract, TransactionBuilder, rpc, type Account } from "@stellar/stellar-sdk";
import { stellarPassphrase, env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalMutationIntentSchema,
  type ConditionalMutationIntent,
} from "@/lib/flows/conditional-v2";
import { assertControlTransaction } from "@/lib/api/v1/control-intent";
import { mutationV2Args } from "./conditional-v2-codec";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";
import { observeRpcPhase } from "./rpc-phase";

export async function prepareConditionalMutationTransaction(
  raw: ConditionalMutationIntent,
  sourceAccount?: Account,
) {
  const mutation = ConditionalMutationIntentSchema.parse(raw);
  if (
    mutation.networkPassphraseHash !==
    createHash("sha256").update(stellarPassphrase()).digest("hex")
  )
    throw new AppError("VALIDATION", "Mutation network binding does not match this environment");
  const server = sorobanRpc();
  const source =
    sourceAccount ??
    (await observeRpcPhase("mutation.account", mutation.deploymentId, () =>
      loadPaymentAccount(server, mutation.admin),
    ));
  if (source.accountId() !== mutation.admin)
    throw new AppError("VALIDATION", "Mutation source must match its immutable admin");
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(
      new Contract(mutation.rootContract).call("mutate_v2", ...mutationV2Args(mutation)),
    )
    .setTimeout(180)
    .build();
  const simulation = await observeRpcPhase("mutation.simulation", mutation.deploymentId, () =>
    server.simulateTransaction(transaction),
  );
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  if (!rpc.Api.isSimulationSuccess(simulation))
    throw new AppError("UPSTREAM_RPC", "Mutation simulation unavailable");
  const prepared = rpc.assembleTransaction(transaction, simulation).build();
  assertControlTransaction(prepared, {
    deploymentId: mutation.deploymentId,
    network: env().STELLAR_NETWORK,
    nodeId: mutation.nodes[0]!.nodeId,
    contractAddress: mutation.rootContract,
    walletAddress: mutation.admin,
    action: "configuration.mutate",
    txHash: prepared.hash().toString("hex"),
    maxTime: prepared.timeBounds!.maxTime,
    mutationIntent: mutation,
  });
  return prepared.toXDR();
}
