import "server-only";
import {
  EventKind,
  Prisma,
  Role,
  TemplateKind,
  TimelockMode,
  type TimelockRelease,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { withRelayerLock } from "@/lib/stellar/client";
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

/** Template kinds the relayer releases. #721's branching timelock joins here. */
export const AUTO_RELEASE_TEMPLATE_KINDS: TemplateKind[] = [TemplateKind.TIMELOCK];

/** Probes per run, so one tick stays bounded however many timelocks come due. */
export const MAX_PROBES_PER_RUN = 50;
/** Deployments whose timelocks get their first row per run. */
export const MAX_DISCOVERIES_PER_RUN = 100;
/** A settled timelock is re-probed after this long even with no new RECEIVE. */
export const SETTLED_RECHECK_MS = 24 * 60 * 60 * 1000;
/** Ledger close time trails the wall clock by a few seconds. */
export const CONDITION_RETRY_MS = 60 * 1000;
/**
 * How long a run holds a row while it probes. It covers the wait for the
 * relayer lock and a 30s finality poll; if it lapses, the worst case is a
 * second run sending a release that then fails on-chain with NothingToRelease.
 */
export const LEASE_MS = 10 * 60 * 1000;
const FAILURE_BACKOFF_BASE_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
// A Postgres timestamp, and a JS Date, stop well before u64 seconds do.
const MAX_UNLOCK_SECONDS = 253_402_300_799; // 9999-12-31T23:59:59Z

// Mirrors `Error` in contracts/conditions/timelock/src/lib.rs.
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

function relayerEligible(now: Date): Prisma.TimelockReleaseWhereInput {
  return {
    unsupportedReason: null,
    // Rows only ever exist for deployments the discovery below loaded, which
    // already excludes sandbox owners; this keeps it true if an owner's role
    // or a deployment's status changes afterwards.
    deployment: { status: "CONFIRMED", owner: { role: { not: Role.SANDBOX } } },
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
  if (row.mode === TimelockMode.BEFORE) return at.getTime() <= row.unlockAt.getTime();
  return false;
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
        .map((p) => TimelockParamsNodeSchema.safeParse(p))
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
      const mode = parsed.data.params.mode === "after" ? TimelockMode.AFTER : TimelockMode.BEFORE;
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

  const settled = await db.timelockRelease.findMany({
    where: { ...eligible, nextProbeAt: { gt: now }, settledLedger: { not: null } },
  });
  if (settled.length === 0) return scheduled;

  const latest = await db.contractEvent.groupBy({
    by: ["deploymentId"],
    where: {
      deploymentId: { in: [...new Set(settled.map((r) => r.deploymentId))] },
      kind: EventKind.RECEIVE,
    },
    _max: { ledger: true },
  });
  const latestByDeployment = new Map(latest.map((l) => [l.deploymentId, l._max.ledger]));
  const woken = settled.filter((r) => {
    const ledger = latestByDeployment.get(r.deploymentId);
    return ledger != null && r.settledLedger != null && ledger > r.settledLedger;
  });

  return [...scheduled, ...woken].slice(0, MAX_PROBES_PER_RUN);
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
    const sim = await simulateReleaseByRelayer(row.contractAddress);

    if (!sim.ok) {
      const verdict = classifySimulationError(row.contractAddress, sim.error);
      switch (verdict.kind) {
        case "empty":
          // Balance is zero as of the ledger the simulation read.
          await update({
            settledLedger: sim.latestLedger,
            nextProbeAt: new Date(now.getTime() + SETTLED_RECHECK_MS),
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

    const send = await withRelayerLock(async () => {
      // The lock can be queued behind other relayer work; a Before lock whose
      // deadline passed meanwhile would only revert on-chain for a fee.
      if (!windowOpen(row, new Date())) return null;
      return sendReleaseByRelayer(row.contractAddress, sim.sim);
    });

    if (!send) {
      await update({});
      return { ...detail, status: "skipped" };
    }

    if (send.status === "SUCCESS") {
      log.info({ ...detail, txHash: send.txHash }, "auto-release: released timelock");
      await update({
        // The balance was zeroed in this ledger. A refill later in the same
        // ledger is caught by the daily recheck rather than an event.
        settledLedger: send.ledger ?? sim.latestLedger,
        lastReleasedAt: new Date(),
        lastReleaseTxHash: send.txHash,
        nextProbeAt: new Date(now.getTime() + SETTLED_RECHECK_MS),
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

export async function runAutoRelease(now: Date = new Date()): Promise<AutoReleaseSummary> {
  let discovered = 0;
  try {
    discovered = await discoverTimelocks(now);
  } catch (err) {
    // Already-known timelocks can still be released this tick.
    log.error({ err }, "auto-release: timelock discovery failed");
  }

  const due = await selectDueTimelocks(now);
  const details: AutoReleaseDetail[] = [];
  for (const row of due) {
    details.push(await probe(row, now));
  }

  return {
    discovered,
    released: details.filter((d) => d.status === "released").length,
    skipped: details.filter((d) => d.status === "skipped").length,
    failed: details.filter((d) => d.status === "failed").length,
    details,
  };
}
