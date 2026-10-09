import "server-only";
import { Prisma, Role, TemplateKind, TimelockMode, type TimelockRelease } from "@prisma/client";
import { z } from "zod";
import { runDeploymentWork } from "@/lib/deployments/service-work";
import { db } from "@/lib/db";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
import { log } from "@/lib/log";
import { withRelayerChannel } from "@/lib/stellar/relayer-channels";
import { cronDeadline, type CronDeadline } from "@/lib/cron/deadline";
import { CRON_LIMITS } from "@/lib/cron/config";
import { sendReleaseByRelayer, simulateReleaseByRelayer } from "@/lib/stellar/relayer";

/**
 * Drives `cron/auto-release` (#564). Each tick probes only the timelocks whose
 * `TimelockRelease` row says they can release now, simulates outside the
 * relayer lock, and takes the lock only to sign and send.
 *
 * A timelock releases its whole balance and goes back to zero, and its parent
 * can call `execute_step` again later, so one release is not the end of it.
 * The row therefore records the ledger through which the balance is known to
 * be zero (`settledLedger`); the timelock is due again when a RECEIVE event
 * for its deployment lands after that ledger, or when the daily recheck comes
 * round in case `cron/poll-events` missed one.
 */

/**
 * Template kinds the relayer releases. TIMELOCK_BRANCH (#721) is tracked as an
 * AFTER lock: the cron calls `release_by_relayer(After)`, which the contract
 * refuses with ConditionNotMet while the ledger is still before the deadline,
 * so a trailing ledger clock cannot make it pay the "before" list. Paying the
 * "before" list through the relayer is a separate, authorised request (#751),
 * never automatic.
 */
export const AUTO_RELEASE_TEMPLATE_KINDS: TemplateKind[] = [
  TemplateKind.TIMELOCK,
  TemplateKind.TIMELOCK_BRANCH,
];

/** Probes per run, so one tick stays bounded however many timelocks come due. */
export const MAX_PROBES_PER_RUN = 50;
/** Deployments whose timelocks get their first row per run. */
export const MAX_DISCOVERIES_PER_RUN = 100;
/** A settled timelock is re-probed after this long even with no new RECEIVE. */
export const SETTLED_RECHECK_MS = 24 * 60 * 60 * 1000;
/** Ledger close time trails the wall clock by a few seconds. */
export const CONDITION_RETRY_MS = 60 * 1000;
/** How far ahead of a Before lock's deadline its last settled recheck runs. */
export const PRE_DEADLINE_RECHECK_MS = 10 * 60 * 1000;
/**
 * How long a run holds a row while it probes. It covers the wait for the
 * relayer lock and a 30s finality poll; if it lapses, the worst case is a
 * second run sending a release that then fails on-chain with NothingToRelease.
 */
export const LEASE_MS = 10 * 60 * 1000;
/**
 * A Before lock is not sent this close to its deadline: the transaction lands
 * a ledger or two after it is built, and past the deadline it only reverts.
 */
export const BEFORE_DEADLINE_MARGIN_MS = 10 * 1000;
const FAILURE_BACKOFF_BASE_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
// A Postgres timestamp, and a JS Date, stop well before u64 seconds do.
const MAX_UNLOCK_SECONDS = 253_402_300_799; // 9999-12-31T23:59:59Z

// Mirrors `Error` in contracts/conditions/timelock/src/lib.rs, and the same
// three codes in contracts/conditions/timelock_branch/src/lib.rs.
const TIMELOCK_UNAUTHORIZED = 2;
const TIMELOCK_CONDITION_NOT_MET = 3;
const TIMELOCK_NOTHING_TO_RELEASE = 4;

export type AutoReleaseDetail = {
  deploymentId: string;
  contractAddress: string;
  status: "released" | "skipped" | "failed";
  error?: string;
};

export type AutoReleaseSummary = {
  discovered: number;
  released: number;
  skipped: number;
  failed: number;
  details: AutoReleaseDetail[];
  /** True when the run stopped at its time budget with due timelocks unprobed. */
  truncated: boolean;
};

const SnapshotNodeSchema = z.object({
  nodeId: z.string(),
  contractAddress: z.string().min(1),
  templateKind: z.string(),
});

const TimelockParamsNodeSchema = z.object({
  nodeId: z.string(),
  params: z.object({
    kind: z.literal("timelock"),
    unlockTime: z.number().int().nonnegative().max(MAX_UNLOCK_SECONDS),
    mode: z.enum(["after", "before"]),
  }),
});

const TimelockBranchParamsNodeSchema = z.object({
  nodeId: z.string(),
  params: z.object({
    kind: z.literal("timelock_branch"),
    unlockTime: z.number().int().nonnegative().max(MAX_UNLOCK_SECONDS),
  }),
});

function relayerEligible(now: Date): Prisma.TimelockReleaseWhereInput {
  return {
    unsupportedReason: null,
    // Rows only ever exist for deployments the discovery below loaded, which
    // already excludes sandbox owners; this keeps it true if an owner's role
    // or a deployment's status changes afterwards.
    deployment: {
      serviceState: "ACTIVE",
      status: "CONFIRMED",
      owner: { role: { not: Role.SANDBOX } },
    },
    AND: [
      { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      {
        // The contract's own rule: After releases at or past unlock_time,
        // Before at or before it. Outside it the simulation can only revert.
        OR: [
          { mode: TimelockMode.AFTER, unlockAt: { lte: now } },
          { mode: TimelockMode.BEFORE, unlockAt: { gte: now } },
        ],
      },
    ],
  };
}

function windowOpen(row: Pick<TimelockRelease, "mode" | "unlockAt">, at: Date): boolean {
  if (!row.unlockAt) return false;
  if (row.mode === TimelockMode.AFTER) return at.getTime() >= row.unlockAt.getTime();
  if (row.mode === TimelockMode.BEFORE) {
    return at.getTime() + BEFORE_DEADLINE_MARGIN_MS <= row.unlockAt.getTime();
  }
  return false;
}

/**
 * When a settled timelock is probed again without a RECEIVE to wake it. A
 * Before lock also gets one last look shortly ahead of its deadline, since
 * after it the funds can never be released.
 */
function settledRecheckAt(row: Pick<TimelockRelease, "mode" | "unlockAt">, now: Date): Date {
  const daily = now.getTime() + SETTLED_RECHECK_MS;
  if (row.mode !== TimelockMode.BEFORE || !row.unlockAt) return new Date(daily);
  const lastLook = row.unlockAt.getTime() - PRE_DEADLINE_RECHECK_MS;
  return new Date(lastLook > now.getTime() ? Math.min(daily, lastLook) : daily);
}

/**
 * Give every timelock of a confirmed, non-sandbox deployment a row the first
 * time the cron meets it. This is how deployments that predate the table are
 * picked up, and it is also the path for new ones: nothing at deploy time has
 * to know about this table. Parameters come from `paramsSnapshot`, which holds
 * the exact constructor arguments the factory deployed, so no RPC is needed.
 */
export async function discoverTimelocks(now: Date): Promise<number> {
  const deployments = await db.deployment.findMany({
    where: {
      status: "CONFIRMED",
      serviceState: "ACTIVE",
      owner: { role: { not: Role.SANDBOX } },
      timelockReleases: { none: {} },
      OR: AUTO_RELEASE_TEMPLATE_KINDS.map((kind) => ({
        pipelineSnapshot: { array_contains: [{ templateKind: kind }] },
      })),
    },
    select: { id: true, pipelineSnapshot: true, paramsSnapshot: true },
    orderBy: { createdAt: "asc" },
    take: MAX_DISCOVERIES_PER_RUN,
  });

  const rows: Prisma.TimelockReleaseCreateManyInput[] = [];
  for (const d of deployments) {
    const snapshot = Array.isArray(d.pipelineSnapshot) ? d.pipelineSnapshot : [];
    const params = Array.isArray(d.paramsSnapshot) ? d.paramsSnapshot : [];

    for (const raw of snapshot) {
      const node = SnapshotNodeSchema.safeParse(raw);
      if (!node.success) continue;
      const kind = AUTO_RELEASE_TEMPLATE_KINDS.find((k) => k === node.data.templateKind);
      if (!kind) continue;

      const base = {
        deploymentId: d.id,
        nodeId: node.data.nodeId,
        contractAddress: node.data.contractAddress,
        templateKind: kind,
      };
      const parsed = params
        .map((p) =>
          kind === TemplateKind.TIMELOCK_BRANCH
            ? TimelockBranchParamsNodeSchema.safeParse(p)
            : TimelockParamsNodeSchema.safeParse(p),
        )
        .find((p) => p.success && p.data.nodeId === node.data.nodeId);

      if (!parsed?.success) {
        log.warn(
          { deploymentId: d.id, contractAddress: base.contractAddress },
          "auto-release: timelock parameters missing from paramsSnapshot; not auto-releasing it",
        );
        rows.push({
          ...base,
          unsupportedReason: "unlock time or mode missing from paramsSnapshot",
        });
        continue;
      }

      const unlockAt = new Date(parsed.data.params.unlockTime * 1000);
      const mode =
        "mode" in parsed.data.params && parsed.data.params.mode === "before"
          ? TimelockMode.BEFORE
          : TimelockMode.AFTER;
      rows.push({
        ...base,
        mode,
        unlockAt,
        // An After lock is worth a first probe at its unlock time; a Before
        // lock is open from the start, and then only until its deadline.
        nextProbeAt: mode === TimelockMode.AFTER ? unlockAt : now,
      });
    }
  }

  if (rows.length === 0) return 0;
  // A concurrent run may have discovered the same deployment; the unique
  // contractAddress makes the second insert a no-op.
  const { count } = await db.timelockRelease.createMany({ data: rows, skipDuplicates: true });
  return count;
}

/**
 * The rows to probe this run: those whose `nextProbeAt` has come, then settled
 * ones whose deployment has a RECEIVE event past the ledger they settled at.
 */
export async function selectDueTimelocks(now: Date): Promise<TimelockRelease[]> {
  const eligible = relayerEligible(now);
  const scheduled = await db.timelockRelease.findMany({
    where: { ...eligible, nextProbeAt: { lte: now } },
    orderBy: { nextProbeAt: "asc" },
    take: MAX_PROBES_PER_RUN,
  });
  if (scheduled.length >= MAX_PROBES_PER_RUN) return scheduled;

  // One bounded query rather than loading every settled row: an After lock
  // stays settled for good once released, so that set only grows. The
  // EXISTS probe is served by ContractEvent(deploymentId, kind, ledger).
  // Timestamps are compared as UTC `timestamp`, the type Prisma stores.
  const nowUtc = now.toISOString();
  const limit = MAX_PROBES_PER_RUN - scheduled.length;
  const wokenIds = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t."id"
    FROM "TimelockRelease" t
    JOIN "Deployment" d ON d."id" = t."deploymentId"
    JOIN "User" u ON u."id" = d."ownerId"
    WHERE t."unsupportedReason" IS NULL
      AND t."settledLedger" IS NOT NULL
      AND t."nextProbeAt" > (${nowUtc}::timestamptz AT TIME ZONE 'UTC')
      AND (t."leaseUntil" IS NULL OR t."leaseUntil" < (${nowUtc}::timestamptz AT TIME ZONE 'UTC'))
      AND (
        (t."mode" = 'AFTER' AND t."unlockAt" <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC'))
        OR (t."mode" = 'BEFORE' AND t."unlockAt" >= (${nowUtc}::timestamptz AT TIME ZONE 'UTC'))
      )
      AND d."status" = 'CONFIRMED'
      AND d."serviceState" = 'ACTIVE'
      AND u."role" <> 'SANDBOX'
      AND EXISTS (
        SELECT 1 FROM "ContractEvent" e
        WHERE e."deploymentId" = t."deploymentId"
          AND e."kind" = 'RECEIVE'
          AND e."ledger" > t."settledLedger"
      )
    ORDER BY t."settledLedger" ASC
    LIMIT ${limit}
  `;
  if (wokenIds.length === 0) return scheduled;

  const woken = await db.timelockRelease.findMany({
    where: { id: { in: wokenIds.map((r) => r.id) } },
  });
  return [...scheduled, ...woken];
}

type SimVerdict =
  | { kind: "not_yet" }
  | { kind: "empty" }
  | { kind: "unsupported"; reason: string }
  | { kind: "error" };

/**
 * Read a simulation revert as one of the timelock's own errors. Only the frame
 * that originated the error counts, and only when it is this contract's: a
 * downstream contract failing with its own #3 or #4 must not read as
 * "not due" or "empty", or a funded timelock would be parked as settled.
 * The diagnostic log is newest-first, so the originator is the last frame.
 */
export function classifySimulationError(contractAddress: string, error: string): SimVerdict {
  if (/non-existent contract function/i.test(error)) {
    return { kind: "unsupported", reason: "contract has no release_by_relayer (older WASM)" };
  }
  const frames = [
    ...error.matchAll(
      /contract:(C[A-Z0-9]{55}),\s*topics:\[error,\s*Error\(Contract,\s*#?(\d+)\)\]/g,
    ),
  ];
  const origin = frames[frames.length - 1];
  if (!origin || origin[1] !== contractAddress) return { kind: "error" };
  switch (Number(origin[2])) {
    case TIMELOCK_CONDITION_NOT_MET:
      return { kind: "not_yet" };
    case TIMELOCK_NOTHING_TO_RELEASE:
      return { kind: "empty" };
    case TIMELOCK_UNAUTHORIZED:
      // release_by_relayer refuses when relayer == admin, i.e. the pipeline
      // was deployed without STELLAR_RELAYER_ADDRESS. That never changes.
      return { kind: "unsupported", reason: "deployed without a dedicated relayer" };
    default:
      return { kind: "error" };
  }
}

function failureUpdate(row: TimelockRelease, now: Date, error: string) {
  const failureCount = row.failureCount + 1;
  const delay = Math.min(
    FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(failureCount - 1, 20),
    FAILURE_BACKOFF_MAX_MS,
  );
  return {
    failureCount,
    lastError: error.slice(0, 1000),
    nextProbeAt: new Date(now.getTime() + delay),
    leaseUntil: null,
  };
}

async function probe(row: TimelockRelease, now: Date): Promise<AutoReleaseDetail> {
  const detail = { deploymentId: row.deploymentId, contractAddress: row.contractAddress };

  // Claim the row so an overlapping run skips it rather than simulating and
  // sending the same release.
  const claim = await db.timelockRelease.updateMany({
    where: { id: row.id, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claim.count === 0) return { ...detail, status: "skipped" };

  const update = (data: Prisma.TimelockReleaseUpdateInput) =>
    db.timelockRelease.update({ where: { id: row.id }, data: { ...data, leaseUntil: null } });

  try {
    // The old timelock's release_by_relayer takes no argument; the two-outcome
    // one takes the side it intends, and the cron only ever intends "after".
    const side = row.templateKind === TemplateKind.TIMELOCK_BRANCH ? ("after" as const) : undefined;
    const sim = side
      ? await simulateReleaseByRelayer(row.contractAddress, side)
      : await simulateReleaseByRelayer(row.contractAddress);

    if (!sim.ok) {
      const verdict = classifySimulationError(row.contractAddress, sim.error);
      switch (verdict.kind) {
        case "empty":
          // Balance is zero as of the ledger the simulation read.
          await update({
            settledLedger: sim.latestLedger,
            nextProbeAt: settledRecheckAt(row, now),
            failureCount: 0,
            lastError: null,
          });
          return { ...detail, status: "skipped" };
        case "not_yet":
          await update({ nextProbeAt: new Date(now.getTime() + CONDITION_RETRY_MS) });
          return { ...detail, status: "skipped" };
        case "unsupported":
          log.warn(
            { ...detail, reason: verdict.reason },
            "auto-release: relayer cannot release this timelock; it will not be probed again",
          );
          await update({ unsupportedReason: verdict.reason, nextProbeAt: null });
          return { ...detail, status: "skipped" };
        case "error":
          log.warn({ ...detail, error: sim.error }, "auto-release: simulation failed");
          await update(failureUpdate(row, now, sim.error));
          return { ...detail, status: "failed", error: sim.error };
        default: {
          const unreachable: never = verdict;
          throw new Error(`unhandled verdict ${JSON.stringify(unreachable)}`);
        }
      }
    }

    const send = await withRelayerChannel(async (channel) => {
      // The lock can be queued behind other relayer work; a Before lock whose
      // deadline passed meanwhile would only revert on-chain for a fee.
      if (!windowOpen(row, new Date())) return null;
      return side
        ? sendReleaseByRelayer(row.contractAddress, sim.sim, side, channel)
        : sendReleaseByRelayer(row.contractAddress, sim.sim, undefined, channel);
    });

    if (!send) {
      await update({});
      return { ...detail, status: "skipped" };
    }

    if (send.status === "SUCCESS") {
      invalidateDashboardBalances(row.deploymentId, send.txHash);
      log.info({ ...detail, txHash: send.txHash }, "auto-release: released timelock");
      await update({
        // The balance was zeroed somewhere inside this ledger, so a refill
        // later in the same ledger has to wake it too: settle one ledger
        // short. The cost is one extra probe when the release's own RECEIVE
        // events are ingested, which finds it empty and settles past them.
        settledLedger: (send.ledger ?? sim.latestLedger + 1) - 1,
        lastReleasedAt: new Date(),
        lastReleaseTxHash: send.txHash,
        nextProbeAt: settledRecheckAt(row, now),
        failureCount: 0,
        lastError: null,
      });
      return { ...detail, status: "released" };
    }

    const message = send.errorMessage ?? "release failed";
    log.warn({ ...detail, txHash: send.txHash, error: message }, "auto-release: submission failed");
    await update(failureUpdate(row, now, message));
    return { ...detail, status: "failed", error: message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ ...detail, error: message }, "auto-release: probe failed");
    await update(failureUpdate(row, now, message)).catch((updateErr: unknown) => {
      log.error({ ...detail, err: updateErr }, "auto-release: could not record the failure");
    });
    return { ...detail, status: "failed", error: message };
  }
}

export async function runAutoRelease(
  now: Date = new Date(),
  deadline: CronDeadline = cronDeadline(CRON_LIMITS.autoRelease.budgetMs),
): Promise<AutoReleaseSummary> {
  let discovered = 0;
  try {
    discovered = await discoverTimelocks(now);
  } catch (err) {
    // Already-known timelocks can still be released this tick.
    log.error({ err }, "auto-release: timelock discovery failed");
  }

  const due = await selectDueTimelocks(now);
  const details: AutoReleaseDetail[] = [];
  let truncated = false;
  for (const row of due) {
    // Unprobed rows stay unclaimed, so the next run finds them still due.
    if (deadline.expired()) {
      truncated = true;
      log.warn(
        { budgetMs: deadline.budgetMs, probed: details.length, due: due.length },
        "auto-release: out of time; the rest waits for the next run",
      );
      break;
    }
    // A run can take minutes; backoff and leases are measured from each probe.
    const detail = await runDeploymentWork(row.deploymentId, "auto-release", () =>
      probe(row, new Date(Math.max(now.getTime(), Date.now()))),
    );
    if (detail) details.push(detail);
  }

  return {
    discovered,
    released: details.filter((d) => d.status === "released").length,
    skipped: details.filter((d) => d.status === "skipped").length,
    failed: details.filter((d) => d.status === "failed").length,
    details,
    truncated,
  };
}
