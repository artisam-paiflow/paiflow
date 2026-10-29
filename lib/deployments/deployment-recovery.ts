import "server-only";
import { TemplateKind, type Deployment, type Prisma } from "@prisma/client";
import { Address, StrKey, type rpc } from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { extractCreatedContract } from "@/lib/stellar/deploy";
import { PipelineImplementationSchema } from "@/lib/flows/implementation";

const NodeIdentitySchema = z.object({
  nodeId: z.string().min(1),
  templateKind: z.nativeEnum(TemplateKind),
  implementation: PipelineImplementationSchema.optional(),
});
const SnapshotSchema = z
  .array(
    NodeIdentitySchema.extend({
      contractAddress: z.string().refine(StrKey.isValidContract),
    }).passthrough(),
  )
  .min(1);

/** Only deployment admissions identify a factory submission. Never guess from
 * payment/charge hashes or regenerate salts from an editable graph. */
export async function deploymentSubmissionHash(tx: Prisma.TransactionClient, d: Deployment) {
  const rows = await tx.serviceTransaction.findMany({
    where: {
      work: {
        deploymentId: d.id,
        kind: {
          in: [
            // Historical admission name only; no new work uses this kind (#1138).
            "dev-payroll-deploy",
            "legacy-deployment-finality",
            `/api/deployments/${d.id}/submit`,
          ],
        },
      },
    },
    select: { txHash: true },
  });
  const hashes = new Set(rows.map((r) => r.txHash));
  if (d.deployTxHash) hashes.add(d.deployTxHash);
  if (hashes.size > 1)
    throw new AppError("CONFLICT", "Ambiguous deployment submissions require verified recovery");
  return [...hashes][0] ?? null;
}

/** The durable plan fixes vector order and template identity. A root address
 * alone cannot establish event coverage for the factory's child contracts. */
export function recoveredDeploymentReferences(
  d: Deployment,
  got?: rpc.Api.GetSuccessfulTransactionResponse,
): { contractAddress: string; pipelineSnapshot?: Prisma.InputJsonValue } {
  const params = z.array(NodeIdentitySchema).min(1).safeParse(d.paramsSnapshot);
  const stored = SnapshotSchema.safeParse(d.pipelineSnapshot);
  if (params.success) {
    const identities = params.data;
    if (new Set(identities.map((n) => n.nodeId)).size !== identities.length)
      throw new AppError("CONFLICT", "Ambiguous deployment node identities require recovery");
    let addresses: string[] | undefined;
    try {
      if (got?.returnValue?.switch().name === "scvVec")
        addresses = got.returnValue.vec()?.map((value) => {
          if (value.switch().name !== "scvAddress") throw new Error("Invalid factory result");
          return Address.fromScAddress(value.address()).toString();
        });
    } catch {
      throw new AppError("CONFLICT", "Invalid factory contract references require recovery");
    }
    const matches =
      stored.success &&
      stored.data.length === identities.length &&
      stored.data.every(
        (n, i) =>
          n.nodeId === identities[i]!.nodeId && n.templateKind === identities[i]!.templateKind,
      ) &&
      new Set(stored.data.map((n) => n.contractAddress)).size === identities.length;
    if (addresses) {
      if (
        addresses.length !== identities.length ||
        new Set(addresses).size !== identities.length ||
        addresses.some((a) => !StrKey.isValidContract(a)) ||
        (matches && stored.data.some((n, i) => n.contractAddress !== addresses![i]))
      )
        throw new AppError("CONFLICT", "Factory result does not match durable deployment plan");
      if (matches) return { contractAddress: stored.data[0]!.contractAddress };
      const pipeline = identities.map((n, i) => ({
        nodeId: n.nodeId,
        templateKind: n.templateKind,
        contractAddress: addresses![i]!,
        ...(n.implementation ? { implementation: n.implementation } : {}),
      }));
      return { contractAddress: pipeline[0]!.contractAddress, pipelineSnapshot: pipeline };
    }
    if (matches) return { contractAddress: stored.data[0]!.contractAddress };
    throw new AppError("CONFLICT", "Full deployed pipeline references must be recovered");
  }
  if (
    !Array.isArray(d.paramsSnapshot) &&
    stored.success &&
    new Set(stored.data.map((n) => n.nodeId)).size === stored.data.length &&
    new Set(stored.data.map((n) => n.contractAddress)).size === stored.data.length &&
    (!d.contractAddress || d.contractAddress === stored.data[0]!.contractAddress)
  )
    return { contractAddress: stored.data[0]!.contractAddress };
  // A malformed array represents a pipeline, never a legacy single contract.
  if (Array.isArray(d.paramsSnapshot) || d.pipelineSnapshot !== null)
    throw new AppError("CONFLICT", "Durable deployment pipeline metadata requires recovery");
  let address = d.contractAddress;
  if (!address && got) address = extractCreatedContract(got);
  if (!address) throw new AppError("CONFLICT", "Deployed contract reference must be recovered");
  return { contractAddress: address };
}
