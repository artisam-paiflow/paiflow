import { NextRequest, NextResponse } from "next/server";
import { DevSplitterSchema, type DevSplitRecipient } from "@/lib/dev/schema";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { invalidateDashboardBalances } from "@/lib/stellar/dashboard-balance-cache";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { requireFeature, refuseNewFiatRecipients } from "@/lib/features";
import { findPipelineNode, type PipelineSnapshotNode } from "@/lib/pipeline-snapshot";
import {
  updateRecipientsByRelayer,
  submitUpdateRecipientsByRelayer,
} from "@/lib/stellar/dev-mutate";
import { graphNodeAsset, trustlineWarnings } from "@/lib/stellar/trustline-warnings";
import { prepareDevCashOutRecipients } from "@/lib/stellar/cash-out";
import { syncEmployees, deriveFiatPlaceholderAddress } from "@/lib/employees";
import { assetContractId } from "@/lib/stellar/assets";
import { offRampTreasuryAddress } from "@/lib/env";
import type { FlowGraph, FlowNode } from "@/lib/flows/schema";
import { TemplateKind } from "@prisma/client";

type Recipient = DevSplitRecipient;
type NormalizedRecipient = Omit<Recipient, "address"> & { address: string };

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
    requireFeature("devMode");
    const { id } = await ctx.params;
    const rlKey = `dev-mutate:${user.id}`;
    const rl = await rateLimit(rlKey, 30, 60);
    if (!rl.ok) throw rateLimitedError(rl, "Too many dev mutations");
    const body = DevSplitterSchema.parse(await req.json());
    const d = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
    // A new fiat recipient deploys a CASH_OUT_DEV sink and queues off-ramp
    // jobs: new off-ramp use, refused while it is switched off (#722). Crypto
    // recipients and fiat ones already on this deployment keep updating.
    await refuseNewFiatRecipients(d.id, body.recipients);

    const node = findPipelineNode(d.pipelineSnapshot, "SPLITTER_DEV", body.nodeId);

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

    // Advisory (#723): every crypto recipient, started before the write, never
    // rejects, never blocks it. Fiat recipients are paid via a cash-out sink.
    const payoutAsset = graphNodeAsset(d.graphSnapshot, node.nodeId, "split");
    const warningsPromise = payoutAsset
      ? trustlineWarnings(
          normalizedRecipients
            .filter((r) => r.payoutMode !== "fiat")
            .map((r) => ({
              nodeId: node.nodeId,
              address: r.address,
              ...(r.label ? { label: r.label } : {}),
              asset: payoutAsset,
            })),
        )
      : Promise.resolve([]);

    const hasFiat = normalizedRecipients.some((r) => r.payoutMode === "fiat");

    if (!hasFiat) {
      const recipients = normalizedRecipients.map((r) => ({
        address: r.address,
        bps: r.mode === "percentage" ? (r.bps ?? 0) : 0,
        amount: r.mode === "fixed" ? (r.amountStroops ?? "0") : "0",
        isCashOut: false,
      }));

      const result = await updateRecipientsByRelayer(node.contractAddress, recipients);
      if (result.status !== "SUCCESS") {
        throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_recipients failed");
      }

      invalidateDashboardBalances(d.id, result.txHash);
      await audit({
        action: "DEV_UPDATE_RECIPIENTS",
        userId: user.id,
        metadata: { deploymentId: d.id, nodeId: node.nodeId, txHash: result.txHash },
      });

      return NextResponse.json({
        data: {
          txHash: result.txHash,
          txHashes: [result.txHash],
          contractAddress: node.contractAddress,
          cashOutContracts: {},
          warnings: await warningsPromise,
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
        inputRecipients: normalizedRecipients.map((r) => ({
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
    invalidateDashboardBalances(d.id, splitterResult.txHash);

    await syncEmployees(
      d.id,
      normalizedRecipients.map((r) => ({
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
        const recipient = normalizedRecipients.find((r) => r.address === address);
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
      userId: user.id,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, txHashes },
    });

    const cashOutContracts = Object.fromEntries(cashOutByInputAddress.entries());
    return NextResponse.json({
      data: {
        txHash: splitterResult.txHash,
        txHashes,
        contractAddress: node.contractAddress,
        cashOutContracts,
        warnings: await warningsPromise,
      },
    });
  });
}
