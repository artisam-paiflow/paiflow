import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import type { PipelineSnapshotNode } from "@/lib/flows/pipeline-snapshot";
import { readDevIsConfigured } from "@/lib/stellar/dev-mutate";

const DEV_KINDS = new Set(["PAYER_DEV", "SPLITTER_DEV", "SUBSCRIPTION_DEV"]);

/**
 * List the dev (`_DEV`) nodes of a deployment and their on-chain
 * configured/blank status, so an API consumer knows what still needs filling.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(_req);
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({ where: user ? { id, ownerId: user.id } : { id } });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found");

    const snapshot = (d.pipelineSnapshot as PipelineSnapshotNode[] | null) ?? [];
    const devNodes = snapshot.filter((n) => DEV_KINDS.has(n.templateKind) && n.contractAddress);

    const nodes = await Promise.all(
      devNodes.map(async (n) => {
        let configured: boolean | null = null;
        try {
          configured = await readDevIsConfigured(n.contractAddress);
        } catch {
          configured = null; // read failed (e.g. contract not yet finalized)
        }
        return {
          nodeId: n.nodeId,
          templateKind: n.templateKind,
          contractAddress: n.contractAddress,
          configured,
        };
      }),
    );

    return NextResponse.json({ data: { deploymentId: d.id, devMode: nodes.length > 0, nodes } });
  });
}
