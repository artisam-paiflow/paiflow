import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { analyticsEventId } from "./event-id";
import { eventProperties } from "./event-policy";
import type { EventName } from "./events";
import { deliverAnalytics } from "./server";
/** Join the business write's DB transaction; delivery happens only after commit. */
export async function enqueueAnalytics(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    distinctId: string;
    name: EventName;
    properties: Record<string, unknown>;
    context: Record<string, string>;
    personProfile?: boolean;
  },
) {
  const props = eventProperties(input.name, input.properties);
  if (!props) return;
  await tx.analyticsDelivery.createMany({
    data: [
      {
        id: analyticsEventId(input.key),
        distinctId: input.distinctId,
        event: input.name,
        properties: { ...props, ...input.context } as Prisma.InputJsonObject,
        personProfile: input.personProfile ?? false,
      },
    ],
    skipDuplicates: true,
  });
}
export async function deliverOutbox({ batch = 50, budgetMs = 10_000, requestEvents = false } = {}) {
  const started = Date.now();
  let delivered = 0;
  let attempted = 0;
  const due = await db.analyticsDelivery.findMany({
    where: {
      deliveredAt: null,
      nextAttemptAt: { lte: new Date() },
      event: requestEvents ? "api_request_completed" : { not: "api_request_completed" },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: batch,
  });
  for (const row of due) {
    if (Date.now() - started >= budgetMs) break;
    const claim = await db.analyticsDelivery.updateMany({
      where: { id: row.id, deliveredAt: null, nextAttemptAt: row.nextAttemptAt },
      data: { nextAttemptAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } },
    });
    if (!claim.count) continue;
    attempted++;
    const success = await deliverAnalytics({
      id: row.id,
      distinctId: row.distinctId,
      name: row.event,
      properties: row.properties as Record<string, unknown>,
      occurredAt: row.occurredAt,
      personProfile: row.personProfile,
    });
    await db.analyticsDelivery.update({
      where: { id: row.id },
      data: success
        ? { deliveredAt: new Date() }
        : {
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(row.attempts, 7)),
            ),
          },
    });
    if (success) delivered++;
  }
  if (attempted > delivered)
    log.warn({ attempted, delivered }, "analytics: outbox delivery incomplete");
  return { attempted, delivered, truncated: attempted < due.length };
}
