import { NextRequest, NextResponse } from "next/server";
import { OffRampPayoutJobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  getDueOffRampJobs,
  rescheduleOffRampJob,
  cancelPendingOffRampJobs,
} from "@/lib/offramp/jobs";
import { getOffRampProvider, offRampAssetCode, offRampFiatCurrency } from "@/lib/offramp/provider";

export const dynamic = "force-dynamic";

const MAX_RETRY_ATTEMPTS = 3;

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

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const jobs = await getDueOffRampJobs(db, 50);
    const results: Array<{
      jobId: string;
      employeeId: string;
      status: "quoted" | "traded" | "initiated" | "completed" | "skipped" | "failed" | "cancelled";
      error?: string;
    }> = [];

    for (const job of jobs) {
      const deployment = await db.deployment.findUnique({
        where: { id: job.payrollRun.deploymentId },
        include: { offRampSenderProfile: true },
      });

      if (!deployment || deployment.status !== "CONFIRMED") {
        await cancelPendingOffRampJobs(db, job.payrollRun.deploymentId);
        results.push({
          jobId: job.id,
          employeeId: job.employeeId,
          status: "cancelled",
          error: "Deployment no longer CONFIRMED",
        });
        continue;
      }

      await rescheduleOffRampJob(db, job.id, {
        status: OffRampPayoutJobStatus.RUNNING,
      });

      try {
        const bankDetail = job.employee.bankDetail;
        if (!bankDetail) {
          throw new Error("No bank details for employee");
        }

        const sender = deployment.offRampSenderProfile;
        if (!sender) {
          throw new Error("No sender profile for deployment");
        }

        const provider = getOffRampProvider();

        // 1. Firm quote: USDCXLM -> PHP
        const quote = await provider.quote({
          amountStroops: job.amountStroops,
          assetCode: offRampAssetCode(),
          fiatCurrency: offRampFiatCurrency(),
        });

        await rescheduleOffRampJob(db, job.id, {
          status: OffRampPayoutJobStatus.QUOTED,
          providerQuote: quote as unknown as Prisma.InputJsonValue,
        });

        // 2. Execute trade using the firm quote.
        const trade = await provider.executeTrade({
          quoteId: quote.id,
          amountStroops: job.amountStroops,
          employeeId: job.employeeId,
          payrollRunId: job.payrollRunId,
        });

        if (trade.status === "FAILED") {
          throw new Error("Provider trade returned FAILED");
        }

        await rescheduleOffRampJob(db, job.id, {
          status: OffRampPayoutJobStatus.INITIATED,
          tradeRef: trade.providerRef,
        });

        // 3. Withdraw PHP to beneficiary bank account.
        const payout = await provider.initiatePayout({
          tradeRef: trade.providerRef,
          amountStroops: job.amountStroops,
          fiatAmount: quote.fiatAmount,
          fiatCurrency: quote.fiatCurrency,
          accountName: bankDetail.accountName,
          accountNumber: bankDetail.accountNumber,
          bankCode: bankDetail.bankCode,
          employeeId: job.employeeId,
          payrollRunId: job.payrollRunId,
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
            employeeId: job.employeeId,
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
          employeeId: job.employeeId,
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
            employeeId: job.employeeId,
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
            employeeId: job.employeeId,
            status: "failed",
            error: message,
          });
        } else {
          log.warn(
            {
              jobId: job.id,
              employeeId: job.employeeId,
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
            employeeId: job.employeeId,
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

export const GET = POST;
