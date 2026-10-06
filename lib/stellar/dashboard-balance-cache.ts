import "server-only";
import { createHash } from "node:crypto";
import { env, stellarRelayerAddress, stellarRpcUrl } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { dashboardBalanceAdmission } from "./dashboard-balance-admission";
import {
  getWorkflowBalances,
  type BalanceDeployment,
  type BalanceTargetRead,
  type ReadWorkflowBalances,
} from "./balances";

type DashboardDeployment = BalanceDeployment & { ownerId: string; status: string };
type ReadEnvironment = { network: string; rpcUrl: string; relayerAddress?: string | null };
type Entry = {
  network: string;
  deploymentId: string;
  generation: number;
  invalidations?: Map<string, number>;
  previous?: ReadWorkflowBalances;
  result?: ReadWorkflowBalances;
  expiresAt: number;
  pending?: Promise<ReadWorkflowBalances>;
  pendingGeneration?: number;
  eviction?: ReturnType<typeof setTimeout>;
};

const DISPLAY_TTL_MS = 10_000;
const RETENTION_MS = 300_000;
// Each RPC call has the client's 10s HTTP timeout. This overall deadline
// releases waiters and stops new targets while active worker calls settle.
const REFRESH_TIMEOUT_MS = 25_000;
const MAX_ENTRIES = 256;

function staleResult(result: ReadWorkflowBalances): ReadWorkflowBalances {
  return {
    ...result,
    freshness: {
      ...result.freshness,
      status: "stale",
      totalsComplete: false,
      targets: result.freshness.targets.map((target) => ({ ...target, stale: true })),
    },
  };
}

function targetKey(target: BalanceTargetRead) {
  return JSON.stringify([target.nodeId, target.contractAddress, target.asset]);
}

/**
 * Dashboard display cache only. Coordination is local to this process; these
 * admission and retention bounds cover the current single replica. No Redis
 * or framework cache is involved.
 */
export function createDashboardBalanceCache(options?: {
  load?: (deployment: DashboardDeployment, signal?: AbortSignal) => Promise<ReadWorkflowBalances>;
  ttlMs?: number;
  retentionMs?: number;
  refreshTimeoutMs?: number;
  maxEntries?: number;
}) {
  const load =
    options?.load ??
    ((deployment, signal) =>
      dashboardBalanceAdmission.run(() => getWorkflowBalances(deployment, signal), signal));
  const ttlMs = options?.ttlMs ?? DISPLAY_TTL_MS;
  const retentionMs = options?.retentionMs ?? RETENTION_MS;
  const refreshTimeoutMs = options?.refreshTimeoutMs ?? REFRESH_TIMEOUT_MS;
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES;
  const entries = new Map<string, Entry>();
  let hits = 0;
  let joins = 0;
  let refreshes = 0;

  function retain(result: ReadWorkflowBalances, previous?: ReadWorkflowBalances) {
    const oldTargets = new Map(
      previous?.freshness.targets.map((target) => [targetKey(target), target]),
    );
    return {
      ...result,
      freshness: {
        ...result.freshness,
        targets: result.freshness.targets.map((target) => {
          if (!target.stale) return target;
          const old = oldTargets.get(targetKey(target));
          if (!old?.readAt || Date.now() - Date.parse(old.readAt) >= retentionMs) return target;
          return { ...target, balanceStroops: old.balanceStroops, readAt: old.readAt };
        }),
      },
    };
  }

  function drop(key: string, entry: Entry) {
    if (entry.eviction) clearTimeout(entry.eviction);
    if (entries.get(key) === entry) entries.delete(key);
  }

  function refresh(key: string, entry: Entry, deployment: DashboardDeployment) {
    refreshes++;
    const generation = entry.generation;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        reject(new AppError("UPSTREAM_RPC", "Dashboard balance refresh timed out"));
      }, refreshTimeoutMs);
      deadline.unref?.();
    });
    // A timeout doesn't cancel HTTP work. The RPC transport has its own finite
    // timeout; this race discards late results and never republishes them.
    const pending = Promise.race([
      Promise.resolve().then(() => load(deployment, controller.signal)),
      timeout,
    ])
      .catch((error: unknown) => {
        if (!entry.previous) throw error;
        const message = error instanceof Error ? error.message : "Balance refresh failed";
        const previous = entry.previous;
        const result: ReadWorkflowBalances = {
          totals: [],
          nodes: previous.nodes.map((node) => {
            if (!("balanceStroops" in node)) return { ...node, error: message };
            const { balanceStroops: _balance, ...rest } = node;
            return { ...rest, error: message };
          }),
          freshness: {
            status: "stale",
            totalsComplete: false,
            attemptedAt: new Date().toISOString(),
            cached: false,
            targets: previous.freshness.targets.map((target) => ({
              ...target,
              balanceStroops: null,
              readAt: null,
              stale: true,
              error: message,
            })),
          },
        };
        return result;
      })
      .then((result) => {
        const merged = retain(result, entry.previous);
        if (entry.generation !== generation || entries.get(key) !== entry) {
          return staleResult(merged);
        }
        entry.previous = merged;
        entry.result = merged;
        entry.expiresAt = Date.now() + ttlMs;
        return merged;
      })
      .finally(() => {
        clearTimeout(deadline);
        if (entry.pending === pending) entry.pending = undefined;
        if (entries.get(key) === entry) {
          entry.eviction = setTimeout(() => drop(key, entry), retentionMs);
          entry.eviction.unref?.();
        }
      });
    entry.pending = pending;
    entry.pendingGeneration = generation;
    return pending;
  }

  async function read(deployment: DashboardDeployment, environment: ReadEnvironment) {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          environment,
          deployment.id,
          deployment.ownerId,
          deployment.status,
          deployment.graphSnapshot,
          deployment.pipelineSnapshot,
          deployment.contractAddress,
          deployment.sourceAccount,
          deployment.flow.templateKind,
        ]),
      )
      .digest("hex");
    let entry = entries.get(key);
    if (!entry) {
      if (entries.size >= maxEntries) {
        const candidate = [...entries].find(([, value]) => !value.pending);
        if (candidate) drop(...candidate);
        else
          throw new AppError(
            "RATE_LIMITED",
            "Dashboard balance refresh capacity reached",
            undefined,
            undefined,
            1,
          );
      }
      entry = {
        network: environment.network,
        deploymentId: deployment.id,
        generation: 0,
        expiresAt: 0,
      };
      entries.set(key, entry);
    }
    // All concurrent viewers join the old generation, then share at most one
    // follow-up after invalidation. Repeated invalidations cannot loop forever.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (entry.result && entry.expiresAt > Date.now()) {
        hits++;
        return structuredClone({
          ...entry.result,
          freshness: { ...entry.result.freshness, cached: true },
        });
      }
      if (entry.eviction) clearTimeout(entry.eviction);
      if (entry.pending) joins++;
      const generation = entry.pending ? entry.pendingGeneration : entry.generation;
      let result: ReadWorkflowBalances;
      try {
        result = await (entry.pending ?? refresh(key, entry, deployment));
      } catch (error) {
        if (entry.generation !== generation && attempt === 0) continue;
        throw error;
      }
      if (entry.generation === generation) return structuredClone(result);
      if (attempt === 1) return structuredClone(staleResult(result));
    }
    throw new AppError("INTERNAL", "Balance refresh did not complete");
  }

  function invalidate(network: string, deploymentId: string, transaction?: string) {
    for (const entry of entries.values()) {
      if (entry.network !== network || entry.deploymentId !== deploymentId) continue;
      if (transaction) {
        const now = Date.now();
        entry.invalidations ??= new Map();
        for (const [key, at] of entry.invalidations)
          if (now - at >= RETENTION_MS) entry.invalidations.delete(key);
        if (entry.invalidations.has(transaction)) continue;
        if (entry.invalidations.size >= 256)
          entry.invalidations.delete(entry.invalidations.keys().next().value!);
        entry.invalidations.set(transaction, now);
      }
      entry.generation++;
      entry.result = undefined;
      entry.expiresAt = 0;
    }
  }

  return { read, invalidate, stats: () => ({ entries: entries.size, hits, joins, refreshes }) };
}

const dashboardBalanceCache = createDashboardBalanceCache();

/** Call only after authentication, ownership checks and rate limiting. */
export function getDashboardBalances(deployment: DashboardDeployment) {
  return dashboardBalanceCache.read(deployment, {
    network: env().STELLAR_NETWORK,
    rpcUrl: stellarRpcUrl(),
    relayerAddress: stellarRelayerAddress(),
  });
}

/** Transaction identity deduplicates events and confirmed actions across viewers. */
export function invalidateDashboardBalances(deploymentId: string, txHash?: string) {
  dashboardBalanceCache.invalidate(env().STELLAR_NETWORK, deploymentId, txHash?.toLowerCase());
}
