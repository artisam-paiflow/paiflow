import "server-only";
import { rpc, scValToNative } from "@stellar/stellar-sdk";
import { EventKind } from "@prisma/client";
import { sorobanRpc } from "./client";
import { db } from "@/lib/db";
import { redis, eventChannel } from "@/lib/redis";
import { log } from "@/lib/log";

export async function pollEventsFor(deploymentId: string): Promise<number> {
  const deployment = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: { cursor: true },
  });
  if (!deployment?.contractAddress || deployment.status !== "CONFIRMED") return 0;

  const server = sorobanRpc();
  const startLedger = (deployment.cursor?.lastLedger ?? 0) + 1;

  let resp: rpc.Api.GetEventsResponse;
  try {
    resp = await server.getEvents({
      startLedger: startLedger > 0 ? startLedger : undefined,
      filters: [{ type: "contract", contractIds: [deployment.contractAddress] }],
      limit: 100,
    });
  } catch (err) {
    log.warn({ err, deploymentId }, "getEvents failed");
    return 0;
  }

  let written = 0;
  let maxLedger = deployment.cursor?.lastLedger ?? 0;
  for (const ev of resp.events ?? []) {
    const topics = (ev.topic ?? []).map((t) => {
      try {
        return scValToNative(t);
      } catch {
        return null;
      }
    });
    const value = (() => {
      try {
        return scValToNative(ev.value);
      } catch {
        return null;
      }
    })();
    const kind = classifyEvent(topics);
    try {
      await db.contractEvent.create({
        data: {
          deploymentId: deployment.id,
          kind,
          ledger: ev.ledger,
          txHash: ev.txHash,
          payload: { topics, value } as object,
          occurredAt: new Date(ev.ledgerClosedAt),
        },
      });
      written += 1;
      const client = redis();
      if (client) {
        await client.publish(
          eventChannel(deployment.id),
          JSON.stringify({
            kind,
            ledger: ev.ledger,
            txHash: ev.txHash,
            payload: { topics, value },
            occurredAt: ev.ledgerClosedAt,
          }),
        );
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "P2002") log.warn({ err, deploymentId }, "event upsert failed");
    }
    if (ev.ledger > maxLedger) maxLedger = ev.ledger;
  }

  if (maxLedger > (deployment.cursor?.lastLedger ?? 0)) {
    await db.eventCursor.upsert({
      where: { deploymentId: deployment.id },
      update: { lastLedger: maxLedger },
      create: { deploymentId: deployment.id, lastLedger: maxLedger },
    });
  }
  return written;
}

function classifyEvent(topics: unknown[]): EventKind {
  const first = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (first.includes("distrib") || first.includes("payout") || first.includes("transfer"))
    return EventKind.PAYOUT;
  if (first.includes("receive") || first.includes("deposit")) return EventKind.RECEIVE;
  if (first.includes("claim")) return EventKind.CLAIM;
  return EventKind.STATUS_CHANGE;
}
