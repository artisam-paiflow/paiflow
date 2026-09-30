import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { withErrorHandler } from "@/lib/errors";
import { pollEventsFor } from "@/lib/stellar/events";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { cronPollableDeploymentWhere } from "@/lib/sandbox";
import { CRON_LIMITS } from "@/lib/cron/config";
import { cronDeadline } from "@/lib/cron/deadline";
import { withCronLease } from "@/lib/cron/lease";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);

    const { budgetMs, ttlMs, batch, concurrency } = CRON_LIMITS.pollEvents;
    const lease = await withCronLease("poll-events", ttlMs, async () => {
      log.info("poll-events cron started");
      const deadline = cronDeadline(budgetMs);

      // Least recently attempted first, so a backlog rotates instead of the
      // same deployments taking every tick's budget. Prisma cannot put NULLs
      // first through a relation, so deployments with no cursor yet (never
      // polled) are read separately and lead, but only up to half the batch: a
      // deployment whose first poll can never write a cursor (no deploy
      // ledger, RPC retention passed) would otherwise fill every slot forever.
      // eventsPolledAt is stamped on failures too, so a scan that always
      // throws rotates to the back; cursor age breaks ties for unstamped rows.
      const where = cronPollableDeploymentWhere(new Date());
      const attemptOrder = { eventsPolledAt: { sort: "asc", nulls: "first" } } as const;
      const unpolled = await db.deployment.findMany({
        where: { AND: [where, { cursor: null }] },
        select: { id: true },
        orderBy: [attemptOrder, { createdAt: "asc" }, { id: "asc" }],
        take: Math.ceil(batch / 2),
      });
      const polledBefore = await db.deployment.findMany({
        where: { AND: [where, { cursor: { isNot: null } }] },
        select: { id: true },
        orderBy: [attemptOrder, { cursor: { updatedAt: "asc" } }, { id: "asc" }],
        take: batch - unpolled.length,
      });
      const deployments = [...unpolled, ...polledBefore];
      log.info({ deploymentCount: deployments.length }, "poll-events cron found deployments");

      let polled = 0;
      let written = 0;
      let truncated = false;
      const errors: Array<{ deploymentId: string; error: string }> = [];

      // `concurrency` workers pull from one shared queue. The deadline is checked before a
      // worker takes an item, never mid-item, so once the budget is spent nothing new starts and
      // in-flight polls finish. Each item catches its own error: one failure never stops a worker.
      let next = 0;
      const worker = async () => {
        while (true) {
          if (deadline.expired()) {
            if (next < deployments.length) truncated = true;
            return;
          }
          const d = deployments[next++];
          if (!d) return;
          try {
            const count = await pollEventsFor(d.id);
            polled += 1;
            written += count;
            if (count > 0) {
              log.info({ deploymentId: d.id, written: count }, "poll-events cron wrote events");
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log.warn({ deploymentId: d.id, err }, "poll-events cron failed for deployment");
            errors.push({ deploymentId: d.id, error: message });
          }
          // One small write per attempt, deliberately not batched at the end: a run killed
          // mid-way would otherwise lose every stamp.
          try {
            await db.deployment.updateMany({
              where: { id: d.id },
              data: { eventsPolledAt: new Date() },
            });
          } catch (err) {
            log.warn({ deploymentId: d.id, err }, "poll-events cron could not stamp attempt time");
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.max(1, Math.min(concurrency, deployments.length)) }, worker),
      );

      if (truncated) {
        log.warn(
          { budgetMs, attempted: polled + errors.length, deploymentCount: deployments.length },
          "poll-events cron out of time; the rest waits for the next run",
        );
      }

      log.info(
        {
          polled,
          written,
          deploymentCount: deployments.length,
          errorCount: errors.length,
          truncated,
        },
        "poll-events cron finished",
      );

      return { polled, written, errors: errors.length, deployments: deployments.length, truncated };
    });

    if (!lease.acquired) {
      log.info("poll-events cron skipped: previous run still active");
      return NextResponse.json({
        data: {
          polled: 0,
          written: 0,
          errors: 0,
          deployments: 0,
          truncated: false,
          leaseHeld: true,
        },
      });
    }
    return NextResponse.json({ data: lease.value });
  });
}

export const GET = POST;
