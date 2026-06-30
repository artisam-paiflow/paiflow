import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  readPayrollRecipients,
  readSplitterDevRecipients,
  readSplitterRecipients,
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
    const splitterNode = pipeline?.find(
      (n) => n.templateKind === "SPLITTER_DEV" || n.templateKind === "SPLITTER",
    );
    const subscriptionNode = pipeline?.find(
      (n) => n.templateKind === "SUBSCRIPTION_DEV" || n.templateKind === "SUBSCRIPTION",
    );

    if (payrollNode?.contractAddress) {
      const rawRecipients = await readPayrollRecipients(payrollNode.contractAddress);
      const employees = await db.employee.findMany({
        where: { deploymentId: id },
      });
      const byWallet = new Map(employees.map((e) => [e.address, e]));
      const recipients = rawRecipients.map((r) => {
        const employee = byWallet.get(r.address);
        const payoutMode: "crypto" | "fiat" = employee?.payoutMode === "FIAT" ? "fiat" : "crypto";
        return {
          address: r.address,
          amount: r.amount,
          payoutMode,
          label: employee?.label ?? undefined,
        };
      });
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

    const isDev = splitterNode.templateKind === "SPLITTER_DEV";
    const raw = isDev
      ? await readSplitterDevRecipients(splitterNode.contractAddress)
      : await readSplitterRecipients(splitterNode.contractAddress);
    let totalStroops = 0n;
    if (subscriptionNode?.contractAddress) {
      totalStroops = await readSubscriptionAmountPerPeriod(subscriptionNode.contractAddress);
    }
    const chainRecipients = raw.map((r) => computeDevAmount(r, totalStroops));

    const employees = await db.employee.findMany({
      where: { deploymentId: id },
    });
    const byWallet = new Map(employees.map((e) => [e.address, e]));
    const byCashOut = new Map(
      employees.filter((e) => e.cashOutContractAddress).map((e) => [e.cashOutContractAddress!, e]),
    );

    const recipients = chainRecipients.map((r) => {
      const fiatEmployee = byCashOut.get(r.address);
      if (fiatEmployee) {
        return {
          address: fiatEmployee.address,
          amount: r.amount,
          payoutMode: "fiat" as const,
          label: fiatEmployee.label ?? undefined,
        };
      }
      const cryptoEmployee = byWallet.get(r.address);
      const payoutMode: "crypto" | "fiat" =
        cryptoEmployee?.payoutMode === "FIAT" ? "fiat" : "crypto";
      return {
        address: r.address,
        amount: r.amount,
        payoutMode,
        label: cryptoEmployee?.label ?? undefined,
      };
    });

    return NextResponse.json({
      data: {
        recipients,
        contractAddress: splitterNode.contractAddress,
      },
    });
  });
}
