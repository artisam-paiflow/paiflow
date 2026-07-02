import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { createOffRampJobsForPayrollRun } from "@/lib/offramp/jobs";
import {
  readPayrollRecipients,
  readSplitterDevRecipients,
  readSplitterRecipients,
  readSubscriptionAmountPerPeriod,
} from "@/lib/stellar/relayer";
import { PayrollRunStatus } from "@prisma/client";

const PostSchema = z.object({
  txHash: z.string().min(1, "txHash is required"),
});

/**
 * Record a manually-triggered payroll run and create off-ramp jobs.
 *
 * The auto-charge payroll cron creates PayrollRun/PayrollPayout rows for
 * scheduled platform/user-relayer charges. When an operator clicks RUN PAYROLL
 * in the UI, the on-chain charge is signed by the admin and submitted through
 * the generic submit-invoke endpoint, which does not create those rows. This
 * endpoint is the bookkeeping follow-up: it reads the current on-chain
 * recipients, creates the run record, and spawns off-ramp jobs if enabled.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const body = PostSchema.parse(await req.json());

    const rlKey = user ? `payroll-record:${user.id}` : `payroll-record:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many payroll run recordings");

    const where = user ? { id, ownerId: user.id } : { id };
    const d = await db.deployment.findFirst({
      where,
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.flow.templateKind !== "PAYROLL") {
      throw new AppError("VALIDATION", "Deployment is not a payroll");
    }

    // Idempotency: a retry with the same txHash returns the existing run.
    const existingRun = await db.payrollRun.findUnique({
      where: { txHash: body.txHash },
      include: {
        payouts: { include: { offRampJobs: { select: { id: true } } } },
        offRampJobs: { select: { id: true } },
      },
    });
    if (existingRun) {
      const existingJobIds = existingRun.offRampJobs.map((j) => j.id);
      return NextResponse.json({
        data: {
          payrollRunId: existingRun.id,
          payoutCount: existingRun.payouts.length,
          offRampJobIds: existingJobIds,
          idempotent: true,
        },
      });
    }

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;

    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    const splitterNode = pipeline?.find(
      (n) => n.templateKind === "SPLITTER_DEV" || n.templateKind === "SPLITTER",
    );
    const subscriptionNode = pipeline?.find(
      (n) => n.templateKind === "SUBSCRIPTION_DEV" || n.templateKind === "SUBSCRIPTION",
    );

    let recipientRows: Array<{ address: string; amount: string }> = [];

    if (payrollNode?.contractAddress) {
      recipientRows = await readPayrollRecipients(payrollNode.contractAddress);
    } else if (splitterNode?.contractAddress) {
      const isDev = splitterNode.templateKind === "SPLITTER_DEV";
      const raw = isDev
        ? await readSplitterDevRecipients(splitterNode.contractAddress)
        : await readSplitterRecipients(splitterNode.contractAddress);
      let totalStroops = 0n;
      if (subscriptionNode?.contractAddress) {
        totalStroops = await readSubscriptionAmountPerPeriod(subscriptionNode.contractAddress);
      }
      recipientRows = raw.map((r) => {
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
    } else {
      throw new AppError("VALIDATION", "Payroll recipient contract address not available");
    }

    const totalStroops = recipientRows.reduce((sum, r) => sum + BigInt(r.amount), 0n);
    const now = new Date();

    const run = await db.payrollRun.create({
      data: {
        deploymentId: d.id,
        runAt: now,
        status: PayrollRunStatus.CHARGED,
        totalStroops: totalStroops.toString(),
        chargedAt: now,
        txHash: body.txHash,
      },
    });

    const existingEmployees = await db.employee.findMany({
      where: { deploymentId: d.id },
    });
    const employeeByCashOut = new Map(
      existingEmployees
        .filter((e) => e.cashOutContractAddress)
        .map((e) => [e.cashOutContractAddress!, e]),
    );
    const employeeByWallet = new Map(existingEmployees.map((e) => [e.address, e]));

    let offRampJobIds: string[] = [];

    // Create payouts and off-ramp jobs in one transaction so the event feed
    // never observes a fiat payout with a txHash but no linked off-ramp job.
    // If off-ramp job creation fails, the whole transaction rolls back rather
    // than leaving a partial set of fiat payouts without jobs.
    await db.$transaction(
      async (tx) => {
        for (const r of recipientRows) {
          const existing = employeeByCashOut.get(r.address) ?? employeeByWallet.get(r.address);
          const walletAddress = existing?.address ?? r.address;

          const employee = await tx.employee.upsert({
            where: { deploymentId_address: { deploymentId: d.id, address: walletAddress } },
            create: {
              deploymentId: d.id,
              address: walletAddress,
              amountStroops: r.amount,
            },
            update: {
              amountStroops: r.amount,
            },
          });

          await tx.payrollPayout.create({
            data: {
              payrollRunId: run.id,
              employeeId: employee.id,
              amountStroops: r.amount,
              txHash: body.txHash,
            },
          });
        }

        if (d.offRampEnabled) {
          offRampJobIds = await createOffRampJobsForPayrollRun(tx, run.id);
        }
      },
      { maxWait: 5000, timeout: 30000 },
    );

    await audit({
      action: "DEPLOY_INVOKE",
      userId: user?.id ?? null,
      metadata: { deploymentId: d.id, payrollRunId: run.id, payoutCount: recipientRows.length },
    });

    return NextResponse.json({
      data: {
        payrollRunId: run.id,
        payoutCount: recipientRows.length,
        offRampJobIds,
      },
    });
  });
}
