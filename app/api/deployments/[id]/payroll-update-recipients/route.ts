import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { preparePayrollUpdateRecipientsInvocation } from "@/lib/stellar/invoke";
import {
  submitUpdateRecipientsByRelayer,
  submitSetSubscriptionAmountByRelayer,
  updatePaymentByRelayer,
} from "@/lib/stellar/dev-mutate";
import { prepareDevCashOutRecipients } from "@/lib/stellar/cash-out";
import { syncEmployees, deriveFiatPlaceholderAddress } from "@/lib/employees";
import { stellarPassphrase, offRampTreasuryAddress } from "@/lib/env";
import { assetContractId } from "@/lib/stellar/assets";
import type { FlowGraph } from "@/lib/flows/schema";

const RecipientSchema = z
  .object({
    address: z
      .string()
      .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address")
      .optional(),
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
  })
  .refine((r) => !(r.payoutMode === "crypto" && !r.address), {
    message: "crypto recipients require a valid Stellar address",
  })
  .refine(
    (r) => {
      if (r.payoutMode !== "fiat") return true;
      return (
        !!r.bankDetail?.accountName && !!r.bankDetail?.accountNumber && !!r.bankDetail?.bankCode
      );
    },
    { message: "fiat recipients require bankDetail (accountName, accountNumber, bankCode)" },
  );

const PostSchema = z.object({
  recipients: z.array(RecipientSchema).min(1).max(20),
});

type Recipient = z.infer<typeof RecipientSchema>;
type NormalizedRecipient = Omit<Recipient, "address"> & { address: string };

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const body = PostSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      // Machine callers authenticated via x-dev-api-secret are trusted to access
      // any deployment; this matches the trust model of payroll-runs and events.
      where: user ? { id, ownerId: user.id } : { id },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    if (d.flow.templateKind !== "PAYROLL") {
      throw new AppError("VALIDATION", "Deployment is not a payroll");
    }

    const normalizedRecipients = body.recipients.map((r) => {
      if (r.payoutMode === "fiat" && !r.address) {
        return {
          ...r,
          address: deriveFiatPlaceholderAddress({
            deploymentId: d.id,
            accountNumber: r.bankDetail!.accountNumber,
            bankCode: r.bankDetail!.bankCode,
          }),
        } as NormalizedRecipient;
      }
      return r as NormalizedRecipient;
    });

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;
    const payrollNode = pipeline?.find((n) => n.templateKind === "PAYROLL");
    const splitterDevNode = pipeline?.find((n) => n.templateKind === "SPLITTER_DEV");
    const subscriptionDevNode = pipeline?.find((n) => n.templateKind === "SUBSCRIPTION_DEV");
    const splitterNode = pipeline?.find((n) => n.templateKind === "SPLITTER");
    const payerNode = pipeline?.find((n) => n.templateKind === "PAYER");
    const payerDevNode = pipeline?.find((n) => n.templateKind === "PAYER_DEV");

    // Immutable non-dev payrolls bake recipients into the on-chain SPLITTER /
    // PAYER at deploy time and cannot be changed afterwards.
    if (
      (splitterNode?.contractAddress || payerNode?.contractAddress) &&
      !payrollNode &&
      !splitterDevNode
    ) {
      throw new AppError(
        "VALIDATION",
        "This payroll is immutable. Recipients cannot be updated after deploy.",
      );
    }

    // Dev-mode single-pay payroll: SUBSCRIPTION_DEV → PAYER_DEV. The first
    // recipient is the single employee; a fiat employee gets a generated
    // CASH_OUT_DEV contract just like fiat split recipients.
    if (!splitterDevNode?.contractAddress && payerDevNode?.contractAddress) {
      const r = normalizedRecipients[0]!;
      const graph = (d.graphSnapshot ?? null) as FlowGraph | null;
      const asset =
        graph?.nodes.find((n) => n.type === "payroll")?.config.asset ??
        graph?.nodes.find((n) => n.type === "subscription")?.config.asset;
      if (!asset) {
        throw new AppError("VALIDATION", "Payroll asset not found in graph snapshot");
      }
      const assetContract = assetContractId(asset);
      const treasury = offRampTreasuryAddress() ?? payerDevNode.contractAddress;

      const existingEmployees = await db.employee.findMany({
        where: { deploymentId: d.id },
        select: { address: true, cashOutContractAddress: true },
      });

      const { onChainRecipients, txHashes, cashOutByInputAddress } =
        await prepareDevCashOutRecipients({
          splitterContractAddress: payerDevNode.contractAddress,
          adminAddress: d.sourceAccount ?? payerDevNode.contractAddress,
          assetContractAddress: assetContract,
          treasury,
          existingEmployees,
          inputRecipients: [
            {
              address: r.address,
              amount: r.amount,
              bps: 0,
              payoutMode: r.payoutMode,
              bankDetail: r.bankDetail,
            },
          ],
        });

      const onChain = onChainRecipients[0];
      if (!onChain) {
        throw new AppError("VALIDATION", "No recipient provided for the pay node");
      }

      const payResult = await updatePaymentByRelayer(payerDevNode.contractAddress, {
        recipient: onChain.address,
        amountStroops: r.amount,
        percentageBps: 0,
        isCashOut: onChain.isCashOut,
      });
      if (payResult.status !== "SUCCESS") {
        throw new AppError("UPSTREAM_RPC", payResult.errorMessage ?? "update_payment failed");
      }
      txHashes.push(payResult.txHash);

      if (subscriptionDevNode?.contractAddress) {
        const amountResult = await submitSetSubscriptionAmountByRelayer(
          subscriptionDevNode.contractAddress,
          r.amount,
        );
        txHashes.push(amountResult.txHash);
      }

      await syncEmployees(
        d.id,
        [
          {
            address: r.address,
            amountStroops: r.amount,
            label: r.label,
            payoutMode: r.payoutMode,
            bankDetail: r.bankDetail,
          },
        ],
        cashOutByInputAddress,
      );

      return NextResponse.json({
        data: {
          txHashes,
          contractAddress: payerDevNode.contractAddress,
        },
      });
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
        recipients: normalizedRecipients.map((r) => ({ address: r.address, amount: r.amount })),
      });

      await syncEmployees(
        d.id,
        normalizedRecipients.map((r) => ({
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
    const asset =
      graph?.nodes.find((n) => n.type === "payroll")?.config.asset ??
      graph?.nodes.find((n) => n.type === "subscription")?.config.asset;
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
        inputRecipients: normalizedRecipients.map((r) => ({
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
      const totalStroops = normalizedRecipients
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
      normalizedRecipients.map((r) => ({
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
