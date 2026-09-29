import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";
import { pollEventsFor } from "@/lib/stellar/events";

/**
 * A deployment whose event cursor was stamped less than this long ago is served from the database
 * as it stands; an older one is polled from RPC first. It is also the least time between two
 * on-demand polls of one deployment, whatever the poll found, so it is the throttle that keeps a
 * busy caller (or many callers sharing a demo deployment) from driving RPC traffic.
 */
export const EVENTS_STALE_AFTER_MS = 10_000;

/**
 * How long a read waits for that poll before answering from the database anyway. Matches
 * `EVENT_INGEST_DEADLINE_MS` in `lib/api/v1/execute.ts`: `sorobanRpc()` times each call out at 10s
 * and a poll is one `getEvents` per pipeline contract, so the poll itself is not bounded.
 */
export const EVENTS_REFRESH_DEADLINE_MS = 5_000;

// Callers in this process that arrive while a refresh runs wait on it rather than starting another.
const inflight = new Map<string, Promise<void>>();

// Without Redis, the claim below falls back to this process's memory, as `lib/rate-limit.ts` does.
const localClaims = new Map<string, number>();
const LOCAL_CLAIMS_PRUNE_AT = 1_000;

const claimKey = (deploymentId: string) => `v1:events-refresh:${deploymentId}`;

function claimLocally(deploymentId: string, now: number): boolean {
  const until = localClaims.get(deploymentId);
  if (until !== undefined && until > now) return false;
  if (localClaims.size >= LOCAL_CLAIMS_PRUNE_AT) {
    for (const [id, expiry] of localClaims) if (expiry <= now) localClaims.delete(id);
  }
  localClaims.set(deploymentId, now + EVENTS_STALE_AFTER_MS);
  return true;
}

/**
 * One claim per deployment per `EVENTS_STALE_AFTER_MS`, shared across replicas through Redis. It is
 * never released: it lapses, so an RPC failure or a poll that found nothing (and on a ledger-less
 * interval left the cursor unstamped) still holds off the next attempt for the full window.
 */
async function claimRefresh(deploymentId: string): Promise<boolean> {
  const now = Date.now();
  const client = redis();
  if (client) {
    try {
      const ok = await client.set(claimKey(deploymentId), "1", "PX", EVENTS_STALE_AFTER_MS, "NX");
      return ok === "OK";
    } catch (err) {
      log.warn({ err, deploymentId }, "v1 events: refresh claim failed, claiming in-process");
    }
  }
  return claimLocally(deploymentId, now);
}

async function refresh(deploymentId: string): Promise<void> {
  const cursor = await db.eventCursor.findUnique({
    where: { deploymentId },
    select: { updatedAt: true },
  });
  if (cursor && Date.now() - cursor.updatedAt.getTime() < EVENTS_STALE_AFTER_MS) return;
  if (!(await claimRefresh(deploymentId))) return;
  await pollEventsFor(deploymentId);
}

/**
 * Before a `GET /api/v1/deployments/{id}/events` read, pull the deployment's new events from RPC
 * when its cursor is older than `EVENTS_STALE_AFTER_MS`, so a payment Paiflow did not submit shows
 * within seconds instead of on the next `cron/poll-events` run.
 *
 * Best-effort, like `ingestEventsBounded`: it never throws and never waits longer than
 * `EVENTS_REFRESH_DEADLINE_MS`; a poll cut short carries on in the background and the cron picks up
 * anything it missed. Concurrent calls, and a cron run on the same deployment, may overlap on the
 * chain range, which is safe: rows are idempotent on `ContractEvent.eventId` and the cursor only
 * moves forward (`advanceEventCursor`).
 */
export async function refreshEventsIfStale(deploymentId: string): Promise<void> {
  let run = inflight.get(deploymentId);
  if (!run) {
    run = refresh(deploymentId)
      .catch((err: unknown) => {
        log.warn({ err, deploymentId }, "v1 events: on-demand ingest failed");
      })
      .finally(() => inflight.delete(deploymentId));
    inflight.set(deploymentId, run);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    run,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log.warn({ deploymentId }, "v1 events: on-demand ingest deadline hit");
        resolve();
      }, EVENTS_REFRESH_DEADLINE_MS);
    }),
  ]);
  clearTimeout(timer);
}
