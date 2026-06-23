import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { readPayrollEmployer, readPayrollAsset, readTokenAllowance } from "@/lib/stellar/relayer";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { assetContractId } from "@/lib/stellar/assets";
import { stellarPassphrase } from "@/lib/env";
import type { Asset } from "@/lib/flows/schema";

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

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    const graph = d.graphSnapshot as {
      nodes: Array<{ type: string; config?: { asset?: Asset } }>;
    } | null;
    const payrollTrigger = graph?.nodes.find((n) => n.type === "payroll");
    const configuredAsset: Asset = (payrollTrigger?.config?.asset as Asset) ?? {
      kind: "known",
      symbol: "USDC",
    };

    const [employer, asset] = await Promise.all([
      readPayrollEmployer(payrollNode.contractAddress),
      readPayrollAsset(payrollNode.contractAddress),
    ]);

    // Sanity check: the on-chain asset should match the configured asset.
    if (asset !== assetContractId(configuredAsset)) {
      throw new AppError("VALIDATION", "Payroll asset mismatch");
    }

    const allowance = await readTokenAllowance({
      tokenContractAddress: asset,
      owner: employer,
      spender: payrollNode.contractAddress,
    });

    return NextResponse.json({
      data: {
        contractAddress: payrollNode.contractAddress,
        employer,
        asset: configuredAsset,
        allowance: allowance.toString(),
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
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

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    const [employer, asset] = await Promise.all([
      readPayrollEmployer(payrollNode.contractAddress),
      readPayrollAsset(payrollNode.contractAddress),
    ]);

    const paramsSnapshot = d.paramsSnapshot as Array<{
      nodeId: string;
      templateKind: string;
      params: { kind: string; amountPerPeriodStroops?: string };
    }> | null;
    const payrollParams = paramsSnapshot?.find(
      (n) => n.templateKind === "PAYROLL" && n.params.kind === "payroll_trigger",
    );
    const amount = payrollParams?.params?.amountPerPeriodStroops ?? "0";

    const { xdr } = await prepareTokenApproveInvocation({
      tokenContractAddress: asset,
      from: employer,
      spender: payrollNode.contractAddress,
      amount,
    });

    return NextResponse.json({
      data: {
        unsignedXdr: xdr,
        employer,
        asset,
        amount,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
