import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  readPayrollEmployer,
  readPayrollAsset,
  readPayrollRecipients,
  readTokenAllowance,
  readSubscriptionSubscriberNullable,
  readSubscriptionAsset,
  readSubscriptionAmountPerPeriod,
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

const PAYROLL_KINDS = new Set(["PAYROLL", "SUBSCRIPTION_DEV", "SUBSCRIPTION"]);

function findPayrollNode(pipeline: PipelineNode[] | null): PipelineNode | null {
  return pipeline?.find((n) => PAYROLL_KINDS.has(n.templateKind)) ?? null;
}

function isSubscriptionLike(templateKind: string): boolean {
  return templateKind === "SUBSCRIPTION" || templateKind === "SUBSCRIPTION_DEV";
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
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({
      where: user ? { id, ownerId: user.id } : { id },
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

    const graph = d.graphSnapshot as {
      nodes: Array<{ type: string; config?: { asset?: Asset } }>;
    } | null;
    const payrollTrigger = graph?.nodes.find((n) => n.type === "payroll");
    const configuredAsset: Asset = (payrollTrigger?.config?.asset as Asset) ?? {
      kind: "known",
      symbol: "USDC",
    };

    const [owner, asset, amountPerPeriod] = isSubscription
      ? await Promise.all([
          readSubscriptionSubscriberNullable(payrollNode.contractAddress),
          readSubscriptionAsset(payrollNode.contractAddress),
          readSubscriptionAmountPerPeriod(payrollNode.contractAddress),
        ])
      : await Promise.all([
          readPayrollEmployer(payrollNode.contractAddress),
          readPayrollAsset(payrollNode.contractAddress),
          readPayrollRecipients(payrollNode.contractAddress).then((recipients) =>
            recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n),
          ),
        ]);

    // Sanity check: the on-chain asset should match the configured asset.
    if (asset !== assetContractId(configuredAsset)) {
      throw new AppError("VALIDATION", "Payroll asset mismatch");
    }

    const allowance = owner
      ? await readTokenAllowance({
          tokenContractAddress: asset,
          owner,
          spender: payrollNode.contractAddress,
        })
      : 0n;

    return NextResponse.json({
      data: {
        contractAddress: payrollNode.contractAddress,
        employer: owner,
        asset: configuredAsset,
        allowance: allowance.toString(),
        amountPerPeriod: amountPerPeriod.toString(),
        // True when the granted allowance covers at least one full period's
        // payout. Lets the UI flag "top up your allowance" after a salary raise.
        allowanceCoversPeriod: amountPerPeriod > 0n && allowance >= amountPerPeriod,
        networkPassphrase: stellarPassphrase(),
        employerConfigured: owner !== null,
      },
    });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({
      where: user ? { id, ownerId: user.id } : { id },
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

    // Read the employer, asset and the live per-period amount straight from the
    // contract. The deploy-time params snapshot goes stale once salaries are
    // filled / changed via the API (dev payrolls deploy with a placeholder
    // amount), so the suggested allowance must come from on-chain state.
    let owner: string | null;
    let asset: string;
    let configuredAmount: string;
    if (isSubscription) {
      const [subscriber, devAsset, amountPerPeriod] = await Promise.all([
        readSubscriptionSubscriberNullable(payrollNode.contractAddress),
        readSubscriptionAsset(payrollNode.contractAddress),
        readSubscriptionAmountPerPeriod(payrollNode.contractAddress),
      ]);
      owner = subscriber;
      asset = devAsset;
      configuredAmount = amountPerPeriod.toString();
    } else {
      const [employer, payrollAsset, recipients] = await Promise.all([
        readPayrollEmployer(payrollNode.contractAddress),
        readPayrollAsset(payrollNode.contractAddress),
        readPayrollRecipients(payrollNode.contractAddress),
      ]);
      owner = employer;
      asset = payrollAsset;
      configuredAmount = recipients.reduce((sum, r) => sum + BigInt(r.amount), 0n).toString();
    }

    if (!owner) {
      throw new AppError(
        "VALIDATION",
        "Employer is not configured yet. Set the employer via the payroll API before granting allowance.",
      );
    }

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
