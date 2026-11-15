import "server-only";
import { isDeepStrictEqual } from "node:util";
import type { Deployment, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { executionRequestDigest } from "@/lib/api/v1/execution-intent";
import { ConditionalDeploymentEnvelopeSchema } from "@/lib/flows/conditional-deployment";
import {
  ConditionalNodeStateSchema,
  ConditionalConfigurationEventSchema,
  type ConditionalNodeState,
} from "@/lib/flows/conditional-v2-state";
import { conditionalArtifactMetadata } from "@/lib/stellar/conditional-artifacts";
import {
  ConditionalPipelineSnapshotSchema,
  assertOriginalConditionalConfiguration,
} from "@/lib/stellar/conditional-execution-state";
import { conditionalContractAddress } from "@/lib/stellar/conditional-v2-codec";
import { ConditionalConfigurationHistorySchema } from "./conditional-schema";

const ledgerSchema = z.number().int().positive().max(0xffff_ffff);
const receiptSchema = z
  .object({ eventId: z.string().min(1), txHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const unavailable = () =>
  new AppError(
    "UPSTREAM_RPC",
    "Conflicting conditional configuration evidence; preparation refused",
  );

/** Historical projection trusts original construction evidence, never today's
 * mutable values or a failed current RPC observation. No network writes/reads. */
export function conditionalObservationEvidence(
  deployment: Pick<
    Deployment,
    "network" | "status" | "sourceAccount" | "paramsSnapshot" | "pipelineSnapshot"
  >,
) {
  if (deployment.network !== env().STELLAR_NETWORK || deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  const evidence = ConditionalDeploymentEnvelopeSchema.parse(deployment.paramsSnapshot);
  const pipeline = ConditionalPipelineSnapshotSchema.parse(deployment.pipelineSnapshot);
  if (
    deployment.sourceAccount !== evidence.definition.owner ||
    pipeline.length !== evidence.nodes.length
  )
    throw unavailable();
  pipeline.forEach((node, index) => {
    const expected = evidence.nodes[index]!;
    if (
      node.nodeId !== expected.nodeId ||
      node.contractAddress !== expected.initialState.contractAddress ||
      node.templateKind !== expected.templateKind ||
      node.wasmHash !== evidence.manifest.nodes[index]!.wasmHash ||
      !isDeepStrictEqual(node.implementation, expected.implementation) ||
      !isDeepStrictEqual(
        node.artifactCapabilities,
        conditionalArtifactMetadata(node.templateKind, node.wasmHash),
      ) ||
      conditionalContractAddress(
        evidence.definition.owner,
        Buffer.from(node.salt, "hex"),
        stellarPassphrase(),
      ) !== node.contractAddress
    )
      throw unavailable();
  });
  return evidence;
}

function checkedState(
  original: ReturnType<typeof conditionalObservationEvidence>,
  raw: ConditionalNodeState,
) {
  const state = ConditionalNodeStateSchema.parse(raw);
  const initial = original.manifest.nodes.find((node) => node.state.nodeId === state.nodeId);
  if (!initial) throw unavailable();
  assertOriginalConditionalConfiguration(initial.state, state);
  return state;
}
export async function recordConditionalConfigurationObservation(
  deploymentId: string,
  raw: ConditionalNodeState,
  confirmedLedger: number,
  receipt?: { eventId: string; txHash: string },
) {
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  const state = checkedState(conditionalObservationEvidence(deployment), raw);
  if (receipt !== undefined) ConditionalConfigurationEventSchema.parse(state);
  return writeObservation(
    deploymentId,
    state,
    ledgerSchema.parse(confirmedLedger),
    receipt === undefined ? undefined : receiptSchema.parse(receipt),
  );
}

/** One immutable metadata read for a complete already-fenced getter observation.
 * Validate every member before any writes; the trusted context stays private. */
export async function recordConditionalConfigurationObservations(
  deploymentId: string,
  raw: ConditionalNodeState[],
  confirmedLedger: number,
) {
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  const original = conditionalObservationEvidence(deployment);
  if (
    raw.length !== original.nodes.length ||
    raw.some((state, index) => state.nodeId !== original.nodes[index]!.nodeId)
  )
    throw unavailable();
  const states = raw.map((state) => checkedState(original, state));
  const ledger = ledgerSchema.parse(confirmedLedger);
  for (const state of states) await writeObservation(deploymentId, state, ledger);
}
async function writeObservation(
  deploymentId: string,
  state: ConditionalNodeState,
  observedLedger: number,
  event?: { eventId: string; txHash: string },
) {
  const network = env().STELLAR_NETWORK;
  const contentHash = executionRequestDigest(state);
  const where = {
    deploymentId_network_nodeId_revision: {
      deploymentId,
      network,
      nodeId: state.nodeId,
      revision: state.revision,
    },
  };
  await db.configurationHistory.createMany({
    data: [
      {
        deploymentId,
        network,
        nodeId: state.nodeId,
        contractAddress: state.contractAddress,
        revision: state.revision,
        configuration: state as unknown as Prisma.InputJsonValue,
        contentHash,
        observedLedger,
        ...event,
        ...(event ? { eventLedger: observedLedger } : {}),
      },
    ],
    skipDuplicates: true,
  });
  let saved = await db.configurationHistory.findUniqueOrThrow({ where });
  if (saved.contentHash !== contentHash || saved.contractAddress !== state.contractAddress)
    throw unavailable();
  if (event) {
    const matches = (row: typeof saved) =>
      row.eventId === event.eventId &&
      row.txHash === event.txHash &&
      row.eventLedger === observedLedger;
    if (saved.eventId !== null && !matches(saved)) throw unavailable();
    if (saved.eventId === null) {
      if (saved.txHash !== null || saved.eventLedger !== null) throw unavailable();
      await db.configurationHistory.updateMany({
        where: { id: saved.id, eventId: null, txHash: null, eventLedger: null },
        data: { ...event, eventLedger: observedLedger },
      });
      // A concurrent projector may have won enrichment. Never silently accept a
      // different provenance for this same immutable node/revision/content.
      saved = await db.configurationHistory.findUniqueOrThrow({ where });
      if (!matches(saved)) throw unavailable();
    }
  }
}

export async function conditionalConfigurationHistory(
  deploymentId: string,
  input: { limit: number; cursor?: string },
) {
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: deploymentId } });
  const original = conditionalObservationEvidence(deployment);
  const network = env().STELLAR_NETWORK;
  const limit = z.number().int().min(1).max(100).parse(input.limit);
  if (
    input.cursor &&
    !(await db.configurationHistory.findFirst({
      where: { id: z.uuid().parse(input.cursor), deploymentId, network },
    }))
  )
    throw new AppError("VALIDATION", "History cursor does not belong to this deployment");
  const rows = await db.configurationHistory.findMany({
    where: { deploymentId, network },
    orderBy: [{ observedLedger: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const coverage = await db.$queryRaw<Array<{ nodeId: string; highest: string; count: string }>>`
    SELECT "nodeId", MAX("revision"::numeric)::text AS "highest", COUNT(*)::text AS "count"
    FROM "ConfigurationHistory" WHERE "deploymentId"=${deploymentId}::uuid AND "network"=${network}
    GROUP BY "nodeId"
  `;
  for (const row of coverage)
    if (!original.nodes.some((node) => node.nodeId === row.nodeId)) throw unavailable();
  coverage.sort(
    (a, b) =>
      original.nodes.findIndex((node) => node.nodeId === a.nodeId) -
      original.nodes.findIndex((node) => node.nodeId === b.nodeId),
  );
  const page = rows.slice(0, limit);
  return ConditionalConfigurationHistorySchema.parse({
    version: 2,
    deploymentId,
    network,
    coverage: "observed-revisions-only",
    historyComplete: false,
    revisionCoverage: coverage.map((row) => ({
      nodeId: row.nodeId,
      highestObservedRevision: row.highest,
      observedRevisionCount: row.count,
      missingRevisionCount: (BigInt(row.highest) + 1n - BigInt(row.count)).toString(),
    })),
    items: page.map((row) => {
      const state = ConditionalNodeStateSchema.parse(row.configuration);
      const initial = original.manifest.nodes.find((node) => node.state.nodeId === state.nodeId);
      if (
        !initial ||
        row.nodeId !== state.nodeId ||
        row.contractAddress !== state.contractAddress ||
        row.revision !== state.revision ||
        row.contentHash !== executionRequestDigest(state)
      )
        throw unavailable();
      assertOriginalConditionalConfiguration(initial.state, state);
      return {
        id: row.id,
        configuration: state,
        observedLedger: row.observedLedger,
        eventLedger: row.eventLedger,
        eventId: row.eventId,
        txHash: row.txHash,
      };
    }),
    nextCursor: rows.length > limit ? page.at(-1)!.id : null,
  });
}
