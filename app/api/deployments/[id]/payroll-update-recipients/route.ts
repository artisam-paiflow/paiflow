import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { preparePayrollUpdateRecipientsInvocation } from "@/lib/stellar/invoke";
import {
  updateRecipientsByRelayer,
  setSubscriptionAmountByRelayer,
} from "@/lib/stellar/dev-mutate";
import { stellarPassphrase } from "@/lib/env";

const RecipientSchema = z.object({
  address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  amount: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
  label: z.string().optional(),
});

const PostSchema = z.object({
  recipients: z.array(RecipientSchema).min(1).max(20),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const body = PostSchema.parse(await req.json());

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
    const splitterDevNode = pipeline?.find((n) => n.templateKind === "SPLITTER_DEV");
    const subscriptionDevNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION_DEV");

    // Sync employee records to match the new recipient list, regardless of on-chain path.
    const newAddresses = new Set(body.recipients.map((r) => r.address));
    await db.employee.deleteMany({
      where: { deploymentId: d.id, address: { notIn: [...newAddresses] } },
    });
    for (const r of body.recipients) {
      await db.employee.upsert({
        where: { deploymentId_address: { deploymentId: d.id, address: r.address } },
        create: {
          deploymentId: d.id,
          address: r.address,
          amountStroops: r.amount,
          label: r.label,
        },
        update: {
          amountStroops: r.amount,
          label: r.label,
        },
      });
    }

    if (payrollNode?.contractAddress) {
      if (!d.sourceAccount) {
        throw new AppError("VALIDATION", "Deployment source account is not available");
      }

      const { xdr } = await preparePayrollUpdateRecipientsInvocation({
        contractAddress: payrollNode.contractAddress,
        adminAddress: d.sourceAccount,
        recipients: body.recipients.map((r) => ({ address: r.address, amount: r.amount })),
      });

      return NextResponse.json({
        data: {
          unsignedXdr: xdr,
          contractAddress: payrollNode.contractAddress,
          networkPassphrase: stellarPassphrase(),
        },
      });
    }

    if (!splitterDevNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    // Dev-mode payroll: the splitter contract is updated by the relayer, and
    // the subscription amount is kept in sync with the sum of fixed salaries.
    const result = await updateRecipientsByRelayer(
      splitterDevNode.contractAddress,
      body.recipients.map((r) => ({ address: r.address, amount: r.amount, bps: 0 })),
    );
    if (result.status !== "SUCCESS") {
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_recipients failed");
    }

    if (subscriptionDevNode?.contractAddress) {
      const totalStroops = body.recipients
        .reduce((sum, r) => sum + BigInt(r.amount), 0n)
        .toString();
      const amountResult = await setSubscriptionAmountByRelayer(
        subscriptionDevNode.contractAddress,
        totalStroops,
      );
      if (amountResult.status !== "SUCCESS") {
        throw new AppError("UPSTREAM_RPC", amountResult.errorMessage ?? "set_amount failed");
      }
    }

    return NextResponse.json({
      data: {
        txHash: result.txHash,
        contractAddress: splitterDevNode.contractAddress,
      },
    });
  });
}
