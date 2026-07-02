import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findPipelineNode, type PipelineSnapshotNode } from "@/lib/flows/pipeline-snapshot";
import {
  updateRecipientsByRelayer,
  submitUpdateRecipientsByRelayer,
} from "@/lib/stellar/dev-mutate";
import { prepareDevCashOutRecipients } from "@/lib/stellar/cash-out";
import { syncEmployees } from "@/lib/employees";
import { assetContractId } from "@/lib/stellar/assets";
import { offRampTreasuryAddress } from "@/lib/env";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { TemplateKind } from "@prisma/client";

const RecipientSchema = z
  .object({
    address: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address"),
    label: z.string().max(64).optional(),
    mode: z.enum(["percentage", "fixed"]),
    bps: z.number().int().min(1).max(10_000).optional(),
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string").optional(),
    payoutMode: z.enum(["crypto", "fiat"]).default("crypto"),
    bankDetail: z
      .object({
        accountName: z.string(),
        accountNumber: z.string(),
        bankCode: z.string(),
      })
      .optional(),
  })
  .refine((r) => (r.mode === "percentage" ? r.bps !== undefined : !!r.amountStroops), {
    message: "percentage recipients need bps; fixed recipients need amountStroops",
  })
  .refine(
    (r) => {
      if (r.payoutMode !== "fiat") return true;
      return (
        !!r.bankDetail?.accountName && !!r.bankDetail?.accountNumber && !!r.bankDetail?.bankCode
      );
    },
    { message: "fiat recipients require bankDetail (accountName, accountNumber, bankCode)" },
  )
  .refine((r) => !(r.payoutMode === "fiat" && r.mode === "percentage"), {
    message: "fiat cash-out recipients must use fixed mode",
  });

const BodySchema = z.object({
  nodeId: z.string().optional(),
  recipients: z.array(RecipientSchema).min(1).max(20),
});

/**
 * Fill / change the recipients of a deployed SPLITTER_DEV node. Relayer-signed.
 * The contract enforces the same invariants as the immutable splitter (no mixed
 * mode; percentage bps must sum to 10000).
 *
 * Crypto recipients are updated synchronously. Fiat recipients deploy or reuse a
 * CASH_OUT_DEV sink per recipient; the sink deploy/update-bank calls are awaited,
 * but the splitter update_recipients call is submitted and returned pending.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const rlKey = user ? `dev-mutate:${user.id}` : `dev-mutate:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev mutations");
    const body = BodySchema.parse(await req.json());

    const d = await db.deployment.findFirst({ where: user ? { id, ownerId: user.id } : { id } });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");

    const node = findPipelineNode(d.pipelineSnapshot, "SPLITTER_DEV", body.nodeId);
    const hasFiat = body.recipients.some((r) => r.payoutMode === "fiat");

    if (!hasFiat) {
      const recipients = body.recipients.map((r) => ({
        address: r.address,
        bps: r.mode === "percentage" ? (r.bps ?? 0) : 0,
        amount: r.mode === "fixed" ? (r.amountStroops ?? "0") : "0",
        isCashOut: false,
      }));

      const result = await updateRecipientsByRelayer(node.contractAddress, recipients);
      if (result.status !== "SUCCESS") {
        throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_recipients failed");
      }

      await audit({
        action: "DEV_UPDATE_RECIPIENTS",
        userId: user?.id ?? null,
        metadata: { deploymentId: d.id, nodeId: node.nodeId, txHash: result.txHash },
      });

      return NextResponse.json({
        data: {
          txHash: result.txHash,
          txHashes: [result.txHash],
          contractAddress: node.contractAddress,
          cashOutContracts: {},
        },
      });
    }

    const graph = (d.graphSnapshot ?? null) as FlowGraph | null;
    const pipeline = ((d.pipelineSnapshot ?? []) as PipelineSnapshotNode[]).slice();
    const splitNode = graph?.nodes.find((n) => n.type === "split");
    if (!splitNode?.config.asset) {
      throw new AppError("VALIDATION", "Payroll asset not found in graph snapshot");
    }
    const assetContract = assetContractId(splitNode.config.asset);
    const treasury = offRampTreasuryAddress() ?? node.contractAddress;
    const adminAddress = d.sourceAccount ?? node.contractAddress;

    const existingEmployees = await db.employee.findMany({
      where: { deploymentId: d.id },
      select: { address: true, cashOutContractAddress: true },
    });

    const { onChainRecipients, txHashes, cashOutByInputAddress } =
      await prepareDevCashOutRecipients({
        splitterContractAddress: node.contractAddress,
        adminAddress,
        assetContractAddress: assetContract,
        treasury,
        existingEmployees,
        inputRecipients: body.recipients.map((r) => ({
          address: r.address,
          amount: r.mode === "fixed" ? (r.amountStroops ?? "0") : "0",
          bps: r.mode === "percentage" ? (r.bps ?? 0) : 0,
          payoutMode: r.payoutMode,
          bankDetail: r.bankDetail,
        })),
      });

    const splitterResult = await submitUpdateRecipientsByRelayer(
      node.contractAddress,
      onChainRecipients,
    );
    txHashes.push(splitterResult.txHash);

    await syncEmployees(
      d.id,
      body.recipients.map((r) => ({
        address: r.address,
        amountStroops: r.mode === "fixed" ? (r.amountStroops ?? "0") : "0",
        label: r.label,
        payoutMode: r.payoutMode,
        bankDetail: r.bankDetail,
      })),
      cashOutByInputAddress,
    );

    // Persist any CASH_OUT_DEV sinks into the deployment snapshot so later
    // dev-cash-out mutations can find them by nodeId.
    if (graph) {
      for (const [address, contractAddress] of cashOutByInputAddress) {
        const nodeId = `cash-out-${address}`;
        const recipient = body.recipients.find((r) => r.address === address);
        if (!graph.nodes.some((n) => n.id === nodeId && n.type === "cash_out")) {
          graph.nodes.push({
            id: nodeId,
            type: "cash_out",
            config: {
              asset: splitNode.config.asset,
              accountName: recipient?.bankDetail?.accountName ?? "",
              accountNumber: recipient?.bankDetail?.accountNumber ?? "",
              bankCode: recipient?.bankDetail?.bankCode ?? "",
            },
          } as Extract<FlowNode, { type: "cash_out" }>);
        }
        if (
          !pipeline.some((p) => p.nodeId === nodeId && p.templateKind === TemplateKind.CASH_OUT_DEV)
        ) {
          pipeline.push({
            nodeId,
            templateKind: TemplateKind.CASH_OUT_DEV,
            contractAddress,
          });
        }
      }

      await db.deployment.update({
        where: { id: d.id },
        data: {
          graphSnapshot: graph as object,
          pipelineSnapshot: pipeline as object,
        },
      });
    }

    await audit({
      action: "DEV_UPDATE_RECIPIENTS",
      userId: user?.id ?? null,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, txHashes },
    });

    const cashOutContracts = Object.fromEntries(cashOutByInputAddress.entries());
    return NextResponse.json({
      data: {
        txHash: splitterResult.txHash,
        txHashes,
        contractAddress: node.contractAddress,
        cashOutContracts,
      },
    });
  });
}
