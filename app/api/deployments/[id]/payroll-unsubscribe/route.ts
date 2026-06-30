import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  preparePayrollUnsubscribeInvocation,
  prepareSubscriptionUnsubscribeInvocation,
} from "@/lib/stellar/invoke";
import { readSubscriptionSubscriberNullable } from "@/lib/stellar/relayer";
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

    const isSubscription = isSubscriptionLike(payrollNode.templateKind);
    let employerAddress: string;

    if (isSubscription) {
      employerAddress =
        (await readSubscriptionSubscriberNullable(payrollNode.contractAddress)) ?? "";
    } else {
      const paramsSnapshot = d.paramsSnapshot as Array<{
        nodeId: string;
        templateKind: string;
        params: { kind: string; employer?: string };
      }> | null;
      const payrollParams = paramsSnapshot?.find(
        (n) => n.templateKind === "PAYROLL" && n.params.kind === "payroll_trigger",
      );
      employerAddress = payrollParams?.params?.employer ?? "";
    }

    if (!employerAddress) {
      throw new AppError("VALIDATION", "Employer address not available");
    }

    const { xdr } = isSubscription
      ? await prepareSubscriptionUnsubscribeInvocation({
          contractAddress: payrollNode.contractAddress,
          subscriberAddress: employerAddress,
        })
      : await preparePayrollUnsubscribeInvocation({
          contractAddress: payrollNode.contractAddress,
          employerAddress,
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
