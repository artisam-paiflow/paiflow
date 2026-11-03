import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment } from "@prisma/client";
import {
  Account,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  WalletAddressSchema,
  ContractAddressSchema,
  ConfigurationRevisionSchema,
} from "@/lib/flows/field-policies";
import { recordConfigurationObservation } from "@/lib/mutations/history";
import { readExecutionState } from "./execution-state";
import { sorobanRpc } from "./client";
import { loadPaymentAccount } from "./load-payment-account";

const statusSchema = z
  .object({
    node_id: z.string(),
    admin: WalletAddressSchema,
    asset: ContractAddressSchema,
    parent: ContractAddressSchema,
    next_steps: z
      .array(z.object({ address: ContractAddressSchema, data: z.literal("") }).strict())
      .max(1),
    revision: z.bigint().nonnegative().transform(String).pipe(ConfigurationRevisionSchema),
    obligations: z
      .bigint()
      .nonnegative()
      .refine((v) => v <= 2n ** 127n - 1n)
      .transform(String),
  })
  .strict();
export async function readMutationState(deployment: Deployment) {
  const current = await readExecutionState(deployment);
  if (!current.supported || current.nodes.some((n) => !n.capabilities.mutation))
    throw new AppError("VALIDATION", "This deployment has no guarded mutation capability");
  const admin = WalletAddressSchema.safeParse(deployment.sourceAccount);
  if (!admin.success)
    throw new AppError("VALIDATION", "Deployment has no supported developer admin wallet");
  const server = sorobanRpc(),
    account = await loadPaymentAccount(server, admin.data);
  const statuses = [];
  // Stable-ledger current_config + mutation_status avoids mixing revisions.
  for (let offset = 1; offset < current.nodes.length; offset += 4) {
    statuses.push(
      ...(await Promise.all(
        current.nodes.slice(offset, offset + 4).map(async (node, index) => {
          const tx = new TransactionBuilder(
            new Account(account.accountId(), account.sequenceNumber()),
            { fee: BASE_FEE, networkPassphrase: stellarPassphrase() },
          )
            .addOperation(new Contract(node.contractAddress).call("mutation_status"))
            .setTimeout(30)
            .build();
          const sim = await server.simulateTransaction(tx);
          if (
            !rpc.Api.isSimulationSuccess(sim) ||
            sim.latestLedger !== current.confirmedLedger ||
            !sim.result?.retval
          )
            throw new AppError(
              "UPSTREAM_RPC",
              "Cannot verify current mutation obligations and revisions",
            );
          const status = statusSchema.parse(scValToNative(sim.result.retval));
          const position = offset + index;
          if (
            status.node_id !== node.nodeId ||
            status.admin !== admin.data ||
            status.asset !== current.assetContract ||
            status.revision !== node.expectedRevision ||
            status.parent !== current.nodes[position - 1]!.contractAddress ||
            !isDeepStrictEqual(
              status.next_steps.map((n) => n.address),
              current.nodes[position + 1] ? [current.nodes[position + 1]!.contractAddress] : [],
            )
          )
            throw new AppError(
              "UPSTREAM_RPC",
              "Mutation authority or complete path could not be verified",
            );
          return { nodeId: node.nodeId, obligationsStroops: status.obligations };
        }),
      )),
    );
  }
  if ((await server.getLatestLedger()).sequence !== current.confirmedLedger)
    throw new AppError(
      "UPSTREAM_RPC",
      "Configuration changed ledger during verification; retry the read",
    );
  for (const configuration of current.configurations)
    await recordConfigurationObservation(deployment.id, configuration);
  return { ...current, admin: admin.data, mutationSupported: true as const, obligations: statuses };
}
