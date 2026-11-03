import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  ConfirmedNodeConfigurationSchema,
  type ConfirmedNodeConfiguration,
} from "@/lib/flows/field-policies";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";

export async function recordConfigurationObservation(
  deploymentId: string,
  raw: ConfirmedNodeConfiguration,
  receipt?: { eventId: string; txHash: string },
) {
  const observation = ConfirmedNodeConfigurationSchema.parse(raw);
  const { confirmedLedger, ...configuration } = observation;
  const network = env().STELLAR_NETWORK;
  const contentHash = executionRequestDigest(configuration);
  const where = {
    deploymentId_network_nodeId_revision: {
      deploymentId,
      network,
      nodeId: observation.nodeId,
      revision: observation.revision,
    },
  };
  await db.configurationHistory.createMany({
    data: [
      {
        deploymentId,
        network,
        nodeId: observation.nodeId,
        contractAddress: observation.contractAddress,
        revision: observation.revision,
        configuration: configuration as unknown as Prisma.InputJsonValue,
        contentHash,
        observedLedger: confirmedLedger,
        ...receipt,
        ...(receipt ? { eventLedger: confirmedLedger } : {}),
      },
    ],
    skipDuplicates: true,
  });
  const saved = await db.configurationHistory.findUniqueOrThrow({ where });
  if (saved.contentHash !== contentHash || saved.contractAddress !== observation.contractAddress)
    throw new AppError(
      "UPSTREAM_RPC",
      "Conflicting confirmed configuration evidence; preparation refused",
    );
  if (receipt) {
    if (
      (saved.eventId && saved.eventId !== receipt.eventId) ||
      (saved.txHash && saved.txHash !== receipt.txHash) ||
      (saved.eventLedger !== null && saved.eventLedger !== confirmedLedger)
    )
      throw new AppError("UPSTREAM_RPC", "Conflicting revision event evidence");
    await db.configurationHistory.updateMany({
      where: { id: saved.id, eventId: null },
      data: { ...receipt, eventLedger: confirmedLedger },
    });
  }
}

/** Always separate observed history from current getter truth. Missing revisions
 * are unknown evidence, never invented from the latest configuration. */
export async function configurationHistory(
  deploymentId: string,
  input: { limit: number; cursor?: string },
) {
  if (input.cursor) {
    const cursor = await db.configurationHistory.findFirst({
      where: { id: input.cursor, deploymentId, network: env().STELLAR_NETWORK },
    });
    if (!cursor)
      throw new AppError("VALIDATION", "History cursor does not belong to this deployment");
  }
  const rows = await db.configurationHistory.findMany({
    where: { deploymentId, network: env().STELLAR_NETWORK },
    orderBy: [{ observedLedger: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const revisionRows = await db.$queryRaw<
    Array<{ nodeId: string; highest: string; count: string }>
  >`
    SELECT "nodeId", MAX("revision"::numeric)::text AS "highest", COUNT(*)::text AS "count"
    FROM "ConfigurationHistory" WHERE "deploymentId"=${deploymentId}::uuid AND "network"=${env().STELLAR_NETWORK}
    GROUP BY "nodeId"
  `;
  const revisionCoverage = revisionRows.map((row) => ({
    nodeId: row.nodeId,
    highestObservedRevision: row.highest,
    observedRevisionCount: row.count,
    missingRevisionCount: (BigInt(row.highest) + 1n - BigInt(row.count)).toString(),
  }));
  const page = rows.slice(0, input.limit);
  return {
    deploymentId,
    network: env().STELLAR_NETWORK,
    coverage: "observed-revisions-only" as const,
    // Retention gaps and pre-ingestion updates may omit earlier revisions.
    historyComplete: false as const,
    revisionCoverage,
    items: page.map((row) => ({
      id: row.id,
      configuration: ConfirmedNodeConfigurationSchema.parse({
        ...(row.configuration as Prisma.JsonObject),
        confirmedLedger: row.observedLedger,
      }),
      observedLedger: row.observedLedger,
      eventLedger: row.eventLedger,
      eventId: row.eventId,
      txHash: row.txHash,
    })),
    nextCursor: rows.length > input.limit ? page.at(-1)!.id : null,
  };
}
