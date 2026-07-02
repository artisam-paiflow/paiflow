import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { preparePayrollUpdateRecipientsInvocation } from "@/lib/stellar/invoke";
import {
  submitUpdateRecipientsByRelayer,
  submitSetSubscriptionAmountByRelayer,
} from "@/lib/stellar/dev-mutate";
import { prepareDevCashOutRecipients } from "@/lib/stellar/cash-out";
import { syncEmployees } from "@/lib/employees";
import { stellarPassphrase, offRampTreasuryAddress } from "@/lib/env";
import { assetContractId } from "@/lib/stellar/assets";
import type { FlowGraph } from "@/lib/flows/schema";

const RecipientSchema = z.object({
  address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
  amount: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
  label: z.string().optional(),
  payoutMode: z.enum(["crypto", "fiat"]).default("crypto"),
  bankDetail: z
    .object({
      accountName: z.string(),
      accountNumber: z.string(),
      bankCode: z.string(),
    })
    .optional(),
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
    const splitterNode = pipeline?.find((n) => n.templateKind === "SPLITTER");

    // Immutable non-dev payrolls bake recipients into the on-chain SPLITTER at
    // deploy time and cannot be changed afterwards.
    if (splitterNode?.contractAddress && !payrollNode && !splitterDevNode) {
      throw new AppError(
        "VALIDATION",
        "This payroll is immutable. Recipients cannot be updated after deploy.",
      );
    }

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
        recipients: body.recipients.map((r) => ({ address: r.address, amount: r.amount })),
      });

      await syncEmployees(
        d.id,
        body.recipients.map((r) => ({
          address: r.address,
          amountStroops: r.amount,
          label: r.label,
          payoutMode: r.payoutMode,
          bankDetail: r.bankDetail,
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

    if (!splitterDevNode?.contractAddress) {
      throw new AppError("VALIDATION", "Payroll contract address not available");
    }

    // Dev-mode payroll: the splitter contract is updated by the relayer, and
    // the subscription amount is kept in sync with the sum of fixed salaries.
    // These submissions return immediately with pending txHashes; the UI polls
    // for finality so the HTTP request doesn't block on network finality.
    const graph = (d.graphSnapshot ?? null) as FlowGraph | null;
    const asset = graph?.nodes.find((n) => n.type === "payroll")?.config.asset;
    if (!asset) {
      throw new AppError("VALIDATION", "Payroll asset not found in graph snapshot");
    }
    const assetContract = assetContractId(asset);
    const treasury = offRampTreasuryAddress() ?? splitterDevNode.contractAddress;

    const existingEmployees = await db.employee.findMany({
      where: { deploymentId: d.id },
      select: { address: true, cashOutContractAddress: true },
    });

    const { onChainRecipients, txHashes, cashOutByInputAddress } =
      await prepareDevCashOutRecipients({
        splitterContractAddress: splitterDevNode.contractAddress,
        adminAddress: d.sourceAccount ?? splitterDevNode.contractAddress,
        assetContractAddress: assetContract,
        treasury,
        existingEmployees,
        inputRecipients: body.recipients.map((r) => ({
          address: r.address,
          amount: r.amount,
          bps: 0,
          payoutMode: r.payoutMode,
          bankDetail: r.bankDetail,
        })),
      });

    const recipientsResult = await submitUpdateRecipientsByRelayer(
      splitterDevNode.contractAddress,
      onChainRecipients,
    );
    txHashes.push(recipientsResult.txHash);

    if (subscriptionDevNode?.contractAddress) {
      const totalStroops = body.recipients
        .reduce((sum, r) => sum + BigInt(r.amount), 0n)
        .toString();
      const amountResult = await submitSetSubscriptionAmountByRelayer(
        subscriptionDevNode.contractAddress,
        totalStroops,
      );
      txHashes.push(amountResult.txHash);
    }

    await syncEmployees(
      d.id,
      body.recipients.map((r) => ({
        address: r.address,
        amountStroops: r.amount,
        label: r.label,
        payoutMode: r.payoutMode,
        bankDetail: r.bankDetail,
      })),
      cashOutByInputAddress,
    );

    return NextResponse.json({
      data: {
        txHashes,
        contractAddress: splitterDevNode.contractAddress,
      },
    });
  });
}
