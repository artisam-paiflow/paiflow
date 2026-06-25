import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  readPayrollEmployer,
  readPayrollAsset,
  readTokenAllowance,
  readSubscriptionSubscriber,
  readSubscriptionAsset,
} from "@/lib/stellar/relayer";
import { prepareTokenApproveInvocation } from "@/lib/stellar/invoke";
import { assetContractId } from "@/lib/stellar/assets";
import { stellarPassphrase } from "@/lib/env";
import type { Asset } from "@/lib/flows/schema";

const MAX_I128 = 170141183460469231731687303715884105727n;

type PipelineNode = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

const PAYROLL_KINDS = new Set(["PAYROLL", "SUBSCRIPTION_DEV"]);

function findPayrollNode(pipeline: PipelineNode[] | null): PipelineNode | null {
  return pipeline?.find((n) => PAYROLL_KINDS.has(n.templateKind)) ?? null;
}

function parseBodyAmount(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as Record<string, unknown>).amount;
  if (typeof raw !== "string") return null;
  if (!/^\d+$/.test(raw)) return null;
  return raw;
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
    const isDev = payrollNode.templateKind === "SUBSCRIPTION_DEV";

    const graph = d.graphSnapshot as {
      nodes: Array<{ type: string; config?: { asset?: Asset } }>;
    } | null;
    const payrollTrigger = graph?.nodes.find((n) => n.type === "payroll");
    const configuredAsset: Asset = (payrollTrigger?.config?.asset as Asset) ?? {
      kind: "known",
      symbol: "USDC",
    };

    const [owner, asset] = isDev
      ? await Promise.all([
          readSubscriptionSubscriber(payrollNode.contractAddress),
          readSubscriptionAsset(payrollNode.contractAddress),
        ])
      : await Promise.all([
          readPayrollEmployer(payrollNode.contractAddress),
          readPayrollAsset(payrollNode.contractAddress),
        ]);

    // Sanity check: the on-chain asset should match the configured asset.
    if (asset !== assetContractId(configuredAsset)) {
      throw new AppError("VALIDATION", "Payroll asset mismatch");
    }

    const allowance = await readTokenAllowance({
      tokenContractAddress: asset,
      owner,
      spender: payrollNode.contractAddress,
    });

    return NextResponse.json({
      data: {
        contractAddress: payrollNode.contractAddress,
        employer: owner,
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

    const pipeline = d.pipelineSnapshot as PipelineNode[] | null;
    const payrollNode = findPayrollNode(pipeline);
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }
    const isDev = payrollNode.templateKind === "SUBSCRIPTION_DEV";

    const [owner, asset] = isDev
      ? await Promise.all([
          readSubscriptionSubscriber(payrollNode.contractAddress),
          readSubscriptionAsset(payrollNode.contractAddress),
        ])
      : await Promise.all([
          readPayrollEmployer(payrollNode.contractAddress),
          readPayrollAsset(payrollNode.contractAddress),
        ]);

    const paramsSnapshot = d.paramsSnapshot as Array<{
      nodeId: string;
      templateKind: string;
      params: { kind: string; amountPerPeriodStroops?: string };
    }> | null;
    const expectedKind = isDev ? "subscription_dev_trigger" : "payroll_trigger";
    const expectedTemplate = isDev ? "SUBSCRIPTION_DEV" : "PAYROLL";
    const payrollParams = paramsSnapshot?.find(
      (n) => n.templateKind === expectedTemplate && n.params.kind === expectedKind,
    );
    const configuredAmount = payrollParams?.params?.amountPerPeriodStroops ?? "0";
    const requestedAmount = parseBodyAmount(await req.json()) ?? configuredAmount;

    const currentAllowance = await readTokenAllowance({
      tokenContractAddress: asset,
      owner,
      spender: payrollNode.contractAddress,
    });

    const requested = BigInt(requestedAmount);
    if (currentAllowance + requested > MAX_I128) {
      throw new AppError("VALIDATION", "Cumulative allowance would exceed the maximum i128 value");
    }
    const newAllowance = (currentAllowance + requested).toString();

    const { xdr } = await prepareTokenApproveInvocation({
      tokenContractAddress: asset,
      from: owner,
      spender: payrollNode.contractAddress,
      amount: newAllowance,
    });

    return NextResponse.json({
      data: {
        unsignedXdr: xdr,
        employer: owner,
        asset,
        amount: requestedAmount,
        totalAllowance: newAllowance,
        networkPassphrase: stellarPassphrase(),
      },
    });
  });
}
