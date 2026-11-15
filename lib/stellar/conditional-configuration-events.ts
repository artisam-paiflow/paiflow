import "server-only";
import type { ContractEvent, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  conditionalObservationEvidence,
  recordConditionalConfigurationObservation,
} from "@/lib/mutations/conditional-history";
import { assertOriginalConditionalConfiguration } from "./conditional-execution-state";
import { decodeConditionalConfigurationEvent } from "./conditional-v2-codec";

const map = (raw: unknown): Record<string, unknown> => z.record(z.string(), z.unknown()).parse(raw);
const decimal = (raw: unknown): unknown =>
  typeof raw === "string" && /^(0|[1-9]\d{0,38})$/.test(raw) ? BigInt(raw) : raw;
function allocation(raw: unknown): unknown {
  if (Array.isArray(raw) && raw.length === 2 && raw[0] === "Fixed")
    return [raw[0], decimal(raw[1])];
  return raw;
}
/** Restore only the reviewed ABI's integer positions. Unknown keys, numbers,
 * enum variants and noncanonical strings remain invalid in the strict decoder. */
export function restoreConditionalConfigurationJson(raw: unknown): unknown {
  const state = { ...map(raw) };
  state.revision = decimal(state.revision);
  const tagged = state.configuration;
  if (!Array.isArray(tagged) || tagged.length !== 2) return state;
  const value = { ...map(tagged[1]) };
  if (tagged[0] === "Receive") value.min_amount = decimal(value.min_amount);
  if (tagged[0] === "Condition") value.threshold = decimal(value.threshold);
  if (tagged[0] === "Pay") value.payout_rule = allocation(value.payout_rule);
  if (tagged[0] === "Split") {
    const policy = { ...map(value.policy) };
    if (Array.isArray(policy.rows))
      policy.rows = policy.rows.map((rawRow: unknown) => {
        const row = { ...map(rawRow) };
        if (
          Array.isArray(row.allocation) &&
          row.allocation.length === 2 &&
          row.allocation[0] === "Present"
        )
          row.allocation = ["Present", allocation(row.allocation[1])];
        return row;
      });
    value.policy = policy;
    if (Array.isArray(value.additional))
      value.additional = value.additional.map((rawRow: unknown) => {
        const row = { ...map(rawRow) };
        row.allocation = allocation(row.allocation);
        return row;
      });
  }
  state.configuration = [tagged[0], value];
  return state;
}

export async function projectConditionalConfigurationEvent(
  event: Pick<ContractEvent, "deploymentId" | "eventId" | "payload" | "ledger" | "txHash">,
) {
  const payload = z
    .object({
      topics: z.tuple([z.literal("config_v2"), z.string()]),
      value: z.unknown(),
      contractAddress: z.string(),
      inSuccessfulContractCall: z.boolean().optional(),
    })
    .passthrough()
    .parse(event.payload);
  if (payload.inSuccessfulContractCall === false) return;
  const deployment = await db.deployment.findUniqueOrThrow({ where: { id: event.deploymentId } });
  const original = conditionalObservationEvidence(deployment);
  const node = original.manifest.nodes.find(
    (entry) => entry.state.contractAddress === payload.contractAddress,
  );
  if (!node || node.state.nodeId !== payload.topics[1])
    throw new Error("Untrusted conditional configuration emitter");
  const state = decodeConditionalConfigurationEvent(
    restoreConditionalConfigurationJson(payload.value),
  );
  if (state.nodeId !== payload.topics[1] || state.contractAddress !== payload.contractAddress)
    throw new Error("Conditional configuration identity differs from emitter");
  assertOriginalConditionalConfiguration(node.state, state);
  await recordConditionalConfigurationObservation(event.deploymentId, state, event.ledger, {
    eventId: event.eventId,
    txHash: event.txHash,
  });
  await db.contractEvent.update({
    where: { eventId: event.eventId },
    data: {
      kind: "STATUS_CHANGE",
      decodedData: { configuration: state } as unknown as Prisma.InputJsonValue,
    },
  });
  return state;
}
