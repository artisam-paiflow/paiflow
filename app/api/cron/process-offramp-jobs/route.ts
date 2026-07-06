import { NextRequest, NextResponse } from "next/server";
import { OffRampJobSource, OffRampPayoutJobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  getDueOffRampJobs,
  rescheduleOffRampJob,
  cancelPendingOffRampJobs,
  claimOffRampJob,
} from "@/lib/offramp/jobs";
import { getOffRampProvider, offRampAssetCode, offRampFiatCurrency } from "@/lib/offramp/provider";
import { resolveCashOutAsset, resolvePayrollAsset } from "@/lib/offramp/assets";
import { offRampPdaxDepositConfig } from "@/lib/env";
import {
  getTreasuryBalance,
  refundFromTreasury,
  depositNativeToProvider,
} from "@/lib/stellar/dev-mutate";
import { assetContractId } from "@/lib/stellar/assets";
import type { FlowGraph } from "@/lib/flows/schema";
import type { Asset } from "@/lib/flows/schema";
import { checkHardLimits } from "@/lib/flows/limits";

export const dynamic = "force-dynamic";

const MAX_RETRY_ATTEMPTS = Math.max(0, env().OFFRAMP_MAX_RETRY_ATTEMPTS);

function isRetryableError(message: string): boolean {
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("RateLimit") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("fetch failed")
  );
}

function isKnownSkipError(message: string): boolean {
  return (
    message.includes("No bank details") ||
    message.includes("No sender profile") ||
    message.includes("Invalid bank") ||
    message.includes("Unsupported bank") ||
    message.includes("Invalid account")
  );
}

/**
 * True if the failure happened before the PDAX trade executed.
 * At that point the crypto is still in the treasury and can be refunded to the
 * source address. Once the trade has executed (INITIATED or beyond) the crypto
 * is gone, so we retry the withdrawal rather than refunding.
 */
function isPreTradeFailure(status: OffRampPayoutJobStatus): boolean {
  return status === OffRampPayoutJobStatus.PENDING || status === OffRampPayoutJobStatus.RUNNING;
}

type PipelineNodeSnapshot = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

function resolveJobAsset(job: {
  source: OffRampJobSource;
  sourceAddress: string | null;
  employeeId: string | null;
  deployment: { graphSnapshot: Prisma.JsonValue; pipelineSnapshot: Prisma.JsonValue } | null;
}): Asset | null {
  const deployment = job.deployment;
  if (!deployment) return null;
  const graph = deployment.graphSnapshot as FlowGraph | null;
  const pipeline = deployment.pipelineSnapshot as PipelineNodeSnapshot[] | null;
  if (job.source === OffRampJobSource.CASH_OUT) {
    if (!job.sourceAddress) return null;
    const asset = resolveCashOutAsset(graph, pipeline, job.sourceAddress);
    if (asset) return asset;
    // Dev-mode payrolls generate CASH_OUT_DEV sinks on demand. Those sinks are
    // not (yet) reflected as `cash_out` nodes in the saved graph snapshot, but
    // the job was created from an employee payout so the payroll asset is the
    // correct off-ramp asset.
    if (job.employeeId) return resolvePayrollAsset(graph);
    return null;
  }
  return resolvePayrollAsset(graph);
}

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const jobs = await getDueOffRampJobs(db, env().OFFRAMP_BATCH_SIZE);
    const results: Array<{
      jobId: string;
      status: "quoted" | "traded" | "initiated" | "completed" | "skipped" | "failed" | "cancelled";
      error?: string;
    }> = [];

    for (const job of jobs) {
      const deployment = job.deployment;

      if (!deployment || deployment.status !== "CONFIRMED") {
        await cancelPendingOffRampJobs(db, job.deploymentId);
        results.push({
          jobId: job.id,
          status: "cancelled",
          error: "Deployment no longer CONFIRMED",
        });
        continue;
      }

      // Atomically claim the job for this run. For a PENDING job this flips it
      // to RUNNING once; for a stale RUNNING job (a crashed/timed-out prior run
      // whose lease expired) this re-claims it via an exact-lease CAS. Either
      // way only one overlapping cron run wins — this prevents double-processing
      // (and, for native XLM cash-outs, a real on-chain double deposit).
      const claimed = await claimOffRampJob(db, job.id, job.status, job.lockedAt);
      if (!claimed) {
        results.push({
          jobId: job.id,
          status: "skipped",
          error: "Job already claimed by another run",
        });
        continue;
      }

      let asset: Asset | null = null;
      let currentStatus: OffRampPayoutJobStatus = OffRampPayoutJobStatus.RUNNING;

      try {
        const bankDetail = {
          accountName: job.bankAccountName,
          accountNumber: job.bankAccountNumber,
          bankCode: job.bankCode,
        };
        if (!bankDetail.accountName || !bankDetail.accountNumber || !bankDetail.bankCode) {
          throw new Error("No bank details for off-ramp job");
        }

        const sender = deployment.offRampSenderProfile;
        if (!sender) {
          throw new Error("No sender profile for deployment");
        }

        asset = resolveJobAsset(job);
        if (!asset) {
          throw new Error("Could not resolve off-ramp asset from deployment graph");
        }

        const hardLimitIssue = checkHardLimits(asset, job.amountStroops);
        if (hardLimitIssue) {
          throw new Error(hardLimitIssue.message);
        }

        const provider = getOffRampProvider();

        // For cash-out jobs, confirm the on-chain sink actually reached the
        // treasury before we quote or trade. If the splitter did not invoke
        // receive_and_forward, the treasury will be underfunded and the trade
        // would silently draw from the employer's PDAX balance instead.
        if (job.source === OffRampJobSource.CASH_OUT) {
          const treasuryBalance = await getTreasuryBalance(assetContractId(asset));
          if (treasuryBalance < BigInt(job.amountStroops)) {
            throw new Error(
              `Treasury balance ${treasuryBalance.toString()} is less than job amount ${job.amountStroops}; cash-out sink not confirmed`,
            );
          }

          if (asset.kind === "native") {
            // Native XLM deposits are enabled in PDAX UAT. Forward the job
            // amount from the relayer treasury to the PDAX deposit address with
            // the required memo/tag so the trade is funded by the on-chain sink.
            const pdax = offRampPdaxDepositConfig();
            const hasAddress = Boolean(pdax.address);
            const hasMemo = Boolean(pdax.memo);
            if (hasAddress !== hasMemo) {
              // Half-configured: exactly one of address/memo is set. Falling
              // through here would silently draw the trade from the employer's
              // pre-funded balance instead of depositing the on-chain sink, so
              // fail hard rather than move real funds under a wrong assumption.
              // (No deposit has happened, so the pre-trade refund path returns
              // the treasury funds to the source address.)
              throw new Error(
                "PDAX native XLM deposit is half-configured: set BOTH deposit address and memo, or neither",
              );
            }
            if (pdax.address && pdax.memo) {
              if (job.pdaxDepositTxHash) {
                // Idempotency: a prior run already deposited to PDAX. Do NOT
                // deposit again (the balance guard alone cannot catch this when
                // the treasury is a separate/pooled address), just proceed to
                // quote/trade against the already-deposited funds.
                log.info(
                  { jobId: job.id, txHash: job.pdaxDepositTxHash },
                  "PDAX XLM deposit already completed; skipping re-deposit",
                );
              } else {
                log.info(
                  {
                    jobId: job.id,
                    sourceAddress: job.sourceAddress,
                    amountStroops: job.amountStroops,
                    treasuryBalance: treasuryBalance.toString(),
                    pdaxAddress: pdax.address,
                    pdaxMemo: pdax.memo,
                  },
                  "Depositing XLM from treasury to PDAX",
                );
                const deposit = await depositNativeToProvider({
                  destination: pdax.address,
                  memo: pdax.memo,
                  amountStroops: job.amountStroops,
                });
                if (deposit.status === "UNKNOWN") {
                  // Ambiguous outcome: Horizon submit threw and we could not
                  // confirm whether the payment landed. Do NOT retry (could
                  // double-deposit) and do NOT refund (funds may have already
                  // left). Fail for manual review.
                  const error = `PDAX XLM deposit outcome unknown; verify tx ${deposit.txHash} before retrying or refunding`;
                  log.warn({ jobId: job.id, txHash: deposit.txHash }, error);
                  await rescheduleOffRampJob(db, job.id, {
                    status: OffRampPayoutJobStatus.FAILED,
                    lastError: error,
                  });
                  results.push({
                    jobId: job.id,
                    status: "failed",
                    error,
                  });
                  continue;
                }
                if (deposit.status !== "SUCCESS") {
                  throw new Error(`PDAX XLM deposit failed: ${deposit.errorMessage}`);
                }
                // Update the in-memory job BEFORE persisting so that a DB write
                // failure in rescheduleOffRampJob doesn't cause the catch handler
                // to refund funds that already left for PDAX.
                job.pdaxDepositTxHash = deposit.txHash;
                // Persist the deposit tx BEFORE quote/trade so any downstream
                // failure + retry detects "already deposited" and never
                // re-deposits or refunds from the treasury.
                await rescheduleOffRampJob(db, job.id, {
                  status: OffRampPayoutJobStatus.RUNNING,
                  pdaxDepositTxHash: deposit.txHash,
                });
                log.info({ jobId: job.id, txHash: deposit.txHash }, "PDAX XLM deposit confirmed");
              }
            } else {
              log.warn(
                {
                  jobId: job.id,
                  sourceAddress: job.sourceAddress,
                  amountStroops: job.amountStroops,
                  treasuryBalance: treasuryBalance.toString(),
                },
                "Native XLM cash-out sink confirmed but PDAX deposit address/memo not configured; trade will draw from pre-funded balance",
              );
            }
          } else {
            // For non-native assets (e.g. Stellar USDC in PDAX UAT), on-chain
            // deposits may be disabled, so the trade draws from the employer's
            // pre-funded provider balance. The treasury sink is still verified
            // above as the bookkeeping proof.
            log.info(
              {
                jobId: job.id,
                sourceAddress: job.sourceAddress,
                amountStroops: job.amountStroops,
                treasuryBalance: treasuryBalance.toString(),
              },
              "Cash-out sink confirmed; trade will be funded by pre-funded provider balance",
            );
          }
        }

        // 1. Firm quote: crypto -> PHP
        const quote = await provider.quote({
          amountStroops: job.amountStroops,
          assetCode: offRampAssetCode(asset),
          fiatCurrency: offRampFiatCurrency(),
        });

        await rescheduleOffRampJob(db, job.id, {
          status: OffRampPayoutJobStatus.QUOTED,
          providerQuote: quote as unknown as Prisma.InputJsonValue,
        });
        currentStatus = OffRampPayoutJobStatus.QUOTED;

        // 2. Execute trade using the firm quote.
        const trade = await provider.executeTrade({
          quoteId: quote.id,
          amountStroops: job.amountStroops,
          employeeId: job.employeeId ?? undefined,
          payrollRunId: job.payrollRunId ?? undefined,
          jobId: job.id,
          jobSource: job.source,
        });

        if (trade.status === "FAILED") {
          throw new Error("Provider trade returned FAILED");
        }

        await rescheduleOffRampJob(db, job.id, {
          status: OffRampPayoutJobStatus.INITIATED,
          tradeRef: trade.providerRef,
        });
        currentStatus = OffRampPayoutJobStatus.INITIATED;

        // 3. Withdraw PHP to beneficiary bank account.
        const payout = await provider.initiatePayout({
          tradeRef: trade.providerRef,
          amountStroops: job.amountStroops,
          fiatAmount: quote.fiatAmount,
          fiatCurrency: quote.fiatCurrency,
          accountName: bankDetail.accountName,
          accountNumber: bankDetail.accountNumber,
          bankCode: bankDetail.bankCode,
          employeeId: job.employeeId ?? undefined,
          payrollRunId: job.payrollRunId ?? undefined,
          jobId: job.id,
          sender: {
            firstName: sender.firstName,
            middleName: sender.middleName,
            lastName: sender.lastName,
            countryOrigin: sender.countryOrigin,
            addressLineOne: sender.addressLineOne,
            addressLineTwo: sender.addressLineTwo,
            city: sender.city,
            province: sender.province,
            country: sender.country,
            zipCode: sender.zipCode,
            phoneNumber: sender.phoneNumber,
            nationality: sender.nationality,
            nationalIdentityNumber: sender.nationalIdentityNumber,
            dob: sender.dob,
            placeOfBirth: sender.placeOfBirth,
            sourceOfFunds: sender.sourceOfFunds,
            email: sender.email,
          },
          jobSource: job.source,
        });

        if (payout.status === "FAILED") {
          throw new Error("Provider payout returned FAILED");
        }

        const terminalStatus =
          payout.status === "COMPLETED"
            ? OffRampPayoutJobStatus.COMPLETED
            : OffRampPayoutJobStatus.INITIATED;

        await rescheduleOffRampJob(db, job.id, {
          status: terminalStatus,
          providerRef: payout.providerRef,
          completedAt: payout.status === "COMPLETED" ? new Date() : null,
        });

        log.info(
          {
            jobId: job.id,
            source: job.source,
            payrollRunId: job.payrollRunId,
            tradeRef: trade.providerRef,
            providerRef: payout.providerRef,
            status: terminalStatus,
          },
          "Off-ramp payout initiated",
        );

        const resultStatus = payout.status === "COMPLETED" ? "completed" : ("initiated" as const);
        results.push({
          jobId: job.id,
          status: resultStatus,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (isKnownSkipError(message)) {
          await rescheduleOffRampJob(db, job.id, {
            status: OffRampPayoutJobStatus.CANCELLED,
            lastError: message,
          });
          results.push({
            jobId: job.id,
            status: "skipped",
            error: message,
          });
        } else if (isRetryableError(message) && job.attemptCount < MAX_RETRY_ATTEMPTS) {
          const retryAt = new Date(Date.now() + 60_000 * (job.attemptCount + 1));
          await db.offRampPayoutJob.update({
            where: { id: job.id },
            data: {
              status: OffRampPayoutJobStatus.PENDING,
              runAt: retryAt,
              lastError: message,
              attemptCount: { increment: 1 },
            },
          });
          results.push({
            jobId: job.id,
            status: "failed",
            error: message,
          });
        } else if (
          isPreTradeFailure(currentStatus) &&
          job.sourceAddress &&
          asset &&
          !job.pdaxDepositTxHash
        ) {
          // Refund policy: before the trade executes, the crypto is still in the
          // treasury. Refund to the on-chain source address using the same asset
          // the job was meant to off-ramp.
          //
          // NOTE: skipped when `pdaxDepositTxHash` is set — for native XLM jobs
          // the funds have already left the treasury for PDAX, so refunding from
          // the treasury would draw down pooled/other jobs' balances. Those jobs
          // fall through to the generic FAILED branch below for manual recovery.
          const refund = await refundFromTreasury({
            destination: job.sourceAddress,
            amountStroops: job.amountStroops,
            assetContractAddress: assetContractId(asset),
          });
          const refundStatus =
            refund.status === "SUCCESS"
              ? OffRampPayoutJobStatus.FAILED
              : OffRampPayoutJobStatus.CANCELLED;
          log.warn(
            {
              jobId: job.id,
              source: job.source,
              sourceAddress: job.sourceAddress,
              amountStroops: job.amountStroops,
              refundStatus: refund.status,
              error: message,
            },
            "Off-ramp payout failed pre-trade; refunded treasury to source",
          );
          await rescheduleOffRampJob(db, job.id, {
            status: refundStatus,
            lastError: `${message}; refund ${refund.status}`,
          });
          results.push({
            jobId: job.id,
            status: "failed",
            error: `${message}; refund ${refund.status}`,
          });
        } else {
          log.warn(
            {
              jobId: job.id,
              source: job.source,
              payrollRunId: job.payrollRunId,
              error: message,
            },
            "Off-ramp payout failed",
          );
          await rescheduleOffRampJob(db, job.id, {
            status: OffRampPayoutJobStatus.FAILED,
            lastError: message,
          });
          results.push({
            jobId: job.id,
            status: "failed",
            error: message,
          });
        }
      }
    }

    const quoted = results.filter((r) => r.status === "quoted").length;
    const traded = results.filter((r) => r.status === "traded").length;
    const initiated = results.filter((r) => r.status === "initiated").length;
    const completed = results.filter((r) => r.status === "completed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const cancelled = results.filter((r) => r.status === "cancelled").length;

    return NextResponse.json({
      data: {
        quoted,
        traded,
        initiated,
        completed,
        skipped,
        failed,
        cancelled,
        processed: jobs.length,
        details: results,
      },
    });
  });
}
