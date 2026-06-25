import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  readPayrollRecipients,
  readSplitterDevRecipients,
  readSubscriptionAmountPerPeriod,
} from "@/lib/stellar/relayer";

type PipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

function computeDevAmount(
  r: { address: string; bps: number; amount: string },
  totalStroops: bigint,
): { address: string; amount: string } {
  const fixed = BigInt(r.amount);
  if (fixed > 0n) {
    return { address: r.address, amount: fixed.toString() };
  }
  if (r.bps > 0) {
    return { address: r.address, amount: ((totalStroops * BigInt(r.bps)) / 10000n).toString() };
  }
  return { address: r.address, amount: "0" };
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
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    const splitterNode = pipeline?.find((n) => n.templateKind === "SPLITTER_DEV");
    const subscriptionDevNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION_DEV");

    if (payrollNode?.contractAddress) {
      const recipients = await readPayrollRecipients(payrollNode.contractAddress);
      return NextResponse.json({
        data: {
          recipients,
          contractAddress: payrollNode.contractAddress,
        },
      });
    }

    if (!splitterNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll recipient contract address not available");
    }

    const raw = await readSplitterDevRecipients(splitterNode.contractAddress);
    let totalStroops = 0n;
    if (subscriptionDevNode?.contractAddress) {
      totalStroops = await readSubscriptionAmountPerPeriod(subscriptionDevNode.contractAddress);
    }
    const recipients = raw.map((r) => computeDevAmount(r, totalStroops));

    return NextResponse.json({
      data: {
        recipients,
        contractAddress: splitterNode.contractAddress,
      },
    });
  });
}
