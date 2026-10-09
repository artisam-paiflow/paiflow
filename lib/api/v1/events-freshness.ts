import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";
import { pollEventsFor } from "@/lib/stellar/events";

/**
 * A deployment whose event cursor was stamped less than this long ago is served from the database
 * as it stands; an older one is polled from RPC first. This is a recent-progress throttle,
 * not proof the scan reached the tip: partial coverage also stamps the cursor. It is also the least
 * time between the end of one on-demand poll of a deployment and the start of the next, whatever the poll found, so it is
 * the throttle that keeps a busy caller (or many callers sharing a demo deployment) from driving
 * RPC traffic.
 */
export const EVENTS_STALE_AFTER_MS = 10_000;

/**
 * How long a read waits for that poll before answering from the database anyway, counted from when
 * the poll started, so a caller that joins a running poll waits only for what is left of it.
 * Matches `EVENT_INGEST_DEADLINE_MS` in `lib/api/v1/execute.ts`: `sorobanRpc()` times each call out
 * at 10s and a poll is one `getEvents` per pipeline contract and page, so the poll itself is not
 * bounded.
 */
export const EVENTS_REFRESH_DEADLINE_MS = 5_000;

/**
 * How long a claim holds while its poll runs. A far-behind deployment's poll can outlast
 * `EVENTS_STALE_AFTER_MS`, and a claim that lapsed mid-poll would let another replica start a
 * second one. On finishing, the claim is cut back to `EVENTS_STALE_AFTER_MS`; this lease only
 * matters when the process dies mid-poll, and then it is how long the deployment waits.
 */
export const EVENTS_REFRESH_LEASE_MS = 60_000;

type Run = { done: Promise<void>; deadlineAt: number };

// Callers in this process that arrive while a refresh runs wait on it rather than starting another.
const inflight = new Map<string, Run>();

// Without Redis, the claim falls back to this process's memory, as `lib/rate-limit.ts` does.
const localClaims = new Map<string, number>();
const LOCAL_CLAIMS_PRUNE_AT = 1_000;

const claimKey = (deploymentId: string) => `v1:events-refresh:${deploymentId}`;

type Claim = "redis" | "local" | null;

function claimLocally(deploymentId: string, now: number): Claim {
  const until = localClaims.get(deploymentId);
  if (until !== undefined && until > now) return null;
  if (localClaims.size >= LOCAL_CLAIMS_PRUNE_AT) {
    for (const [id, expiry] of localClaims) if (expiry <= now) localClaims.delete(id);
  }
  localClaims.set(deploymentId, now + EVENTS_REFRESH_LEASE_MS);
  return "local";
}

/** One claim per deployment, shared across replicas through Redis. */
async function claimRefresh(deploymentId: string): Promise<Claim> {
  const now = Date.now();
  const client = redis();
  if (client) {
    try {
      const ok = await client.set(claimKey(deploymentId), "1", "PX", EVENTS_REFRESH_LEASE_MS, "NX");
      return ok === "OK" ? "redis" : null;
    } catch (err) {
      log.warn({ err, deploymentId }, "v1 events: refresh claim failed, claiming in-process");
    }
  }
  return claimLocally(deploymentId, now);
}

/**
 * The claim is never released, only shortened: it lapses `EVENTS_STALE_AFTER_MS` after the poll
 * ends, so an RPC failure, or a poll that left the cursor unstamped, still holds off the next
 * attempt for the full window. The overwrite is unconditional because only the claim's holder
 * reaches here and nobody else can take the key while it lives.
 */
async function rearmClaim(deploymentId: string, claim: Exclude<Claim, null>): Promise<void> {
  if (claim === "local") {
    localClaims.set(deploymentId, Date.now() + EVENTS_STALE_AFTER_MS);
    return;
  }
  try {
    await redis()?.set(claimKey(deploymentId), "1", "PX", EVENTS_STALE_AFTER_MS);
  } catch (err) {
    log.warn({ err, deploymentId }, "v1 events: could not shorten the refresh claim");
  }
}

async function refresh(deploymentId: string): Promise<void> {
  const cursor = await db.eventCursor.findUnique({
    where: { deploymentId },
    select: { updatedAt: true },
  });
  if (cursor && Date.now() - cursor.updatedAt.getTime() < EVENTS_STALE_AFTER_MS) return;
  const claim = await claimRefresh(deploymentId);
  if (!claim) return;
  try {
    await pollEventsFor(deploymentId);
  } finally {
    await rearmClaim(deploymentId, claim);
  }
}

/**
 * Before a `GET /api/v1/deployments/{id}/events` read, pull the deployment's new events from RPC
 * when its cursor is older than `EVENTS_STALE_AFTER_MS`, so a payment Paiflow did not submit shows
 * within seconds instead of on the next `cron/poll-events` run.
 *
 * Best-effort, like `ingestEventsBounded`: it never throws and never waits past
 * `EVENTS_REFRESH_DEADLINE_MS` from the poll's start; a poll cut short carries on in the background
 * and the cron picks up anything it missed. A caller on another replica while a poll runs does not
 * wait for it and reads what is stored. A cron run on the same deployment may overlap the chain
 * range, which is safe: rows are idempotent on `ContractEvent.eventId` and the cursor only moves
 * forward (`advanceEventCursor`).
 */
export async function refreshEventsIfStale(deploymentId: string): Promise<void> {
  let run = inflight.get(deploymentId);
  const started = !run;
  if (!run) {
    const done = refresh(deploymentId)
      .catch((err: unknown) => {
        log.warn({ err, deploymentId }, "v1 events: on-demand ingest failed");
      })
      .finally(() => inflight.delete(deploymentId));
    run = { done, deadlineAt: Date.now() + EVENTS_REFRESH_DEADLINE_MS };
    inflight.set(deploymentId, run);
  }

  const remaining = run.deadlineAt - Date.now();
  if (remaining <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    run.done,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        // Once per poll, not once per caller that joined it.
        if (started) log.warn({ deploymentId }, "v1 events: on-demand ingest deadline hit");
        resolve();
      }, remaining);
    }),
  ]);
  clearTimeout(timer);
}
