import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { redis } from "@/lib/redis";
import {
  remainingInteractiveRpcMs,
  withIndependentEventRpcBudget,
} from "@/lib/stellar/interactive-rpc-budget";
import { pollEventsFor } from "@/lib/stellar/events";

/**
 * A deployment whose event cursor was stamped less than this long ago is served from the database
 * as it stands; an older one is polled from RPC first. This is a recent-progress throttle,
 * not proof the scan reached the tip: partial coverage also stamps the cursor. Ordinary event
 * reads and retries for the same confirmed ledger wait at least this long after a poll ends.
 * A newly confirmed higher ledger may bypass a completed cooldown when coverage is still behind;
 * it never bypasses a running poll's lease.
 */
export const EVENTS_STALE_AFTER_MS = 10_000;

/**
 * How long a read waits for that poll before answering from the database anyway, counted from when
 * the poll started, so a caller that joins a running poll waits only for what is left of it.
 * Matches `EVENT_INGEST_DEADLINE_MS` in `lib/api/v1/execute.ts`. A standalone poll has
 * ten-second per-RPC timeouts; an interactive worker additionally shares its initiating deadline.
 * Callers with less operation budget left wait only for that remainder.
 */
export const EVENTS_REFRESH_DEADLINE_MS = 5_000;

/**
 * How long a claim holds while its poll runs. A far-behind deployment's poll can outlast
 * `EVENTS_STALE_AFTER_MS`, and a claim that lapsed mid-poll would let another replica start a
 * second one. On finishing, the claim is cut back to `EVENTS_STALE_AFTER_MS`; this lease only
 * matters when the process dies mid-poll, and then it is how long the deployment waits.
 */
export const EVENTS_REFRESH_LEASE_MS = 60_000;

type Run = { done: Promise<void>; deadlineAt: number; throughLedger?: number };

// Callers in this process that arrive while a refresh runs wait on it rather than starting another.
const inflight = new Map<string, Run>();

// Without Redis, the claim falls back to this process's memory, as `lib/rate-limit.ts` does.
const localClaims = new Map<string, { value: string; until: number }>();
const LOCAL_CLAIMS_PRUNE_AT = 1_000;

const claimKey = (deploymentId: string) => `v1:events-refresh:${deploymentId}`;

type Claim = { kind: "redis" | "local"; token: string };

// Only a completed poll's cooldown can be bypassed for a newly confirmed ledger.
// A running poll (including an older version's "1" claim) retains its lease.
const CLAIM_NEW_LEDGER = `
local value = redis.call('GET', KEYS[1])
local previous = value and string.match(value, '^cooldown:(%d+)$')
if not previous or tonumber(previous) >= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;
const FINISH_CLAIM = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

function claimLocally(
  deploymentId: string,
  now: number,
  token: string,
  throughLedger?: number,
): Claim | null {
  const previous = localClaims.get(deploymentId);
  const attempted = previous?.value.match(/^cooldown:(\d+)$/)?.[1];
  if (
    previous &&
    previous.until > now &&
    !(throughLedger !== undefined && attempted !== undefined && throughLedger > Number(attempted))
  )
    return null;
  if (localClaims.size >= LOCAL_CLAIMS_PRUNE_AT) {
    for (const [id, claim] of localClaims) if (claim.until <= now) localClaims.delete(id);
  }
  localClaims.set(deploymentId, { value: token, until: now + EVENTS_REFRESH_LEASE_MS });
  return { kind: "local", token };
}

/** One claim per deployment, shared across replicas through Redis. */
async function claimRefresh(deploymentId: string, throughLedger?: number): Promise<Claim | null> {
  const now = Date.now();
  const token = `running:${randomUUID()}`;
  const client = redis();
  if (client) {
    try {
      const ok = await client.set(
        claimKey(deploymentId),
        token,
        "PX",
        EVENTS_REFRESH_LEASE_MS,
        "NX",
      );
      if (ok === "OK") return { kind: "redis", token };
      if (
        throughLedger !== undefined &&
        (await client.eval(
          CLAIM_NEW_LEDGER,
          1,
          claimKey(deploymentId),
          throughLedger,
          token,
          EVENTS_REFRESH_LEASE_MS,
        )) === 1
      )
        return { kind: "redis", token };
      return null;
    } catch (err) {
      log.warn({ err, deploymentId }, "v1 events: refresh claim failed, claiming in-process");
    }
  }
  return claimLocally(deploymentId, now, token, throughLedger);
}

/**
 * The claim is never released, only shortened: it lapses `EVENTS_STALE_AFTER_MS` after the poll
 * ends. The same target ledger is held off even on failure. A newer confirmed ledger can bypass
 * that cooldown; it cannot bypass a running poll. An expired owner cannot overwrite a new lease.
 */
async function rearmClaim(
  deploymentId: string,
  claim: Claim,
  throughLedger?: number,
): Promise<void> {
  const value = `cooldown:${throughLedger ?? 0}`;
  if (claim.kind === "local") {
    if (localClaims.get(deploymentId)?.value === claim.token)
      localClaims.set(deploymentId, { value, until: Date.now() + EVENTS_STALE_AFTER_MS });
    return;
  }
  try {
    await redis()?.eval(
      FINISH_CLAIM,
      1,
      claimKey(deploymentId),
      claim.token,
      value,
      EVENTS_STALE_AFTER_MS,
    );
  } catch (err) {
    log.warn({ err, deploymentId }, "v1 events: could not shorten the refresh claim");
  }
}

async function refresh(deploymentId: string, run: Run): Promise<void> {
  try {
    // A newer confirmation can join a scan whose RPC response stopped at an older tip.
    // Allow one follow-up, sharing the original caller deadline. Further goals remain eligible
    // on the next status read rather than creating an unbounded chain of background polls.
    for (let pass = 0; pass < 2; pass++) {
      const cursor = await db.eventCursor.findUnique({
        where: { deploymentId },
        select: { updatedAt: true, lastLedger: true },
      });
      const throughLedger = run.throughLedger;
      if (throughLedger !== undefined) {
        if (cursor && cursor.lastLedger >= throughLedger) return;
      } else if (cursor && Date.now() - cursor.updatedAt.getTime() < EVENTS_STALE_AFTER_MS) return;
      const claim = await claimRefresh(deploymentId, throughLedger);
      if (!claim) return;
      try {
        // This helper owns durable deployment-service admission, including when a caller's
        // five-second wait ends before the poll completes.
        await pollEventsFor(deploymentId);
      } finally {
        await rearmClaim(deploymentId, claim, throughLedger);
      }
      if ((run.throughLedger ?? 0) <= (throughLedger ?? 0)) return;
    }
  } finally {
    // Stop accepting joins before this worker resolves: deferred promise cleanup would
    // let a newer confirmation attach to a finished worker with nobody left to scan it.
    if (inflight.get(deploymentId) === run) inflight.delete(deploymentId);
  }
}

/**
 * Before a `GET /api/v1/deployments/{id}/events` read, pull the deployment's new events from RPC
 * when its cursor is older than `EVENTS_STALE_AFTER_MS`, so a payment Paiflow did not submit shows
 * within seconds instead of on the next `cron/poll-events` run. A known successful ledger
 * also catches up stored confirmations: recent cursor timestamps never substitute for coverage.
 *
 * Best-effort, like `ingestEventsBounded`: it never throws and never waits past
 * `EVENTS_REFRESH_DEADLINE_MS` from the poll's start (or the caller's remaining RPC budget).
 * A poll cut short carries on in its independently owned context, capped by the initiating
 * interactive deadline when present; the cron picks up anything it missed. A caller on another
 * replica while a poll runs does not wait for it and reads what is stored. A cron run on the same deployment may overlap the chain
 * range, which is safe: rows are idempotent on `ContractEvent.eventId` and the cursor only moves
 * forward (`advanceEventCursor`).
 */
export async function refreshEventsIfStale(
  deploymentId: string,
  throughLedger?: number,
): Promise<void> {
  const callerBudget = remainingInteractiveRpcMs(EVENTS_REFRESH_DEADLINE_MS);
  if (callerBudget <= 0) return;
  let run = inflight.get(deploymentId);
  const started = !run;
  if (!run) {
    run = {
      done: Promise.resolve(),
      deadlineAt: Date.now() + EVENTS_REFRESH_DEADLINE_MS,
      throughLedger,
    };
    // Register before starting so even a synchronous cursor error is cleaned up by the worker.
    inflight.set(deploymentId, run);
    run.done = withIndependentEventRpcBudget(() => refresh(deploymentId, run!)).catch(
      (err: unknown) => {
        log.warn({ err, deploymentId }, "v1 events: on-demand ingest failed");
      },
    );
  } else if (throughLedger !== undefined) {
    run.throughLedger = Math.max(run.throughLedger ?? 0, throughLedger);
  }

  const remaining = Math.min(callerBudget, run.deadlineAt - Date.now());
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
