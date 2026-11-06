import "server-only";
import { BASE_FEE, Contract, TransactionBuilder, rpc, type Account } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { ExecutionIntentSchema, type ExecutionIntent } from "@/lib/flows/field-policies";
import { executionV1Args } from "./execution-v1";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";
import { observeRpcPhase } from "./rpc-phase";

/** The payer is source, signer and fee payer. No key ever enters this service. */
export async function prepareExecutionTransaction(input: ExecutionIntent, sourceAccount?: Account) {
  const intent = ExecutionIntentSchema.parse(input);
  const server = sorobanRpc();
  const source =
    sourceAccount ??
    (await observeRpcPhase("payment.account", intent.deploymentId, () =>
      loadPaymentAccount(server, intent.payer),
    ));
  if (source.accountId() !== intent.payer)
    throw new AppError("VALIDATION", "Payment source must match its payer");
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(new Contract(intent.rootContract).call("execute_v1", ...executionV1Args(intent)))
    .setTimeout(180)
    .build();
  const simulation = await observeRpcPhase("payment.simulation", intent.deploymentId, () =>
    server.simulateTransaction(tx),
  );
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  if (!rpc.Api.isSimulationSuccess(simulation))
    throw new AppError("UPSTREAM_RPC", "Payment simulation unavailable");
  return { xdr: rpc.assembleTransaction(tx, simulation).build().toXDR() };
}
