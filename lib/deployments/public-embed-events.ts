import { z } from "zod";
import { integerNumber } from "@/lib/validation/number";
import type { PublicEmbedEvent } from "./public-embed";

export const PublicEventSchema = z.object({
  eventId: z.string().min(1).max(256),
  kind: z.enum([
    "RECEIVE",
    "PAYOUT",
    "CLAIM",
    "STATUS_CHANGE",
    "CANCEL",
    "SHORTFALL",
    "PAUSE",
    "RESUME",
    "FORWARD",
    "RETRIEVE",
    "ALLOWANCE",
    "RECIPIENT_UPDATED",
    "CASH_OUT",
  ]),
  ledger: integerNumber().nonnegative(),
  txHash: z.string().regex(/^[a-f0-9]{64}$/i),
  occurredAt: z.string().datetime({ offset: true }),
  amountStroops: z
    .string()
    .regex(/^\d{1,39}$/)
    .optional(),
});
export const PublicSnapshotSchema = z.object({ events: z.array(PublicEventSchema).max(50) });

export function mergePublicEvents(previous: PublicEmbedEvent[], incoming: PublicEmbedEvent[]) {
  // eventId is the chain identity. Distinct payouts in one transaction must survive.
  const events = new Map(previous.map((event) => [event.eventId, event]));
  for (const event of incoming) events.set(event.eventId, event);
  return [...events.values()]
    .sort((a, b) => b.ledger - a.ledger || b.eventId.localeCompare(a.eventId))
    .slice(0, 50);
}
