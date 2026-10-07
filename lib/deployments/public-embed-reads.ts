import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { clientIp, rateLimit, retryAfterSeconds } from "@/lib/rate-limit";
import { refreshEventsIfStale } from "@/lib/api/v1/events-freshness";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { projectPublicEvent, publicPayment, PUBLIC_EVENT_SELECT } from "./public-embed";

export async function publicEmbedDeployment(req: Request, id: string) {
  // Address-wide before lookup: changing deployment ids cannot bypass this bound.
  const limit = await rateLimit(`public-embed:reads:${clientIp(req)}`, 600, 60);
  if (!limit.ok)
    throw new AppError(
      "RATE_LIMITED",
      "Too many public reads",
      undefined,
      undefined,
      retryAfterSeconds(limit),
    );
  if (!z.string().uuid().safeParse(id).success)
    throw new AppError("NOT_FOUND", "Deployment not found");
  const deployment = await db.deployment.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      contractAddress: true,
      network: true,
      graphSnapshot: true,
      pipelineSnapshot: true,
      flow: { select: { templateKind: true } },
    },
  });
  if (
    !deployment ||
    deployment.status !== "CONFIRMED" ||
    !deployment.contractAddress ||
    !FlowGraphSchema.safeParse(deployment.graphSnapshot).success
  ) {
    throw new AppError("NOT_FOUND", "Deployment not found");
  }
  return { id: deployment.id, payment: publicPayment(deployment) };
}

/** Shared with v1: coalesces refreshes per deployment and claims across replicas.
 * Bounded wait; failures return stored history while the cron continues ingestion.
 */
export async function publicEmbedEvents(id: string) {
  await refreshEventsIfStale(id);
  const rows = await db.contractEvent.findMany({
    where: { deploymentId: id },
    orderBy: [{ ledger: "desc" }, { eventId: "desc" }],
    take: 50,
    select: PUBLIC_EVENT_SELECT,
  });
  return rows.map(projectPublicEvent);
}
