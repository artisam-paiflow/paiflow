import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment } from "@prisma/client";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  WalletAddressSchema,
  ContractAddressSchema,
  ConfigurationRevisionSchema,
} from "@/lib/flows/field-policies";
import { recordConfigurationObservation } from "@/lib/mutations/history";
import { readExecutionState } from "./execution-state";

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
  const admin = WalletAddressSchema.safeParse(deployment.sourceAccount);
  if (!admin.success)
    throw new AppError("VALIDATION", "Deployment has no supported developer admin wallet");
  let statuses: Array<{ nodeId: string; obligationsStroops: string }> = [];
  const current = await readExecutionState(deployment, async (current, getter) => {
    if (current.nodes.some((node) => !node.capabilities.mutation)) return;
    statuses = [];
    // Configuration AND obligations share one whole-path instance-version fence.
    // A balance change can alter obligations without changing the revision.
    for (let offset = 1; offset < current.nodes.length; offset += 4) {
      statuses.push(
        ...(await Promise.all(
          current.nodes.slice(offset, offset + 4).map(async (node, index) => {
            const raw = await getter(node.contractAddress, "mutation_status");
            const status = statusSchema.parse(raw);
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
  });
  if (!current.supported || current.nodes.some((node) => !node.capabilities.mutation))
    throw new AppError("VALIDATION", "This deployment has no guarded mutation capability");
  for (const configuration of current.configurations)
    await recordConfigurationObservation(deployment.id, configuration);
  return { ...current, admin: admin.data, mutationSupported: true as const, obligations: statuses };
}
