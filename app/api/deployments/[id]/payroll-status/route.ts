import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { readPayrollIsCancelled, readSubscriptionIsCancelled } from "@/lib/stellar/relayer";

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

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

    const isSubscription = isSubscriptionLike(payrollNode.templateKind);
    const isCancelled = isSubscription
      ? await readSubscriptionIsCancelled(payrollNode.contractAddress)
      : await readPayrollIsCancelled(payrollNode.contractAddress);

    return NextResponse.json({
      data: {
        isCancelled,
        contractAddress: payrollNode.contractAddress,
      },
    });
  });
}
