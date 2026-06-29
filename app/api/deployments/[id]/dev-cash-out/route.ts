import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { findPipelineNode } from "@/lib/flows/pipeline-snapshot";
import { updateBankByRelayer } from "@/lib/stellar/dev-mutate";
import type { FlowGraph } from "@/lib/flows/schema";

const VALID_BANK_CODES = ["BASECPH", "BACTBPH"];

const BodySchema = z.object({
  nodeId: z.string().optional(),
  accountName: z.string().min(1).max(120),
  accountNumber: z.string().min(1).max(40),
  bankCode: z.string().refine((s) => VALID_BANK_CODES.includes(s), {
    message: `bankCode must be one of ${VALID_BANK_CODES.join(", ")}`,
  }),
});

/**
 * Fill / change the destination bank details of a deployed CASH_OUT_DEV node.
 * The relayer signs the on-chain `update_bank` call, and we persist the bank
 * details into the deployment's saved graph snapshot so the event indexer can
 * snapshot them when it creates the OffRampPayoutJob.
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

    const node = findPipelineNode(d.pipelineSnapshot, "CASH_OUT_DEV", body.nodeId);

    const result = await updateBankByRelayer(node.contractAddress, {
      accountName: body.accountName,
      accountNumber: body.accountNumber,
      bankCode: body.bankCode,
    });
    if (result.status !== "SUCCESS") {
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "update_bank failed");
    }

    // Persist bank details into the saved graph snapshot so the event indexer
    // can read them without re-querying the chain.
    const graph = (d.graphSnapshot ?? null) as FlowGraph | null;
    if (graph) {
      const updatedNodes = graph.nodes.map((n) =>
        n.type === "cash_out" && n.id === node.nodeId
          ? {
              ...n,
              config: {
                ...n.config,
                accountName: body.accountName,
                accountNumber: body.accountNumber,
                bankCode: body.bankCode,
              },
            }
          : n,
      );
      await db.deployment.update({
        where: { id: d.id },
        data: { graphSnapshot: { ...graph, nodes: updatedNodes } },
      });
    }

    await audit({
      action: "DEV_UPDATE_BANK",
      userId: user?.id ?? null,
      metadata: { deploymentId: d.id, nodeId: node.nodeId, txHash: result.txHash },
    });

    return NextResponse.json({
      data: { txHash: result.txHash, contractAddress: node.contractAddress },
    });
  });
}
