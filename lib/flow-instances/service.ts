import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type Deployment, type Role } from "@prisma/client";
import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env, stellarPassphrase, stellarRelayerAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  lockAndResolveTemplateForPreparation,
  getFlowTemplate,
} from "@/lib/flow-templates/service";
import { contentHash } from "@/lib/flow-templates/artifacts";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { assertNoHiddenSurfaces } from "@/lib/features";
import { withDeploymentWork, lockDeployment } from "@/lib/deployments/service-work";
import { submitOwnedDeployment } from "@/lib/deployments/submit";
import { reconcileOwnerDeployment } from "@/lib/deployments/reconcile-owner-deployment";
import { preparedDeploymentRecovery } from "@/lib/stellar/deployment-recovery";
import { preparePipelineDeployTx, checkAccountFunding } from "@/lib/stellar/deploy";
import { assertDeploymentPreparationBudget } from "@/lib/stellar/deployment-preparation";
import { assertTemplateArtifactAvailability } from "@/lib/stellar/template-artifacts";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  InstancePrepareSchema,
  InstanceSnapshotSchema,
  InstanceStateSchema,
  type InstancePrepare,
  type InstanceListQuery,
} from "./schema";

export const MAX_ACTIVE_TEMPLATE_INSTANCES = 1000;
export const MAX_PENDING_TEMPLATE_INSTANCES = 10;
type Actor = {
  id: string;
  role: Role;
  developerApiTokenId?: string;
  assertCredential?: (tx: Prisma.TransactionClient) => Promise<void>;
};
const notFound = () => new AppError("NOT_FOUND", "Template instance not found");
function keyHash(key: string) {
  return `instance:${createHash("sha256").update(key).digest("hex")}`;
}
async function lockOwner(tx: Prisma.TransactionClient, ownerId: string) {
  const users = await tx.$queryRaw<
    { id: string; isActive: boolean; role: Role }[]
  >`SELECT id, "isActive", role FROM "User" WHERE id = ${ownerId}::uuid FOR NO KEY UPDATE`;
  if (!users[0]?.isActive || users[0].role === "SANDBOX")
    throw new AppError("FORBIDDEN", "An active full owner account is required");
}
function instanceSnapshot(row: Deployment) {
  const snapshot = InstanceSnapshotSchema.parse(row.instanceSnapshot);
  if (
    snapshot.ownerId !== row.ownerId ||
    snapshot.templateVersionId !== row.templateVersionId ||
    snapshot.network !== row.network ||
    snapshot.sourceAccount !== row.sourceAccount
  )
    throw new AppError("CONFLICT", "Instance admission evidence does not match its deployment");
  return snapshot;
}
export async function getOwnedInstance(ownerId: string, templateId: string, instanceId: string) {
  const row = await db.deployment.findFirst({
    where: { id: instanceId, ownerId, templateVersion: { templateId, template: { ownerId } } },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!row) throw notFound();
  if (row.network !== env().STELLAR_NETWORK) throw notFound();
  instanceSnapshot(row);
  return row;
}
/** Public-to-the-owner allowlist, never relayer/webhook secrets or raw signing data. */
export function instanceState(row: Deployment) {
  const snapshot = instanceSnapshot(row);
  let prepared = null;
  if (row.status === "PENDING_SIGNATURE" && row.unsignedXdr && row.preparedTxHash) {
    const tx = TransactionBuilder.fromXDR(row.unsignedXdr, stellarPassphrase());
    if (
      !(tx instanceof Transaction) ||
      tx.source !== row.sourceAccount ||
      tx.hash().toString("hex") !== row.preparedTxHash ||
      tx.signatures.length ||
      tx.toEnvelope().switch().name !== "envelopeTypeTx"
    )
      throw new AppError("CONFLICT", "Prepared instance identity is inconsistent");
    prepared = {
      xdr: row.unsignedXdr,
      txHash: row.preparedTxHash,
      networkPassphrase: stellarPassphrase(),
      expiresAt: new Date(Number(tx.timeBounds!.maxTime) * 1000).toISOString(),
      feeStroops: tx.fee,
    };
  }
  const pipeline = Array.isArray(row.pipelineSnapshot)
    ? row.pipelineSnapshot.map((node) => {
        if (!node || typeof node !== "object" || Array.isArray(node))
          throw new AppError("CONFLICT", "Invalid instance pipeline evidence");
        return {
          nodeId: node.nodeId,
          contractAddress: node.contractAddress,
          templateKind: node.templateKind,
        };
      })
    : [];
  return InstanceStateSchema.parse({
    deploymentId: row.id,
    templateId: snapshot.templateId,
    templateVersionId: snapshot.templateVersionId,
    network: row.network,
    sourceAccount: row.sourceAccount,
    status: row.status,
    serviceState: row.serviceState,
    txHash: row.deployTxHash ?? row.preparedTxHash,
    contractAddress: row.contractAddress,
    pipeline,
    prepared,
  });
}
export async function prepareTemplateInstance(
  actor: Actor,
  templateId: string,
  versionId: string,
  input: InstancePrepare,
  req: NextRequest,
) {
  input = InstancePrepareSchema.parse(input);
  input = {
    ...input,
    bindings: {
      ...input.bindings,
      templateVersionId: input.bindings.templateVersionId.toLowerCase(),
    },
  };
  templateId = templateId.toLowerCase();
  versionId = versionId.toLowerCase();
  if (actor.role === "SANDBOX")
    throw new AppError("FORBIDDEN", "Private instances are unavailable in sandbox sessions");
  await enforceRateLimit({
    key: `template-instance:prepare:${actor.id}`,
    limit: 30,
    windowSeconds: 60,
  });
  const network = env().STELLAR_NETWORK;
  const digest = contentHash({
    ownerId: actor.id,
    templateId,
    versionId,
    network,
    sourceAccount: input.sourceAccount,
    bindings: input.bindings,
  });
  const admission = await db.$transaction(async (tx) => {
    // Quotas, credential changes and overlapping selections serialize per owner.
    // No global source-wallet reservation can be spoofed by a different owner.
    await lockOwner(tx, actor.id);
    if (actor.assertCredential) await actor.assertCredential(tx);
    const old = await tx.deployment.findUnique({
      where: {
        ownerId_idempotencyKey: {
          ownerId: actor.id,
          idempotencyKey: keyHash(input.idempotencyKey),
        },
      },
    });
    if (old) {
      if (!old.templateVersionId || old.instanceRequestDigest !== digest)
        throw new AppError(
          "CONFLICT",
          "Idempotency key already identifies a different instance request",
        );
      return { row: old, fresh: false as const };
    }
    const resolved = await lockAndResolveTemplateForPreparation(
      tx,
      actor.id,
      templateId,
      versionId,
      input.bindings,
    );
    const active = await tx.deployment.count({
      where: {
        ownerId: actor.id,
        templateVersionId: { not: null },
        serviceState: { not: "RETIRED" },
        status: { not: "FAILED" },
      },
    });
    const pending = await tx.deployment.count({
      where: {
        ownerId: actor.id,
        templateVersionId: { not: null },
        status: { in: ["BUILDING", "PENDING_SIGNATURE", "SUBMITTED"] },
      },
    });
    if (active >= MAX_ACTIVE_TEMPLATE_INSTANCES || pending >= MAX_PENDING_TEMPLATE_INSTANCES)
      throw new AppError(
        "CONFLICT",
        "Instance admission quota reached; reconcile pending work or retire active instances",
      );
    if (
      await tx.deployment.count({
        where: {
          ownerId: actor.id,
          sourceAccount: input.sourceAccount,
          status: { in: ["BUILDING", "PENDING_SIGNATURE", "SUBMITTED"] },
        },
      })
    )
      throw new AppError(
        "CONFLICT",
        "This owner's wallet already has a pending deployment; reconcile its original identity first",
      );
    const maxTime = Math.min(
      Math.floor(Date.now() / 1000) + 180,
      resolved.version.expiresAt
        ? Math.floor(resolved.version.expiresAt.getTime() / 1000)
        : Number.MAX_SAFE_INTEGER,
    );
    if (maxTime <= Math.floor(Date.now() / 1000))
      throw new AppError("CONFLICT", "Template version validity is closed");
    const graph = resolved.graph;
    const pipeline = flowToPipeline(graph, stellarRelayerAddress(), {
      ownerAddress: input.sourceAccount,
    });
    assertNoHiddenSurfaces(
      graph,
      pipeline.map((node) => node.templateKind),
    );
    const template = await tx.flowTemplate.findUniqueOrThrow({ where: { id: templateId } });
    const flow = await tx.flow.create({
      data: {
        ownerId: actor.id,
        name: `${template.name} · v${resolved.version.version}`,
        templateKind: pipeline[0]!.templateKind,
        graph,
        parameters: {},
      },
    });
    const snapshot = InstanceSnapshotSchema.parse({
      version: 1,
      templateId,
      templateVersionId: versionId,
      templateVersion: resolved.version.version,
      contentHash: resolved.version.contentHash,
      ownerId: actor.id,
      sourceAccount: input.sourceAccount,
      network,
      bindings: resolved.bindings,
      artifacts: resolved.artifacts,
      maxTime,
    });
    const row = await tx.deployment.create({
      data: {
        ownerId: actor.id,
        flowId: flow.id,
        network,
        status: "BUILDING",
        graphSnapshot: graph,
        paramsSnapshot: pipeline as unknown as Prisma.InputJsonValue,
        sourceAccount: input.sourceAccount,
        templateVersionId: versionId,
        instanceSnapshot: snapshot,
        instanceRequestDigest: digest,
        idempotencyKey: keyHash(input.idempotencyKey),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: "FLOW_INSTANCE_ADMIT",
        ip: clientIp(req),
        metadata: {
          deploymentId: row.id,
          templateId,
          templateVersionId: versionId,
          contentHash: resolved.version.contentHash,
          sourceAccount: input.sourceAccount,
        },
      },
    });
    return { row, fresh: true as const, pipeline };
  });
  if (!admission.fresh) return instanceState(admission.row);
  const row = admission.row;
  const snapshot = instanceSnapshot(row);
  try {
    return await withDeploymentWork(row.id, "template-instance:prepare", async () => {
      await checkAccountFunding(snapshot.sourceAccount);
      await assertTemplateArtifactAvailability(snapshot.artifacts, row.id);
      const graph = FlowGraphSchema.parse(row.graphSnapshot);
      const params = admission.pipeline;
      const nodes = params.map((node) => {
        const artifact = snapshot.artifacts.nodes.find(
          (artifact) =>
            artifact.nodeId === node.nodeId && artifact.templateKind === node.templateKind,
        );
        if (!artifact)
          throw new AppError(
            "CONFLICT",
            "Pinned instance pipeline differs from the reviewed version",
          );
        return { ...node, wasmHash: artifact.wasmHash };
      });
      const prepared = await preparePipelineDeployTx({
        sourceAccount: snapshot.sourceAccount,
        graph,
        nodes,
        deploymentId: row.id,
        pinned: { factoryAddress: snapshot.artifacts.factoryAddress, maxTime: snapshot.maxTime },
      });
      assertDeploymentPreparationBudget(row.id);
      const tx = TransactionBuilder.fromXDR(prepared.xdr, stellarPassphrase());
      if (
        !(tx instanceof Transaction) ||
        tx.source !== snapshot.sourceAccount ||
        tx.signatures.length ||
        tx.toEnvelope().switch().name !== "envelopeTypeTx" ||
        Number(tx.timeBounds?.maxTime) > snapshot.maxTime ||
        Number(tx.timeBounds?.maxTime) <= Math.floor(Date.now() / 1000)
      )
        throw new AppError(
          "CONFLICT",
          "Instance preparation validity changed; reconcile the original admission",
        );
      const updated = await db.$transaction(async (client) => {
        const service = await lockDeployment(client, row.id);
        if (service.serviceState !== "ACTIVE")
          throw new AppError("CONFLICT", "Instance service admission is closed");
        const updated = await client.deployment.update({
          where: { id: row.id, status: "BUILDING" },
          data: {
            status: "PENDING_SIGNATURE",
            unsignedXdr: prepared.xdr,
            preparedTxHash: tx.hash().toString("hex"),
            pipelineSnapshot: prepared.pipeline as unknown as Prisma.InputJsonValue,
            contractAddress: prepared.pipeline[0]?.contractAddress,
          },
        });
        await client.auditLog.create({
          data: {
            userId: actor.id,
            action: "DEPLOY_PREPARE",
            ip: clientIp(req),
            metadata: { deploymentId: row.id, templateVersionId: versionId, network },
          },
        });
        return updated;
      });
      return instanceState(updated);
    });
  } catch (error) {
    // A completed failing preparation returned no envelope. A process crash does
    // not enter this branch: its BUILDING admission remains durably blocked.
    await db.deployment.updateMany({
      where: { id: row.id, status: "BUILDING", unsignedXdr: null },
      data: {
        status: "FAILED",
        errorMessage: "Instance preparation failed before an unsigned transaction was returned",
      },
    });
    throw error;
  }
}
export async function listTemplateInstances(
  ownerId: string,
  templateId: string,
  query: InstanceListQuery,
) {
  await getFlowTemplate(ownerId, templateId);
  const cursor = query.cursor ? await getOwnedInstance(ownerId, templateId, query.cursor) : null;
  const rows = await db.deployment.findMany({
    where: {
      ownerId,
      network: env().STELLAR_NETWORK,
      templateVersion: { templateId },
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });
  return {
    items: rows.slice(0, query.limit).map(instanceState),
    nextCursor: rows.length > query.limit ? rows[query.limit - 1]!.id : null,
  };
}
export async function submitTemplateInstance(
  actor: Actor,
  templateId: string,
  instanceId: string,
  req: NextRequest,
) {
  const row = await getOwnedInstance(actor.id, templateId, instanceId);
  // Terminal duplicate receipt reads remain possible; first send never bypasses
  // ordinary ACTIVE service admission, even when its template was retired.
  if (row.status === "CONFIRMED") {
    const response = await submitOwnedDeployment(req, row.id, actor);
    return response.ok
      ? instanceState(await getOwnedInstance(actor.id, templateId, row.id))
      : response;
  }
  const response = await withDeploymentWork(row.id, "template-instance:submit", () =>
    submitOwnedDeployment(req, row.id, actor, async (tx) => {
      await lockOwner(tx, actor.id);
      if (actor.assertCredential) await actor.assertCredential(tx);
    }),
  );
  return response.ok
    ? instanceState(await getOwnedInstance(actor.id, templateId, row.id))
    : response;
}
export async function reconcileTemplateInstance(
  ownerId: string,
  templateId: string,
  instanceId: string,
) {
  let row = await getOwnedInstance(ownerId, templateId, instanceId);
  if (row.serviceState === "RETIRED" || row.status === "CONFIRMED") return instanceState(row);
  await withDeploymentWork(
    row.id,
    "template-instance:reconcile",
    async () => {
      await reconcileOwnerDeployment(row, true);
      if (row.status === "PENDING_SIGNATURE") {
        const proof = await preparedDeploymentRecovery(row, { settlement: true });
        if (proof.status === "EXPIRED")
          await db.$transaction(async (tx) => {
            await lockDeployment(tx, row.id);
            await tx.deployment.updateMany({
              where: {
                id: row.id,
                status: "PENDING_SIGNATURE",
                deployTxHash: null,
                unsignedXdr: proof.unsignedXdr,
              },
              data: {
                status: "FAILED",
                errorMessage: "Prepared instance expired with authoritative non-inclusion coverage",
              },
            });
          });
      }
    },
    true,
  );
  row = await getOwnedInstance(ownerId, templateId, instanceId);
  return instanceState(row);
}
