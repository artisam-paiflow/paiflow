import "server-only";
import { BASE_FEE, Contract, TransactionBuilder, rpc, type Account } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConditionalExecutionIntentSchema,
  type ConditionalExecutionIntent,
} from "@/lib/flows/conditional-v2";
import { executionV2Args } from "./conditional-v2-codec";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";
import { observeRpcPhase } from "./rpc-phase";

/** Explicit conditional protocol: payer is source, signer and fee payer. */
export async function prepareConditionalExecutionTransaction(
  raw: ConditionalExecutionIntent,
  sourceAccount?: Account,
) {
  const intent = ConditionalExecutionIntentSchema.parse(raw);
  const server = sorobanRpc();
  const source =
    sourceAccount ??
    (await observeRpcPhase("payment.account", intent.deploymentId, () =>
      loadPaymentAccount(server, intent.payer),
    ));
  if (source.accountId() !== intent.payer)
    throw new AppError("VALIDATION", "Payment source must match its payer");
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(new Contract(intent.rootContract).call("execute_v2", ...executionV2Args(intent)))
    .setTimeout(180)
    .build();
  const simulation = await observeRpcPhase("payment.simulation", intent.deploymentId, () =>
    server.simulateTransaction(transaction),
  );
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  if (!rpc.Api.isSimulationSuccess(simulation))
    throw new AppError("UPSTREAM_RPC", "Payment simulation unavailable");
  return { xdr: rpc.assembleTransaction(transaction, simulation).build().toXDR() };
}
