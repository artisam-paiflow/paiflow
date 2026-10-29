import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Deployment } from "@prisma/client";
import { Address, StrKey, scValToNative, xdr } from "@stellar/stellar-sdk";
import { redis } from "@/lib/redis";
import { AppError } from "@/lib/errors";
import { env, stellarRpcUrl } from "@/lib/env";
import { isFeatureEnabled } from "@/lib/features";
import {
  BalancePipelineSchema,
  balanceCandidates,
  NON_HOLDING_KINDS,
} from "@/lib/api/v1/balance-targets";
import type { DeploymentBalances } from "@/lib/api/v1/schema";
import { sorobanRpc } from "./client";
import { createTokenBalanceReader } from "./balance";
import { dashboardBalanceAdmission } from "./dashboard-balance-admission";
type BalanceDeployment = Pick<
  Deployment,
  "id" | "status" | "network" | "pipelineSnapshot" | "sourceAccount"
>;
type Node = DeploymentBalances["nodes"][number];
const DEADLINE_MS = 25000;
/** Read only the asset fields; never serialize instance storage or private configuration. */
async function tokenContracts(address: string, swap: boolean): Promise<string[]> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(address).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const response = await sorobanRpc().getLedgerEntries(key);
  if (
    !Number.isInteger(response.latestLedger) ||
    response.entries.length !== 1 ||
    !response.entries[0]!.key.toXDR().equals(key.toXDR())
  )
    throw new Error("Unavailable instance");
  const storage = response.entries[0]!.val.contractData().val().instance().storage() ?? [];
  const tokens: string[] = [];
  for (const name of swap ? ["AssetIn", "AssetOut"] : ["Asset"]) {
    const matches = storage.filter((entry) => {
      const native: unknown = scValToNative(entry.key());
      return Array.isArray(native) && native.length === 1 && native[0] === name;
    });
    if (matches.length !== 1) throw new Error("Unavailable asset");
    const token: unknown = scValToNative(matches[0]!.val());
    if (typeof token !== "string" || !StrKey.isValidContract(token))
      throw new Error("Invalid asset");
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}
export async function readPartnerBalances(
  deployment: BalanceDeployment,
  signal?: AbortSignal,
): Promise<DeploymentBalances> {
  const pipeline = BalancePipelineSchema.parse(deployment.pipelineSnapshot);
  const candidates = balanceCandidates(pipeline);
  const supported = new Set(candidates.map((n) => n.nodeId));
  const attemptedAt = new Date().toISOString();
  const nodes: Node[] = pipeline
    .filter((n) => !supported.has(n.nodeId) && !NON_HOLDING_KINDS.has(n.templateKind))
    .map((n) => ({
      ...n,
      tokenContract: null,
      balanceStroops: null,
      readAt: null,
      stale: true,
      error: "Balance reads are unsupported for this contract kind",
    }));
  const balance = createTokenBalanceReader(deployment.sourceAccount);
  let cursor = 0;
  // Four workers, at most 64 contracts / 128 token balances. HTTP calls have the
  // existing finite RPC timeout; stop scheduling work at the overall deadline.
  const deadline = Date.now() + DEADLINE_MS;
  async function worker() {
    while (cursor < candidates.length) {
      const node = candidates[cursor++]!;
      const base = {
        ...node,
        tokenContract: null,
        balanceStroops: null,
        readAt: null,
        stale: true,
      };
      if (signal?.aborted || Date.now() >= deadline) {
        nodes.push({ ...base, error: "Balance read deadline exceeded" });
        continue;
      }
      let tokens: string[];
      try {
        tokens = await tokenContracts(node.contractAddress, node.templateKind === "SWAPPER");
      } catch {
        nodes.push({ ...base, error: "Current contract asset could not be read" });
        continue;
      }
      for (const tokenContract of tokens) {
        try {
          if (signal?.aborted || Date.now() >= deadline) throw new Error("Deadline");
          const amount = await balance({
            tokenAddress: tokenContract,
            holderAddress: node.contractAddress,
          });
          if (signal?.aborted || Date.now() >= deadline) throw new Error("Deadline");
          if (amount < 0n || amount > (1n << 127n) - 1n) throw new Error("Invalid balance");
          nodes.push({
            ...node,
            tokenContract,
            balanceStroops: amount.toString(),
            readAt: new Date().toISOString(),
            stale: false,
          });
        } catch {
          nodes.push({ ...base, tokenContract, error: "Token balance could not be read" });
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  nodes.sort(
    (a, b) =>
      a.nodeId.localeCompare(b.nodeId) ||
      (a.tokenContract ?? "").localeCompare(b.tokenContract ?? ""),
  );
  const totals = new Map<string, bigint>();
  for (const node of nodes)
    if (!node.stale && node.tokenContract && node.balanceStroops !== null)
      totals.set(
        node.tokenContract,
        (totals.get(node.tokenContract) ?? 0n) + BigInt(node.balanceStroops),
      );
  const success = nodes.filter((n) => !n.stale).length;
  const totalsComplete = nodes.length > 0 && success === nodes.length;
  return {
    deploymentId: deployment.id,
    network: env().STELLAR_NETWORK,
    totals: Array.from(totals, ([tokenContract, amount]) => ({
      tokenContract,
      balanceStroops: amount.toString(),
    })),
    nodes,
    freshness: {
      status: totalsComplete ? "fresh" : success ? "partial" : "stale",
      totalsComplete,
      attemptedAt,
      cached: false,
    },
  };
}
/** Separate display cache: no effect on owner dashboard or transaction-sensitive reads. */
export function createPartnerBalanceCache(
  load = readPartnerBalances,
  ttlMs = 10000,
  maxEntries = 256,
) {
  const entries = new Map<
    string,
    {
      expiresAt: number;
      result?: DeploymentBalances;
      pending?: Promise<DeploymentBalances>;
    }
  >();
  return async (deployment: BalanceDeployment): Promise<DeploymentBalances> => {
    const key = createHash("sha256")
      .update(JSON.stringify([env().STELLAR_NETWORK, stellarRpcUrl(), false, deployment]))
      .digest("hex");
    let entry = entries.get(key);
    if (entry?.result && entry.expiresAt > Date.now())
      return structuredClone({
        ...entry.result,
        freshness: { ...entry.result.freshness, cached: true },
      });
    if (entry?.pending) return structuredClone(await entry.pending);
    if (!entry) {
      // Never evict active work: otherwise another caller could start a duplicate refresh.
      if (entries.size >= maxEntries) {
        const idle = Array.from(entries).find(([, value]) => !value.pending);
        if (!idle)
          throw new AppError(
            "RATE_LIMITED",
            "Balance refresh is busy; retry shortly",
            undefined,
            undefined,
            5,
          );
        entries.delete(idle[0]);
      }
      entry = { expiresAt: 0 };
      entries.set(key, entry);
    }
    const current = entry;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
    timer.unref?.();
    // Admission slots remain held until HTTP work settles, including after abort.
    current.pending = dashboardBalanceAdmission
      .run(async () => {
        const client = redis();
        const claimKey = `v1:balance-refresh:${env().STELLAR_NETWORK}:${deployment.id}`;
        const claimToken = randomUUID();
        if (client) {
          let claimed: string | null;
          try {
            claimed = await client.set(claimKey, claimToken, "PX", 60000, "NX");
          } catch {
            throw new AppError(
              "RATE_LIMITED",
              "Balance refresh coordination is unavailable; retry shortly",
              undefined,
              undefined,
              5,
            );
          }
          if (claimed !== "OK")
            throw new AppError(
              "RATE_LIMITED",
              "Balance refresh is already running or was recently completed; retry shortly",
              undefined,
              undefined,
              10,
            );
        }
        try {
          return await load(deployment, controller.signal);
        } finally {
          // The 60s lease covers the 25s scheduling deadline plus the last
          // two finite 10s calls in a lazy account-load + balance simulation.
          // HTTP work settles before shortening it,
          // and compare-token prevents shortening a successor after lease loss.
          // If Redis fails, the original 60s lease expires; never permit immediate retry storms.
          if (client) {
            try {
              await client.eval(
                "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) else return 0 end",
                1,
                claimKey,
                claimToken,
                String(ttlMs),
              );
            } catch {
              /* Keep lease. */
            }
          }
        }
      }, controller.signal)
      .then((result) => {
        current.result = result;
        current.expiresAt = Date.now() + ttlMs;
        return result;
      })
      .finally(() => {
        clearTimeout(timer);
        current.pending = undefined;
        if (!current.result) entries.delete(key);
      });
    return structuredClone(await current.pending);
  };
}
const readCached = createPartnerBalanceCache();
export async function getPartnerBalances(deployment: BalanceDeployment) {
  if (deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
  if (deployment.network !== env().STELLAR_NETWORK)
    throw new AppError("VALIDATION", "Deployment network does not match this environment");
  if (
    !BalancePipelineSchema.safeParse(deployment.pipelineSnapshot).success ||
    !balanceCandidates(deployment.pipelineSnapshot).length
  )
    throw new AppError("VALIDATION", "No supported balance targets in this deployment");
  return readCached({
    id: deployment.id,
    status: deployment.status,
    network: deployment.network,
    pipelineSnapshot: deployment.pipelineSnapshot,
    sourceAccount: deployment.sourceAccount,
  });
}
