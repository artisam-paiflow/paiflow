import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  preparePayrollChargeInvocation,
  prepareSubscriptionChargeInvocation,
} from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";

type PipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

const PAYROLL_KINDS = new Set(["PAYROLL", "SUBSCRIPTION_DEV", "SUBSCRIPTION"]);

function findPayrollNode(pipeline: PipelineNode[] | null): PipelineNode | null {
  return pipeline?.find((n) => PAYROLL_KINDS.has(n.templateKind)) ?? null;
}

function isSubscriptionLike(templateKind: string): boolean {
  return templateKind === "SUBSCRIPTION" || templateKind === "SUBSCRIPTION_DEV";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.flow.templateKind !== "PAYROLL") {
      throw new AppError("VALIDATION", "Deployment is not a payroll");
    }

    const pipeline = d.pipelineSnapshot as PipelineNode[] | null;
    const payrollNode = findPayrollNode(pipeline);
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    if (!d.sourceAccount) {
      throw new AppError("VALIDATION", "Deployment source account is not available");
    }

    const isSubscription = isSubscriptionLike(payrollNode.templateKind);
    const { xdr } = isSubscription
      ? await prepareSubscriptionChargeInvocation({
          contractAddress: payrollNode.contractAddress,
          adminAddress: d.sourceAccount,
        })
      : await preparePayrollChargeInvocation({
          contractAddress: payrollNode.contractAddress,
          adminAddress: d.sourceAccount,
        });

    return NextResponse.json({
      data: {
        unsignedXdr: xdr,
        contractAddress: payrollNode.contractAddress,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
