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
import { cronDeadline } from "@/lib/cron/deadline";
import { sorobanRpc } from "@/lib/stellar/client";
import { withRelayerChannel, type RelayerChannel } from "@/lib/stellar/relayer-channels";
import { reserveTransactionFee, ttlFeeBudget } from "@/lib/stellar/fee-budget";

export const TTL_LIMITS = {
  batch: 5,
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
  status: "healthy" | "due" | "extended" | "restored" | "missing" | "failed" | "deferred";
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
  sharedScan?: { totalTargets: number; nextOffset: number };
  details: TtlDetail[];
  failedDeployments: string[];
  scans: Array<{ deploymentId: string; totalTargets: number; nextOffset: number }>;
};

/** No-auth rent operation: channel signs only the envelope, never contract authorization. */
export async function submitTtlOperation(
  server: rpc.Server,
  channel: RelayerChannel,
  key: xdr.LedgerKey,
  extendTo: number | null,
  maxFeeStroops: string,
): Promise<{ txHash: string; feeStroops: string }> {
  const account = await server.getAccount(channel.publicKey);
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
  const sim = await server.simulateTransaction(tx);
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
  assembled.sign(channel.keypair);
  // Record BEFORE attempting the send: a network failure can hide an accepted transaction.
  channel.trackPending(hash, assembled.timeBounds?.maxTime);
  const sent = await server.sendTransaction(assembled);
  if (sent.status === "ERROR") {
    channel.clearPending?.(hash);
    throw new AppError("UPSTREAM_RPC", "TTL maintenance transaction rejected");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS") {
      channel.clearPending?.(hash);
      return { txHash: hash, feeStroops: assembled.fee };
    }
    if (got.status === "FAILED") {
      channel.clearPending?.(hash);
      throw new AppError("UPSTREAM_RPC", "TTL maintenance transaction failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new AppError("UPSTREAM_RPC", "TTL maintenance finality unknown; no submission retry");
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
  const deadline = cronDeadline(TTL_LIMITS.budgetMs);
  const server = sorobanRpc();
  const settingKey = xdr.LedgerKey.configSetting(
    new xdr.LedgerKeyConfigSetting({
      configSettingId: xdr.ConfigSettingId.configSettingStateArchival(),
    }),
  );
  const setting = (await server.getLedgerEntries(settingKey)).entries[0];
  if (!setting) throw new AppError("UPSTREAM_RPC", "Network archival limits unavailable");
  const extendTo = Math.min(
    TTL_LIMITS.extendTo,
    setting.val.configSetting().stateArchivalSettings().maxEntryTtl() - 1,
  );
  if (extendTo <= 1) throw new AppError("UPSTREAM_RPC", "Invalid network archival limits");
  const threshold = Math.min(TTL_LIMITS.threshold, extendTo - 1);
  const latest = (await server.getLatestLedger()).sequence;
  const seen = new Set<string>();

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
      // Finish this deployment's inventory before rotating it; mutations may be deferred.
      const batch = unique.slice(start, start + 100);
      const keys = batch.map(({ target, kind }) =>
        kind === "instance" ? ttlInstanceKey(target) : ttlCodeKey(target),
      );
      const response = await server.getLedgerEntries(...keys);
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
              const archived =
                entry.liveUntilLedgerSeq !== undefined &&
                entry.liveUntilLedgerSeq < Math.max(latest, response.latestLedger);
              try {
                const sent = await withRelayerChannel((channel) =>
                  submitTtlOperation(
                    server,
                    channel,
                    key,
                    archived ? null : extendTo,
                    config.STELLAR_TTL_MAX_FEE_STROOPS,
                  ),
                );
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
                  const observed = (await server.getLedgerEntries(key)).entries[0];
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
                detail.status = "failed";
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
      result.sharedScan = {
        totalTargets: sharedTargets.length,
        nextOffset: (offset + 1) % sharedTargets.length,
      };
      result.truncated ||= result.sharedScan.nextOffset !== 0;
      try {
        const hashes = await inspect([sharedTargets[offset]!]);
        await inspect(hashes.map((target) => ({ target, kind: "code" })));
      } catch {
        result.details.push({
          ...sharedTargets[offset]!,
          status: "failed",
          reason: "Shared target inventory unavailable",
        });
      } finally {
        await db.ttlMaintenanceState.update({
          where: { network: config.STELLAR_NETWORK },
          data: { sharedOffset: (offset + 1) % sharedTargets.length },
        });
      }
    }
  };
  const inspectDeployments = async () => {
    for (const deployment of deployments.slice(0, TTL_LIMITS.batch)) {
      if (deadline.expired()) {
        result.truncated = true;
        result.budgetExhausted = true;
        break;
      }
      let nextOffset = deployment.ttlScanOffset;
      try {
        const addresses = ttlSnapshotAddresses(
          deployment.pipelineSnapshot,
          deployment.contractAddress,
        );
        if (!addresses.length) throw new Error("No durable pipeline addresses");
        const offset = Math.max(0, deployment.ttlScanOffset) % addresses.length;
        const chunk = addresses.slice(offset, offset + 1);
        nextOffset = offset + chunk.length >= addresses.length ? 0 : offset + chunk.length;
        result.scans.push({
          deploymentId: deployment.id,
          totalTargets: addresses.length,
          nextOffset,
        });
        if (nextOffset !== 0) {
          result.truncated = true;
          result.partialPipelines = true;
        }
        const hashes = await inspect(chunk.map((target) => ({ target, kind: "instance" })));
        await inspect(hashes.map((target) => ({ target, kind: "code" })));
      } catch {
        result.failedDeployments.push(deployment.id);
        log.warn({ deploymentId: deployment.id }, "TTL inventory failed");
      } finally {
        await db.deployment.update({
          where: { id: deployment.id },
          data: { ttlCheckedAt: new Date(), ttlScanOffset: nextOffset },
        });
        result.deployments++;
      }
    }
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
