import "server-only";
import {
  Address,
  BASE_FEE,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";
import { TemplateKind } from "@prisma/client";
import { env, stellarFactoryAddress, stellarPassphrase, stellarWasmHash } from "@/lib/env";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { log } from "@/lib/log";
import { ttlDeadline, type TtlDeadline } from "@/lib/stellar/ttl-deadline";
import { sorobanRpc } from "@/lib/stellar/client";
import { withRelayerChannel, type RelayerChannel } from "@/lib/stellar/relayer-channels";
import { reserveTransactionFee, ttlFeeBudget } from "@/lib/stellar/fee-budget";

export const TTL_LIMITS = {
  batch: 25,
  targetsPerDeployment: 10,
  sharedBatch: 10,
  maxInventoryReads: 50,
  budgetMs: 20_000,
  ttlMs: 600_000,
  maxSubmissions: 12,
  threshold: 50_000,
  extendTo: 500_000,
} as const;
const HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/i)
  .transform((v) => v.toLowerCase());
const AddressSchema = z.string().refine(StrKey.isValidContract);
const SnapshotSchema = z.array(z.object({ contractAddress: AddressSchema })).max(840);

export function ttlInstanceKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(AddressSchema.parse(address)).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

export function ttlCodeKey(hash: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.from(HashSchema.parse(hash), "hex") }),
  );
}

/** Durable snapshots are authoritative. Invalid snapshots fail visibly, never partially disappear. */
export function ttlSnapshotAddresses(snapshot: unknown, legacyAddress: string | null): string[] {
  if (snapshot === null) return legacyAddress ? [AddressSchema.parse(legacyAddress)] : [];
  return [...new Set(SnapshotSchema.parse(snapshot).map((node) => node.contractAddress))];
}

export type TtlDetail = {
  target: string;
  kind: "instance" | "code";
  status:
    | "healthy"
    | "due"
    | "extended"
    | "restored"
    | "missing"
    | "failed"
    | "deferred"
    | "pending";
  liveUntilLedger?: number;
  feeStroops?: string;
  txHash?: string;
  reason?: string;
  postReadUnavailable?: boolean;
};
export type TtlSummary = {
  dryRun: boolean;
  deployments: number;
  submissions: number;
  truncated: boolean;
  budgetExhausted: boolean;
  moreDeployments: boolean;
  partialPipelines: boolean;
  inventoryReadLimitReached?: boolean;
  sharedScan?: { totalTargets: number; nextOffset: number };
  details: TtlDetail[];
  failedDeployments: string[];
  scans: Array<{ deploymentId: string; totalTargets: number; nextOffset: number }>;
};

/** An attempted send has an unknown outcome. Retain its public identity and source barrier. */
export class TtlPendingError extends AppError {
  constructor(
    readonly txHash: string,
    readonly feeStroops: string,
  ) {
    super("UPSTREAM_RPC", "TTL maintenance finality unknown; no submission retry");
  }
}

/** No-auth rent operation: channel signs only the envelope, never contract authorization. */
export async function submitTtlOperation(
  server: rpc.Server,
  channel: RelayerChannel,
  key: xdr.LedgerKey,
  extendTo: number | null,
  maxFeeStroops: string,
  deadline: TtlDeadline = ttlDeadline(30_000),
): Promise<{ txHash: string; feeStroops: string }> {
  const account = await deadline.run(() => server.getAccount(channel.publicKey));
  const data = new SorobanDataBuilder();
  if (extendTo === null) data.setReadWrite([key]);
  else data.setReadOnly([key]);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: stellarPassphrase(),
  })
    .addOperation(
      extendTo === null
        ? Operation.restoreFootprint({})
        : Operation.extendFootprintTtl({ extendTo }),
    )
    .setSorobanData(data.build())
    .setTimeout(180)
    .build();
  const sim = await deadline.run(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim) || rpc.Api.isSimulationRestore(sim)) {
    throw new AppError("UPSTREAM_RPC", "TTL maintenance simulation requires recovery or failed");
  }
  const assembled = rpc.assembleTransaction(tx, sim).build();
  if (BigInt(assembled.fee) > BigInt(maxFeeStroops))
    throw new AppError("VALIDATION", "TTL maintenance fee exceeds configured cap");
  const hash = assembled.hash().toString("hex");
  const budget = ttlFeeBudget(maxFeeStroops);
  if (budget) {
    await reserveTransactionFee({
      network: env().STELLAR_NETWORK,
      budget,
      txHash: hash,
      payer: channel.publicKey,
      declaredFeeStroops: assembled.fee,
      purpose: extendTo === null ? "ttl-restoration" : "ttl-extension",
    });
  }
  deadline.assert();
  assembled.sign(channel.keypair);
  // Record BEFORE attempting the send: a network failure can hide an accepted transaction.
  channel.trackPending(hash, assembled.timeBounds?.maxTime);
  try {
    const sent = await deadline.run(() => server.sendTransaction(assembled));
    if (sent.status === "ERROR") {
      channel.clearPending?.(hash);
      throw new AppError("UPSTREAM_RPC", "TTL maintenance transaction rejected");
    }
    while (!deadline.expired()) {
      const got = await deadline.run(() => server.getTransaction(hash));
      if (got.status === "SUCCESS") {
        channel.clearPending?.(hash);
        return { txHash: hash, feeStroops: assembled.fee };
      }
      if (got.status === "FAILED") {
        channel.clearPending?.(hash);
        throw new AppError("UPSTREAM_RPC", "TTL maintenance transaction failed");
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, deadline.remaining())));
    }
  } catch (error) {
    if (
      error instanceof AppError &&
      ["TTL maintenance transaction rejected", "TTL maintenance transaction failed"].includes(
        error.message,
      )
    )
      throw error;
    throw new TtlPendingError(hash, assembled.fee);
  }
  throw new TtlPendingError(hash, assembled.fee);
}

/** Threshold inclusive, just like instance.extend_ttl. Missing is unknown, not proof of archival. */
export function ttlStatus(
  liveUntil: number | undefined,
  latest: number,
  threshold: number,
): "missing" | "due" | "healthy" {
  return liveUntil === undefined ? "missing" : liveUntil - latest <= threshold ? "due" : "healthy";
}

/**
 * Conservatively retain all confirmed non-sandbox pipelines, including old funded holds and
 * cancelled schedules. There is no reliable retirement signal. No graph-derived addresses.
 * Dry runs update ONLY scan rotation; they never sign or submit transactions.
 */
export async function runTtlMaintenance(): Promise<TtlSummary> {
  const config = env();
  const dryRun = !config.STELLAR_TTL_MAINTENANCE_ENABLED;
  if (!dryRun) ttlFeeBudget(config.STELLAR_TTL_MAX_FEE_STROOPS);
  const result: TtlSummary = {
    dryRun,
    deployments: 0,
    submissions: 0,
    truncated: false,
    budgetExhausted: false,
    moreDeployments: false,
    partialPipelines: false,
    details: [],
    failedDeployments: [],
    scans: [],
  };
  const deadline = ttlDeadline(TTL_LIMITS.budgetMs);
  const server = sorobanRpc();
  const settingKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
    }),
  );
  const setting = (await deadline.run(() => server.getLedgerEntries(settingKey))).entries[0];
  if (!setting) throw new AppError("UPSTREAM_RPC", "Network archival limits unavailable");
  const extendTo = Math.min(
    TTL_LIMITS.extendTo,
    setting.val.configSetting().stateArchivalSettings().maxEntryTtl() - 1,
  );
  if (extendTo <= 1) throw new AppError("UPSTREAM_RPC", "Invalid network archival limits");
  const threshold = Math.min(TTL_LIMITS.threshold, extendTo - 1);
  const latest = (await deadline.run(() => server.getLatestLedger())).sequence;
  let inventoryReads = 0;
  const seen = new Set<string>();
  const attempted = new Set<string>();

  const inspect = async (
    targets: Array<{ target: string; kind: "instance" | "code" }>,
  ): Promise<string[]> => {
    const hashes = new Set<string>();
    const unique = targets.filter(({ target, kind }) => {
      const id = `${kind}:${target}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    for (let start = 0; start < unique.length; start += 100) {
      const batch = unique.slice(start, start + 100);
      if (deadline.expired() || inventoryReads >= TTL_LIMITS.maxInventoryReads) {
        result.details.push(...batch.map((item) => ({ ...item, status: "deferred" as const })));
        result.truncated = true;
        result.budgetExhausted ||= deadline.expired();
        result.inventoryReadLimitReached ||= inventoryReads >= TTL_LIMITS.maxInventoryReads;
        continue;
      }
      let keys: xdr.LedgerKey[];
      let response: Awaited<ReturnType<rpc.Server["getLedgerEntries"]>>;
      try {
        keys = batch.map(({ target, kind }) =>
          kind === "instance" ? ttlInstanceKey(target) : ttlCodeKey(target),
        );
        inventoryReads++;
        response = await deadline.run(() => server.getLedgerEntries(...keys));
        for (const item of batch) attempted.add(`${item.kind}:${item.target}`);
      } catch {
        // Split failed batches to isolate bad keys without spending one RPC per healthy key.
        // Retries are inventory reads only, bounded by the same deadline; never repeat a send.
        if (batch.length > 1 && !deadline.expired()) {
          for (const item of batch) seen.delete(`${item.kind}:${item.target}`);
          const middle = Math.ceil(batch.length / 2);
          for (const half of [batch.slice(0, middle), batch.slice(middle)])
            for (const hash of await inspect(half)) hashes.add(hash);
        } else {
          for (const item of batch) attempted.add(`${item.kind}:${item.target}`);
          result.details.push(
            ...batch.map((item) => ({
              ...item,
              status: deadline.expired() ? ("deferred" as const) : ("failed" as const),
              reason: "Target inventory unavailable",
            })),
          );
        }
        continue;
      }
      const entries = new Map(response.entries.map((entry) => [entry.key.toXDR("base64"), entry]));
      for (const [i, item] of batch.entries()) {
        const key = keys[i]!;
        let entry = entries.get(key.toXDR("base64"));
        const detail: TtlDetail = {
          ...item,
          status: ttlStatus(
            entry?.liveUntilLedgerSeq,
            Math.max(latest, response.latestLedger),
            threshold,
          ),
          liveUntilLedger: entry?.liveUntilLedgerSeq,
        };
        result.details.push(detail);
        if (detail.status === "due" && entry) {
          if (!dryRun) {
            if (deadline.expired() || result.submissions >= TTL_LIMITS.maxSubmissions) {
              detail.status = "deferred";
              result.truncated = true;
              result.budgetExhausted ||= deadline.expired();
            } else {
              result.submissions++;
              let archived =
                entry.liveUntilLedgerSeq !== undefined &&
                entry.liveUntilLedgerSeq < Math.max(latest, response.latestLedger);
              try {
                const sent = await deadline.acquire((started) =>
                  withRelayerChannel(async (channel) => {
                    started();
                    // A previous pending rent may have confirmed while this caller queued.
                    // Recheck under the lock before paying from a stale inventory observation.
                    const fresh = await deadline.run(() => server.getLedgerEntries(key));
                    const observed = fresh.entries[0];
                    if (!observed)
                      throw new AppError(
                        "UPSTREAM_RPC",
                        "TTL maintenance target unavailable after channel acquisition",
                      );
                    entry = observed;
                    detail.liveUntilLedger = observed.liveUntilLedgerSeq;
                    const status = ttlStatus(
                      observed.liveUntilLedgerSeq,
                      Math.max(latest, fresh.latestLedger),
                      threshold,
                    );
                    if (status === "healthy") return null;
                    if (status === "missing")
                      throw new AppError(
                        "UPSTREAM_RPC",
                        "TTL maintenance target lifetime unavailable after channel acquisition",
                      );
                    archived =
                      observed.liveUntilLedgerSeq !== undefined &&
                      observed.liveUntilLedgerSeq < Math.max(latest, fresh.latestLedger);
                    return submitTtlOperation(
                      server,
                      channel,
                      key,
                      archived ? null : extendTo,
                      config.STELLAR_TTL_MAX_FEE_STROOPS,
                      deadline,
                    );
                  }),
                );
                if (!sent) {
                  detail.status = "healthy";
                  if (item.kind === "instance" && entry) {
                    const executable = entry.val.contractData().val().instance().executable();
                    if (executable.switch().name === "contractExecutableWasm")
                      hashes.add(executable.wasmHash().toString("hex"));
                  }
                  continue;
                }
                Object.assign(detail, sent, {
                  status: archived ? "restored" : "extended",
                });
                await audit({
                  action: archived ? "CONTRACT_STORAGE_RESTORED" : "CONTRACT_STORAGE_EXTENDED",
                  metadata: {
                    network: config.STELLAR_NETWORK,
                    target: item.target,
                    kind: item.kind,
                    txHash: sent.txHash,
                    feeStroops: sent.feeStroops,
                  },
                });
                try {
                  const observed = (await deadline.run(() => server.getLedgerEntries(key)))
                    .entries[0];
                  if (observed) {
                    entry = observed;
                    detail.liveUntilLedger = observed.liveUntilLedgerSeq;
                  } else {
                    detail.postReadUnavailable = true;
                    detail.reason = "Confirmed rent; post-read unavailable";
                    detail.liveUntilLedger = undefined;
                  }
                } catch {
                  detail.postReadUnavailable = true;
                  detail.reason = "Confirmed rent; post-read unavailable";
                  detail.liveUntilLedger = undefined;
                }
              } catch (error) {
                detail.status = error instanceof TtlPendingError ? "pending" : "failed";
                if (error instanceof TtlPendingError) {
                  detail.txHash = error.txHash;
                  detail.feeStroops = error.feeStroops;
                  await audit({
                    action: "CONTRACT_STORAGE_RENT_PENDING",
                    metadata: {
                      network: config.STELLAR_NETWORK,
                      target: item.target,
                      kind: item.kind,
                      txHash: error.txHash,
                      feeStroops: error.feeStroops,
                      operation: archived ? "restore" : "extend",
                    },
                  });
                }
                // Only our fixed messages are safe to return; upstream strings can contain credentials.
                detail.reason =
                  error instanceof AppError && error.message.startsWith("TTL maintenance")
                    ? error.message
                    : "RPC or channel unavailable";
                log.warn(
                  { target: item.target, kind: item.kind },
                  "TTL maintenance failed; inspect report before retrying",
                );
              }
            }
          }
        }
        if (item.kind === "instance" && entry) {
          const executable = entry.val.contractData().val().instance().executable();
          if (executable.switch().name === "contractExecutableWasm")
            hashes.add(executable.wasmHash().toString("hex"));
        }
      }
    }
    return [...hashes];
  };

  // Fresh DB configuration, with env fallback; avoid process-lifetime config caches.
  const [templates, factory, deployments, cursor] = await Promise.all([
    db.contractTemplate.findMany({
      where: { network: config.STELLAR_NETWORK },
      select: { kind: true, wasmHash: true },
    }),
    db.factoryDeployment.findUnique({
      where: { network: config.STELLAR_NETWORK },
      select: { address: true, wasmHash: true },
    }),
    db.deployment.findMany({
      where: {
        network: config.STELLAR_NETWORK,
        status: "CONFIRMED",
        owner: { role: { not: "SANDBOX" } },
      },
      orderBy: [{ ttlCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: TTL_LIMITS.batch + 1,
      select: { id: true, pipelineSnapshot: true, contractAddress: true, ttlScanOffset: true },
    }),
    db.ttlMaintenanceState.upsert({
      where: { network: config.STELLAR_NETWORK },
      create: { network: config.STELLAR_NETWORK },
      update: {},
    }),
  ]);
  const current = new Map(templates.map((row) => [row.kind, row.wasmHash]));
  for (const kind of Object.values(TemplateKind)) {
    if (!current.has(kind)) {
      const hash = stellarWasmHash(kind);
      if (hash) current.set(kind, hash);
    }
  }
  const factoryAddress = factory?.address ?? stellarFactoryAddress();
  const shared = [...current.values(), ...(factory?.wasmHash ? [factory.wasmHash] : [])].map(
    (target) => ({ target: target.toLowerCase(), kind: "code" as const }),
  );
  const sharedRaw: Array<{ target: string; kind: "instance" | "code" }> = [
    ...(factoryAddress ? [{ target: factoryAddress, kind: "instance" as const }] : []),
    ...shared,
  ];
  const sharedTargets = [
    ...new Map(sharedRaw.map((item) => [`${item.kind}:${item.target}`, item])).values(),
  ].sort((a, b) => `${a.kind}:${a.target}`.localeCompare(`${b.kind}:${b.target}`));
  result.moreDeployments = deployments.length > TTL_LIMITS.batch;
  result.truncated ||= result.moreDeployments;
  const inspectShared = async () => {
    if (sharedTargets.length && !deadline.expired()) {
      const offset = Math.max(0, cursor.sharedOffset) % sharedTargets.length;
      const chunk = sharedTargets.slice(offset, offset + TTL_LIMITS.sharedBatch);
      try {
        const hashes = await inspect(chunk);
        await inspect(hashes.map((target) => ({ target, kind: "code" })));
      } catch {
        result.details.push({
          ...sharedTargets[offset]!,
          status: "failed",
          reason: "Shared target inventory unavailable",
        });
      } finally {
        // Fallback reads can stop inside a chunk. Keep the first unattempted target
        // eligible next tick, while rotating past attempted failures as well as successes.
        const firstDeferred = chunk.findIndex(
          ({ kind, target }) => !attempted.has(`${kind}:${target}`),
        );
        const count = firstDeferred === -1 ? chunk.length : firstDeferred;
        result.sharedScan = {
          totalTargets: sharedTargets.length,
          nextOffset: (offset + count) % sharedTargets.length,
        };
        result.truncated ||= count < chunk.length || result.sharedScan.nextOffset !== 0;
        await db.ttlMaintenanceState.update({
          where: { network: config.STELLAR_NETWORK },
          data: { sharedOffset: result.sharedScan!.nextOffset },
        });
      }
    }
  };
  const inspectDeployments = async () => {
    if (deadline.expired()) {
      result.truncated = result.budgetExhausted = true;
      return;
    }
    const work: Array<{
      deployment: (typeof deployments)[number];
      addresses: string[];
      offset: number;
      chunk: string[];
    }> = [];
    const invalid: Array<(typeof deployments)[number]> = [];
    for (const deployment of deployments.slice(0, TTL_LIMITS.batch)) {
      try {
        const addresses = ttlSnapshotAddresses(
          deployment.pipelineSnapshot,
          deployment.contractAddress,
        );
        if (!addresses.length) throw new Error("No durable pipeline addresses");
        const offset = Math.max(0, deployment.ttlScanOffset) % addresses.length;
        work.push({
          deployment,
          addresses,
          offset,
          chunk: addresses.slice(offset, offset + TTL_LIMITS.targetsPerDeployment),
        });
      } catch {
        invalid.push(deployment);
        result.failedDeployments.push(deployment.id);
        log.warn({ deploymentId: deployment.id }, "TTL inventory failed");
      }
    }
    // Pool instance reads across flows; getLedgerEntries batches never exceed 100 keys.
    const hashes = await inspect(
      work.flatMap(({ chunk }) => chunk.map((target) => ({ target, kind: "instance" as const }))),
    );
    await inspect(hashes.map((target) => ({ target, kind: "code" })));
    const failures = new Set(
      result.details
        .filter((d) => d.status === "failed" && d.reason === "Target inventory unavailable")
        .map((d) => d.target),
    );
    const updates: Array<{ id: string; nextOffset: number }> = invalid.map((deployment) => ({
      id: deployment.id,
      nextOffset: deployment.ttlScanOffset,
    }));
    for (const { deployment, addresses, offset, chunk } of work) {
      const firstDeferred = chunk.findIndex((target) => !attempted.has(`instance:${target}`));
      const count = firstDeferred === -1 ? chunk.length : firstDeferred;
      if (!count) continue; // A deadline-deferred read is not an inventory attempt.
      const nextOffset = offset + count >= addresses.length ? 0 : offset + count;
      result.scans.push({
        deploymentId: deployment.id,
        totalTargets: addresses.length,
        nextOffset,
      });
      if (nextOffset !== 0) result.truncated = result.partialPipelines = true;
      if (chunk.some((target) => failures.has(target)))
        result.failedDeployments.push(deployment.id);
      updates.push({ id: deployment.id, nextOffset });
    }
    await Promise.all(
      updates.map(({ id, nextOffset }) =>
        db.deployment.update({
          where: { id },
          data: { ttlCheckedAt: new Date(), ttlScanOffset: nextOffset },
        }),
      ),
    );
    result.deployments += updates.length;
  };
  if (cursor.sharedFirst) {
    await inspectShared();
    await inspectDeployments();
  } else {
    await inspectDeployments();
    await inspectShared();
  }
  await db.ttlMaintenanceState.update({
    where: { network: config.STELLAR_NETWORK },
    data: { sharedFirst: !cursor.sharedFirst },
  });
  result.budgetExhausted ||= deadline.expired();
  result.truncated ||= result.budgetExhausted;
  return result;
}
