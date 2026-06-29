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
  deployCashOutDevByRelayer,
  updateBankByRelayer,
} from "@/lib/stellar/dev-mutate";
import { stellarPassphrase, offRampTreasuryAddress } from "@/lib/env";
import { assetContractId } from "@/lib/stellar/assets";
import { EmployeePayoutMode } from "@prisma/client";
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

      await syncEmployees(d.id, body.recipients);

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
    });
    const existingByAddress = new Map(existingEmployees.map((e) => [e.address, e]));

    const txHashes: string[] = [];
    const onChainRecipients: Array<{
      address: string;
      amount: string;
      bps: number;
      isCashOut: boolean;
    }> = [];

    // Deploy or reuse CASH_OUT_DEV contracts for fiat employees.
    for (const r of body.recipients) {
      if (r.payoutMode !== "fiat") {
        onChainRecipients.push({
          address: r.address,
          amount: r.amount,
          bps: 0,
          isCashOut: false,
        });
        continue;
      }

      const existing = existingByAddress.get(r.address);
      let cashOutAddress = existing?.cashOutContractAddress;

      if (!cashOutAddress) {
        const deploy = await deployCashOutDevByRelayer({
          adminAddress: d.sourceAccount ?? splitterDevNode.contractAddress,
          assetContractAddress: assetContract,
          treasury,
          parent: splitterDevNode.contractAddress,
          accountName: r.bankDetail?.accountName,
          accountNumber: r.bankDetail?.accountNumber,
          bankCode: r.bankDetail?.bankCode,
        });
        if (deploy.status !== "SUCCESS" || !deploy.contractAddress) {
          throw new AppError(
            "UPSTREAM_RPC",
            deploy.errorMessage ?? "Failed to deploy cash-out contract",
          );
        }
        txHashes.push(deploy.txHash);
        cashOutAddress = deploy.contractAddress;
      } else if (r.bankDetail) {
        const update = await updateBankByRelayer(cashOutAddress, {
          accountName: r.bankDetail.accountName,
          accountNumber: r.bankDetail.accountNumber,
          bankCode: r.bankDetail.bankCode,
        });
        if (update.status !== "SUCCESS") {
          throw new AppError(
            "UPSTREAM_RPC",
            update.errorMessage ?? "Failed to update cash-out bank details",
          );
        }
        txHashes.push(update.txHash);
      }

      onChainRecipients.push({
        address: cashOutAddress,
        amount: r.amount,
        bps: 0,
        isCashOut: true,
      });
    }

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

    await syncEmployees(d.id, body.recipients);

    return NextResponse.json({
      data: {
        txHashes,
        contractAddress: splitterDevNode.contractAddress,
      },
    });
  });
}

async function syncEmployees(
  deploymentId: string,
  recipients: Array<{
    address: string;
    amount: string;
    label?: string;
    payoutMode?: "crypto" | "fiat";
    bankDetail?: { accountName: string; accountNumber: string; bankCode: string };
  }>,
) {
  const newAddresses = new Set(recipients.map((r) => r.address));

  await db.$transaction(async (tx) => {
    await tx.employee.deleteMany({
      where: { deploymentId, address: { notIn: [...newAddresses] } },
    });

    for (const r of recipients) {
      const mode = r.payoutMode === "fiat" ? EmployeePayoutMode.FIAT : EmployeePayoutMode.CRYPTO;

      const employee = await tx.employee.upsert({
        where: { deploymentId_address: { deploymentId, address: r.address } },
        create: {
          deploymentId,
          address: r.address,
          amountStroops: r.amount,
          label: r.label,
          payoutMode: mode,
        },
        update: {
          amountStroops: r.amount,
          label: r.label,
          payoutMode: mode,
        },
      });

      if (r.bankDetail) {
        await tx.employeeBankDetail.upsert({
          where: { employeeId: employee.id },
          create: {
            employeeId: employee.id,
            accountName: r.bankDetail.accountName,
            accountNumber: r.bankDetail.accountNumber,
            bankCode: r.bankDetail.bankCode,
          },
          update: {
            accountName: r.bankDetail.accountName,
            accountNumber: r.bankDetail.accountNumber,
            bankCode: r.bankDetail.bankCode,
          },
        });
      }
    }
  });
}
