import "server-only";
import { BASE_FEE, Contract, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { stellarPassphrase } from "@/lib/env";
import { ExecutionIntentSchema, type ExecutionIntent } from "@/lib/flows/field-policies";
import { executionV1Args } from "./execution-v1";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";
import { simulationFailure } from "./sim-error";

/** The payer is source, signer and fee payer. No key ever enters this service. */
export async function prepareExecutionTransaction(input: ExecutionIntent) {
  const intent = ExecutionIntentSchema.parse(input);
  const server = sorobanRpc();
  const source = await loadPaymentAccount(server, intent.payer);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(new Contract(intent.rootContract).call("execute_v1", ...executionV1Args(intent)))
    .setTimeout(180)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulation)) throw simulationFailure(simulation.error);
  return { xdr: rpc.assembleTransaction(tx, simulation).build().toXDR() };
}
