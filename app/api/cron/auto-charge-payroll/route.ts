import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import { createContractReadCache, type ContractReadCache } from "@/lib/contract-read-cache";
import {
  preparePayrollChargeByRelayerTx,
  submitPayrollChargeByRelayerTx,
  readPayrollIsCancelled,
  readPayrollNextChargeAt,
  readPayrollEmployer,
  readPayrollAsset,
  readPayrollRecipients,
  readPayrollRelayer,
  prepareSubscriptionChargeByRelayerTx,
  submitSubscriptionChargeByRelayerTx,
  readSubscriptionIsCancelled,
  readSubscriptionNextChargeAt,
  readSubscriptionAmountPerPeriod,
  readSubscriptionSubscriberNullable,
  readSubscriptionAsset,
  readSubscriptionRelayer,
  readSplitterDevRecipients,
  readSplitterRecipients,
} from "@/lib/stellar/relayer";
import { preparePayrollChargeByRelayerUnsigned } from "@/lib/stellar/invoke";
import { withRelayerLock } from "@/lib/stellar/client";
import { readTokenAllowance } from "@/lib/stellar/relayer";
import { stellarRelayerAddress, stellarPassphrase } from "@/lib/env";
import { ChargeRelayerMode, EmployeePayoutMode, PayrollRunStatus } from "@prisma/client";
import { createOffRampJobsForPayrollRun } from "@/lib/offramp/jobs";

export const dynamic = "force-dynamic";

const MAX_CATCHUP_PER_RUN = Math.min(50, Math.max(1, env().PAYROLL_MAX_CATCHUP_PER_RUN));

type ResultDetail = {
  deploymentId: string;
  contractAddress: string;
  status: "charged" | "skipped" | "failed";
  error?: string;
};

function isExpectedSkipError(message: string): boolean {
  return (
    message.includes("AlreadyCancelled") ||
    message.includes("NotYetDue") ||
    message.includes("Unauthorized") ||
    message.includes("non-existent contract function") ||
    message.includes("MissingValue") ||
    message.includes("insufficient") ||
    message.includes("Insufficient") ||
    message.includes("PayrollEnded") ||
    message.includes("NotConfigured")
  );
}

async function buildSubscriptionRecipientRows(
  splitterContractAddress: string,
  subscriptionContractAddress: string,
  readRecipients: (
    addr: string,
  ) => Promise<Array<{ address: string; bps: number; amount: string }>>,
  readAmountPerPeriod: (addr: string) => Promise<bigint>,
): Promise<Array<{ address: string; amount: string }>> {
  const [raw, totalStroops] = await Promise.all([
    readRecipients(splitterContractAddress),
    readAmountPerPeriod(subscriptionContractAddress),
  ]);
  return raw.map((r) => {
    const fixed = BigInt(r.amount);
    if (fixed > 0n) {
      return { address: r.address, amount: fixed.toString() };
    }
    if (r.bps > 0) {
      return {
        address: r.address,
        amount: ((totalStroops * BigInt(r.bps)) / 10000n).toString(),
      };
    }
    return { address: r.address, amount: "0" };
  });
}

async function chargeSubscriptionPayrollDeployment(
  d: {
    id: string;
    offRampEnabled: boolean;
    chargeEndAt: Date | null;
  },
  subscriptionContractAddress: string,
  splitterContractAddress: string,
  now: Date,
  readRecipients: (
    addr: string,
  ) => Promise<Array<{ address: string; bps: number; amount: string }>>,
  isDev: boolean,
  cashOutContractAddresses: Set<string>,
  readCache: ContractReadCache,
): Promise<number> {
  if (d.chargeEndAt && d.chargeEndAt <= now) {
    await db.deployment.update({
      where: { id: d.id },
      data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
    });
    throw new Error("PayrollEnded");
  }

  // Only cache reads that are immutable for the contract variant in use:
  // - prod SPLITTER recipients and prod SUBSCRIPTION amount/subscriber have no
  //   on-chain setters, so they are safe to memoize.
  // - SPLITTER_DEV exposes update_recipients and SUBSCRIPTION_DEV exposes
  //   set_amount/update_subscriber, so dev-variant reads must stay fresh.
  // - Every subscription contract exposes set_relayer, so the relayer is
  //   always read fresh (a stale value would defeat the relayer-mismatch
  //   safety check right after a rotation).
  const readSplitterRecipientsCached = readCache(
    "splitter:recipients",
    readRecipients,
    (addr) => addr,
  );
  const readAmountPerPeriodCached = readCache(
    "subscription:amountPerPeriod",
    readSubscriptionAmountPerPeriod,
    (addr) => addr,
  );
  const readSubscriberCached = readCache(
    "subscription:subscriber",
    readSubscriptionSubscriberNullable,
    (addr) => addr,
  );
  const readAssetCached = readCache("subscription:asset", readSubscriptionAsset, (addr) => addr);

  const readRecipientsFn = isDev ? readRecipients : readSplitterRecipientsCached;
  const readAmountPerPeriodFn = isDev ? readSubscriptionAmountPerPeriod : readAmountPerPeriodCached;
  const readSubscriberFn = isDev ? readSubscriptionSubscriberNullable : readSubscriberCached;

  const [cancelled, nextChargeAt] = await Promise.all([
    readSubscriptionIsCancelled(subscriptionContractAddress),
    readSubscriptionNextChargeAt(subscriptionContractAddress),
  ]);

  if (cancelled) {
    await db.deployment.update({
      where: { id: d.id },
      data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
    });
    throw new Error("AlreadyCancelled");
  }

  const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
  if (nextChargeDate > now) {
    await db.deployment.update({
      where: { id: d.id },
      data: { nextChargeAt: nextChargeDate },
    });
    throw new Error("NotYetDue");
  }

  const [subscriber, asset, amountPerPeriod, onChainRelayer] = await Promise.all([
    readSubscriberFn(subscriptionContractAddress),
    readAssetCached(subscriptionContractAddress),
    readAmountPerPeriodFn(subscriptionContractAddress),
    // Always fresh: set_relayer is admin-callable on every subscription variant.
    readSubscriptionRelayer(subscriptionContractAddress),
  ]);

  if (!subscriber) {
    throw new Error("NotConfigured");
  }

  const allowance = await readTokenAllowance({
    tokenContractAddress: asset,
    owner: subscriber,
    spender: subscriptionContractAddress,
  });
  if (allowance < amountPerPeriod) {
    throw new Error("Insufficient allowance");
  }

  const expectedRelayer = stellarRelayerAddress();
  if (expectedRelayer && onChainRelayer !== expectedRelayer) {
    throw new Error(`Relayer mismatch: on-chain ${onChainRelayer}, configured ${expectedRelayer}`);
  }

  const existingEmployees = await db.employee.findMany({
    where: { deploymentId: d.id },
    include: { bankDetail: true },
  });
  const employeeByCashOut = new Map(
    existingEmployees
      .filter((e) => e.cashOutContractAddress)
      .map((e) => [e.cashOutContractAddress!, e]),
  );
  const employeeByWallet = new Map(existingEmployees.map((e) => [e.address, e]));

  const hasFiatEmployeeWithBank = existingEmployees.some(
    (e) => e.payoutMode === "FIAT" && e.bankDetail,
  );

  let chargedCount = 0;
  for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
    const currentNext = await readSubscriptionNextChargeAt(subscriptionContractAddress);
    if (new Date(Number(currentNext) * 1000) > now) break;

    const submit = await withRelayerLock(async () => {
      const { xdr } = await prepareSubscriptionChargeByRelayerTx(subscriptionContractAddress);
      return submitSubscriptionChargeByRelayerTx(xdr);
    });

    if (submit.status !== "SUCCESS") {
      throw new Error(submit.errorMessage ?? "Subscription charge submission failed");
    }

    const recipientRows = await buildSubscriptionRecipientRows(
      splitterContractAddress,
      subscriptionContractAddress,
      readRecipientsFn,
      readAmountPerPeriodFn,
    );
    const totalStroops = recipientRows.reduce((sum, r) => sum + BigInt(r.amount), 0n);

    const payrollRun = await db.payrollRun.create({
      data: {
        deploymentId: d.id,
        runAt: now,
        status: PayrollRunStatus.CHARGED,
        totalStroops: totalStroops.toString(),
        chargedAt: now,
      },
    });

    for (const r of recipientRows) {
      const existing = employeeByCashOut.get(r.address) ?? employeeByWallet.get(r.address);
      const walletAddress = existing?.address ?? r.address;
      const isFiatCashOut = cashOutContractAddresses.has(r.address);

      const employee = await db.employee.upsert({
        where: { deploymentId_address: { deploymentId: d.id, address: walletAddress } },
        create: {
          deploymentId: d.id,
          address: walletAddress,
          amountStroops: r.amount,
          payoutMode: isFiatCashOut ? EmployeePayoutMode.FIAT : EmployeePayoutMode.CRYPTO,
        },
        update: {
          amountStroops: r.amount,
          // If this recipient is a known cash-out contract, ensure the
          // employee is marked fiat so off-ramp jobs are created.
          ...(isFiatCashOut ? { payoutMode: EmployeePayoutMode.FIAT } : {}),
        },
      });
      await db.payrollPayout.create({
        data: {
          payrollRunId: payrollRun.id,
          employeeId: employee.id,
          amountStroops: r.amount,
          txHash: submit.txHash,
        },
      });
    }

    if (isDev ? d.offRampEnabled : hasFiatEmployeeWithBank) {
      try {
        const created = await createOffRampJobsForPayrollRun(db, payrollRun.id);
        log.info(
          { deploymentId: d.id, payrollRunId: payrollRun.id, created: created.length },
          isDev
            ? "Created off-ramp jobs for dev payroll run"
            : "Created off-ramp jobs for payroll run",
        );
      } catch (offRampErr) {
        const message = offRampErr instanceof Error ? offRampErr.message : String(offRampErr);
        log.warn(
          { deploymentId: d.id, payrollRunId: payrollRun.id, error: message },
          "Failed to create off-ramp jobs for payroll run",
        );
      }
    }

    chargedCount++;

    const next = await readSubscriptionNextChargeAt(subscriptionContractAddress);
    if (new Date(Number(next) * 1000) > now) break;
  }

  if (chargedCount === 0) {
    throw new Error("NotYetDue");
  }

  const next = await readSubscriptionNextChargeAt(subscriptionContractAddress);
  await db.deployment.update({
    where: { id: d.id },
    data: {
      lastChargedAt: new Date(),
      nextChargeAt: new Date(Number(next) * 1000),
    },
  });

  return chargedCount;
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    if (!stellarRelayerAddress()) {
      return NextResponse.json({
        data: {
          platformCharged: 0,
          userCharged: 0,
          skipped: 0,
          failed: 0,
          details: [],
          notice: "STELLAR_RELAYER_ADDRESS is not configured; auto-charge payroll cron skipped",
        },
      });
    }

    const now = new Date();
    const deployments = await db.deployment.findMany({
      where: {
        status: "CONFIRMED",
        flow: { templateKind: "PAYROLL" },
        OR: [{ nextChargeAt: { lte: now } }, { nextChargeAt: null }],
      },
      select: {
        id: true,
        offRampEnabled: true,
        chargeEndAt: true,
        chargeRelayerMode: true,
        chargeRelayerUrl: true,
        chargeRelayerAddress: true,
        chargeRelayerToken: true,
        nextChargeAt: true,
        pipelineSnapshot: true,
      },
    });

    const results: ResultDetail[] = [];
    let platformCharged = 0;
    let userCharged = 0;

    const readCache = createContractReadCache();
    // Only employer/asset are cached: the payroll contract has no setters for
    // them. Recipients (update_recipients) and relayer (set_relayer) are
    // admin-mutable, so they are read fresh below — caching them could write
    // stale amounts into PayrollPayout rows and the fiat off-ramp jobs derived
    // from them.
    const readPayrollEmployerCached = readCache(
      "payroll:employer",
      readPayrollEmployer,
      (addr) => addr,
    );
    const readPayrollAssetCached = readCache("payroll:asset", readPayrollAsset, (addr) => addr);

    for (const d of deployments) {
      const pipeline = d.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;
      const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
      const subscriptionDevNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION_DEV");
      const splitterDevNode = pipeline?.find((n) => n.templateKind === "SPLITTER_DEV");
      const subscriptionNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION");
      const splitterNode = pipeline?.find((n) => n.templateKind === "SPLITTER");

      const cashOutContractAddresses = new Set(
        pipeline
          ?.filter((n) => n.templateKind === "CASH_OUT" || n.templateKind === "CASH_OUT_DEV")
          .map((n) => n.contractAddress) ?? [],
      );

      const isMonolithic =
        payrollNode?.contractAddress &&
        (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM ||
          d.chargeRelayerMode === ChargeRelayerMode.USER);
      const isDev = subscriptionDevNode?.contractAddress && splitterDevNode?.contractAddress;
      const isSubscriptionLike = subscriptionNode?.contractAddress && splitterNode?.contractAddress;

      if (!isMonolithic && !isDev && !isSubscriptionLike) {
        results.push({
          deploymentId: d.id,
          contractAddress:
            payrollNode?.contractAddress ??
            subscriptionDevNode?.contractAddress ??
            subscriptionNode?.contractAddress ??
            "",
          status: "skipped",
          error: "No chargeable payroll contract in pipeline",
        });
        continue;
      }

      let contractAddress = "";
      let payrollRunId: string | null = null;
      try {
        if (isDev) {
          contractAddress = subscriptionDevNode!.contractAddress;
          const devChargedCount = await chargeSubscriptionPayrollDeployment(
            d,
            contractAddress,
            splitterDevNode!.contractAddress,
            now,
            readSplitterDevRecipients,
            true,
            cashOutContractAddresses,
            readCache,
          );
          platformCharged += devChargedCount;
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "charged",
          });
          continue;
        }

        if (isSubscriptionLike) {
          contractAddress = subscriptionNode!.contractAddress;
          const chargedCount = await chargeSubscriptionPayrollDeployment(
            d,
            contractAddress,
            splitterNode!.contractAddress,
            now,
            readSplitterRecipients,
            false,
            cashOutContractAddresses,
            readCache,
          );
          platformCharged += chargedCount;
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "charged",
          });
          continue;
        }

        contractAddress = payrollNode!.contractAddress;
        const [cancelled, nextChargeAt] = await Promise.all([
          readPayrollIsCancelled(contractAddress),
          readPayrollNextChargeAt(contractAddress),
        ]);

        if (cancelled) {
          await db.deployment.update({
            where: { id: d.id },
            data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        if (d.chargeEndAt && d.chargeEndAt <= now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { chargeRelayerMode: ChargeRelayerMode.MANUAL, nextChargeAt: null },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        const nextChargeDate = new Date(Number(nextChargeAt) * 1000);
        if (nextChargeDate > now) {
          await db.deployment.update({
            where: { id: d.id },
            data: { nextChargeAt: nextChargeDate },
          });
          results.push({ deploymentId: d.id, contractAddress, status: "skipped" });
          continue;
        }

        const [recipients, employer, asset, onChainRelayer] = await Promise.all([
          readPayrollRecipients(contractAddress),
          readPayrollEmployerCached(contractAddress),
          readPayrollAssetCached(contractAddress),
          readPayrollRelayer(contractAddress),
        ]);

        const totalAmount = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n);

        const existingEmployees = await db.employee.findMany({
          where: { deploymentId: d.id },
          include: { bankDetail: true },
        });
        const hasFiatEmployeeWithBank = existingEmployees.some(
          (e) => e.payoutMode === "FIAT" && e.bankDetail,
        );

        const allowance = await readTokenAllowance({
          tokenContractAddress: asset,
          owner: employer,
          spender: contractAddress,
        });
        if (allowance < totalAmount) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: "Insufficient allowance",
          });
          continue;
        }

        const expectedRelayer =
          d.chargeRelayerMode === ChargeRelayerMode.PLATFORM
            ? stellarRelayerAddress()
            : d.chargeRelayerAddress;
        if (expectedRelayer && onChainRelayer !== expectedRelayer) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: `Relayer mismatch: on-chain ${onChainRelayer}, configured ${expectedRelayer}`,
          });
          continue;
        }

        const payrollRun = await db.payrollRun.create({
          data: {
            deploymentId: d.id,
            runAt: now,
            status: PayrollRunStatus.PENDING,
            totalStroops: totalAmount.toString(),
          },
        });
        payrollRunId = payrollRun.id;

        let chargedCount = 0;
        const chargeTxHashes: string[] = [];

        if (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM) {
          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const submit = await withRelayerLock(async () => {
              const { xdr } = await preparePayrollChargeByRelayerTx(contractAddress);
              return submitPayrollChargeByRelayerTx(xdr);
            });

            if (submit.status === "SUCCESS") {
              chargedCount++;
              chargeTxHashes.push(submit.txHash);

              for (const r of recipients) {
                const employee = await db.employee.upsert({
                  where: {
                    deploymentId_address: {
                      deploymentId: d.id,
                      address: r.address,
                    },
                  },
                  create: {
                    deploymentId: d.id,
                    address: r.address,
                    amountStroops: r.amount,
                  },
                  update: {
                    amountStroops: r.amount,
                  },
                });
                await db.payrollPayout.create({
                  data: {
                    payrollRunId: payrollRun.id,
                    employeeId: employee.id,
                    amountStroops: r.amount,
                    txHash: submit.txHash,
                  },
                });
              }

              const next = await readPayrollNextChargeAt(contractAddress);
              if (new Date(Number(next) * 1000) > new Date()) break;
            } else {
              throw new Error(submit.errorMessage ?? "Platform charge submission failed");
            }
          }
        } else {
          if (!d.chargeRelayerUrl || !d.chargeRelayerAddress) {
            await db.payrollRun.update({
              where: { id: payrollRun.id },
              data: {
                status: PayrollRunStatus.FAILED,
                failedAt: new Date(),
                lastError: "USER relayer mode missing url or address",
              },
            });
            results.push({
              deploymentId: d.id,
              contractAddress,
              status: "failed",
              error: "USER relayer mode missing url or address",
            });
            continue;
          }

          for (let i = 0; i < MAX_CATCHUP_PER_RUN; i++) {
            const { xdr: unsignedXdr } = await preparePayrollChargeByRelayerUnsigned({
              contractAddress,
              relayerAddress: d.chargeRelayerAddress,
            });

            const body = {
              deploymentId: d.id,
              contractAddress,
              network: env().STELLAR_NETWORK,
              networkPassphrase: stellarPassphrase(),
              unsignedXdr,
            };

            const res = await fetch(d.chargeRelayerUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(d.chargeRelayerToken
                  ? { Authorization: `Bearer ${d.chargeRelayerToken}` }
                  : {}),
              },
              body: JSON.stringify(body),
            });

            if (!res.ok) {
              throw new Error(`User relayer returned ${res.status}: ${await res.text()}`);
            }

            const json = (await res.json()) as {
              status: string;
              txHash?: string;
              signedXdr?: string;
              errorMessage?: string;
            };

            let chargeTxHash: string | undefined;
            if (json.status === "SUCCESS" && json.txHash) {
              chargedCount++;
              chargeTxHashes.push(json.txHash);
              chargeTxHash = json.txHash;
            } else if (json.status === "PENDING" && json.signedXdr) {
              const submit = await submitPayrollChargeByRelayerTx(json.signedXdr);
              if (submit.status === "SUCCESS") {
                chargedCount++;
                chargeTxHashes.push(submit.txHash);
                chargeTxHash = submit.txHash;
              } else {
                throw new Error(submit.errorMessage ?? "User relayer submission failed");
              }
            } else {
              throw new Error(json.errorMessage ?? "User relayer did not return success");
            }

            if (chargeTxHash) {
              for (const r of recipients) {
                const employee = await db.employee.upsert({
                  where: {
                    deploymentId_address: {
                      deploymentId: d.id,
                      address: r.address,
                    },
                  },
                  create: {
                    deploymentId: d.id,
                    address: r.address,
                    amountStroops: r.amount,
                  },
                  update: {
                    amountStroops: r.amount,
                  },
                });
                await db.payrollPayout.create({
                  data: {
                    payrollRunId: payrollRun.id,
                    employeeId: employee.id,
                    amountStroops: r.amount,
                    txHash: chargeTxHash,
                  },
                });
              }
            }

            const next = await readPayrollNextChargeAt(contractAddress);
            if (new Date(Number(next) * 1000) > new Date()) break;
          }
        }

        if (chargedCount === 0) {
          await db.payrollRun.update({
            where: { id: payrollRun.id },
            data: {
              status: PayrollRunStatus.FAILED,
              failedAt: new Date(),
              lastError: "No charges executed",
            },
          });
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: "No charges executed",
          });
          continue;
        }

        const next = await readPayrollNextChargeAt(contractAddress);
        await db.$transaction(async (tx) => {
          await tx.deployment.update({
            where: { id: d.id },
            data: {
              lastChargedAt: new Date(),
              nextChargeAt: new Date(Number(next) * 1000),
            },
          });

          await tx.payrollRun.update({
            where: { id: payrollRun.id },
            data: {
              status: PayrollRunStatus.CHARGED,
              chargedAt: new Date(),
              txHash: chargeTxHashes[0] ?? null,
            },
          });

          if (hasFiatEmployeeWithBank) {
            await createOffRampJobsForPayrollRun(tx, payrollRun.id);
          }
        });

        log.info(
          {
            deploymentId: d.id,
            payrollRunId: payrollRun.id,
            chargeTxHashes: chargeTxHashes.length,
          },
          "Created payroll run and off-ramp jobs",
        );

        if (d.chargeRelayerMode === ChargeRelayerMode.PLATFORM) {
          platformCharged += chargedCount;
        } else {
          userCharged += chargedCount;
        }
        results.push({ deploymentId: d.id, contractAddress, status: "charged" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (payrollRunId) {
          try {
            await db.payrollRun.update({
              where: { id: payrollRunId },
              data: {
                status: PayrollRunStatus.FAILED,
                failedAt: new Date(),
                lastError: message,
              },
            });
          } catch (updateErr) {
            log.warn(
              { deploymentId: d.id, payrollRunId, error: String(updateErr) },
              "Failed to mark payroll run as FAILED",
            );
          }
        }

        if (isExpectedSkipError(message)) {
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "skipped",
            error: message,
          });
        } else {
          log.warn(
            { deploymentId: d.id, contractAddress, error: message },
            "Payroll charge failed",
          );
          results.push({
            deploymentId: d.id,
            contractAddress,
            status: "failed",
            error: message,
          });
        }
      }
    }

    return NextResponse.json({
      data: {
        platformCharged,
        userCharged,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
        processed: deployments.length,
        details: results,
      },
    });
  });
}
