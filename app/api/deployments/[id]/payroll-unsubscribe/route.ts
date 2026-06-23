import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { preparePayrollUnsubscribeInvocation } from "@/lib/stellar/invoke";
import { stellarPassphrase } from "@/lib/env";

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

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    const paramsSnapshot = d.paramsSnapshot as Array<{
      nodeId: string;
      templateKind: string;
      params: { kind: string; employer?: string };
    }> | null;
    const payrollParams = paramsSnapshot?.find(
      (n) => n.templateKind === "PAYROLL" && n.params.kind === "payroll_trigger",
    );
    const employerAddress = payrollParams?.params?.employer;
    if (!employerAddress) {
      throw new AppError("VALIDATION", "Employer address not available");
    }

    const { xdr } = await preparePayrollUnsubscribeInvocation({
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
