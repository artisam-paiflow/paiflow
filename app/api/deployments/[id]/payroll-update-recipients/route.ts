import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { db } from "@/lib/db";
import { requirePayrollSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { preparePayrollUpdateRecipientsInvocation } from "@/lib/stellar/invoke";
import { syncEmployees } from "@/lib/employees";
import { stellarPassphrase } from "@/lib/env";
import { assetContractId } from "@/lib/stellar/assets";
import type { FlowGraph } from "@/lib/flows/schema";
const RecipientSchema = z
  .object({
    address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
    amount: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
    label: z.string().optional(),
    payoutMode: z.literal("crypto").optional(),
  })
  .strict();
const PostSchema = z.object({
  recipients: z.array(RecipientSchema).min(1).max(20),
});
type Recipient = z.infer<typeof RecipientSchema>;
type NormalizedRecipient = Omit<Recipient, "address"> & {
  address: string;
};
async function POSTHandler(
  req: NextRequest,
  ctx: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  return withErrorHandler(async () => {
    const { user } = await requirePayrollSession(req);
    await enforceWriteRateLimit("payrollWrite", user.id);
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
    const normalizedRecipients = body.recipients;
    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    // Execute the on-chain mutation first. Only after it succeeds do we mirror
    // the change into the Employee table. This prevents DB/chain divergence if
    // the on-chain call fails.
    if (payrollNode?.contractAddress) {
      if (!d.sourceAccount) {
        throw new AppError("VALIDATION", "Deployment source account is not available");
      }
      const { xdr } = await preparePayrollUpdateRecipientsInvocation({
        contractAddress: payrollNode.contractAddress,
        adminAddress: d.sourceAccount,
        recipients: normalizedRecipients.map((r) => ({ address: r.address, amount: r.amount })),
      });
      await syncEmployees(
        d.id,
        normalizedRecipients.map((r) => ({
          address: r.address,
          amountStroops: r.amount,
          label: r.label,
        })),
      );
      return NextResponse.json({
        data: {
          unsignedXdr: xdr,
          contractAddress: payrollNode.contractAddress,
          networkPassphrase: stellarPassphrase(),
        },
      });
    }
    throw new AppError(
      "VALIDATION",
      "This payroll is immutable. Recipients cannot be updated after deploy.",
    );
  });
}
export const POST = deploymentServiceRoute(POSTHandler, "payroll");
