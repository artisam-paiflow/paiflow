import "server-only";
import type { ContractEvent, Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { executionPath } from "@/lib/flows/execution-v1";
import { recordConfigurationObservation } from "@/lib/mutations/history";
import { executionArtifactMetadata } from "./execution-artifacts";
import { decodeExecutionState } from "./execution-v1";
import { assertOriginalConfiguration } from "./execution-state";
import { assetContractId } from "./assets";

/** Called on replay too: the event cursor cannot skip a failed projection. */
export async function projectConfigurationEvent(
  event: Pick<ContractEvent, "deploymentId" | "eventId" | "payload" | "ledger" | "txHash">,
) {
  const payload = z
    .object({
      topics: z.array(z.unknown()),
      value: z.unknown(),
      contractAddress: z.string(),
      inSuccessfulContractCall: z.boolean().optional(),
    })
    .passthrough()
    .safeParse(event.payload);
  if (
    !payload.success ||
    payload.data.topics[0] !== "config_v1" ||
    payload.data.inSuccessfulContractCall === false
  )
    return;
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: event.deploymentId } });
  if (deployment.network !== env().STELLAR_NETWORK || deployment.status !== "CONFIRMED")
    throw new Error("Configuration event network unavailable");
  const graph = FlowGraphSchema.parse(deployment.graphSnapshot),
    path = executionPath(graph);
  const snapshot = z
    .array(
      z.object({
        nodeId: z.string(),
        contractAddress: z.string(),
        templateKind: z.string(),
        wasmHash: z.string(),
      }),
    )
    .parse(deployment.pipelineSnapshot);
  if (
    snapshot.length !== path.length ||
    new Set(snapshot.map((n) => n.nodeId)).size !== snapshot.length ||
    new Set(snapshot.map((n) => n.contractAddress)).size !== snapshot.length ||
    path.some((n) => !snapshot.some((s) => s.nodeId === n.id)) ||
    snapshot.some((n) => !executionArtifactMetadata(n.templateKind, n.wasmHash).mutation)
  )
    throw new Error("Incomplete guarded configuration event path");
  const index = path.findIndex((n) =>
    snapshot.some((s) => s.nodeId === n.id && s.contractAddress === payload.data.contractAddress),
  );
  const node = snapshot.find((n) => n.contractAddress === payload.data.contractAddress);
  if (
    !node ||
    index < 1 ||
    payload.data.topics[1] !== node.nodeId ||
    !executionArtifactMetadata(node.templateKind, node.wasmHash)?.mutation
  )
    throw new Error("Untrusted configuration event binding");
  // JSON persistence canonicalizes bigints. Restore only ABI integer positions.
  const restore = (raw: unknown, key?: string): unknown => {
    if (
      typeof raw === "string" &&
      ["revision", "min_amount", "amount"].includes(key ?? "") &&
      /^(0|[1-9]\d*)$/.test(raw)
    )
      return BigInt(raw);
    if (Array.isArray(raw))
      return raw[0] === "Fixed" && typeof raw[1] === "string" && /^[1-9]\d*$/.test(raw[1])
        ? ["Fixed", BigInt(raw[1])]
        : raw.map((v) => restore(v));
    if (raw && typeof raw === "object")
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, restore(v, k)]));
    return raw;
  };
  const state = decodeExecutionState(restore(payload.data.value), {
    nodeId: node.nodeId,
    contractAddress: node.contractAddress,
    templateKind: node.templateKind,
    confirmedLedger: event.ledger,
  });
  const previous = snapshot.find((n) => n.nodeId === path[index - 1]!.id),
    next = snapshot.find((n) => n.nodeId === path[index + 1]?.id);
  const root = path[0]!;
  if (
    state.kind === "on_receive" ||
    root.type !== "on_receive" ||
    state.asset !== assetContractId(root.config.asset) ||
    state.parent !== previous?.contractAddress ||
    state.nextSteps.length !== (next ? 1 : 0) ||
    (next && state.nextSteps[0] !== next.contractAddress)
  )
    throw new Error("Configuration event path differs from immutable deployment");
  assertOriginalConfiguration(graph, state.configuration);
  await recordConfigurationObservation(event.deploymentId, state.configuration, {
    eventId: event.eventId,
    txHash: event.txHash,
  });
  // Decode only public on-chain configuration. Contacts and original graph stay private.
  await db.contractEvent.update({
    where: { eventId: event.eventId },
    data: {
      kind: "STATUS_CHANGE",
      decodedData: { configuration: state.configuration } as unknown as Prisma.InputJsonValue,
    },
  });
  return state.configuration;
}
