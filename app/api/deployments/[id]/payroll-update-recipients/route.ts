import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { preparePayrollUpdateRecipientsInvocation } from "@/lib/stellar/invoke";
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
    if (!payrollNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    if (!d.sourceAccount) {
      throw new AppError("VALIDATION", "Deployment source account is not available");
    }

    // Sync employee records to match the new recipient list.
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
  });
}
