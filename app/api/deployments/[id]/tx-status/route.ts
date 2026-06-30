import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sorobanRpc } from "@/lib/stellar/client";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { recordAllowanceEvent } from "@/lib/stellar/events";
import type { FlowGraph } from "@/lib/flows/schema";

const QuerySchema = z.object({
  txHash: z.string().min(1),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const ip = clientIp(req);
    await enforceRateLimit({ key: `tx-status:${id}:${ip}`, limit: 60, windowSeconds: 60 });

    const { searchParams } = new URL(req.url);
    const parsed = QuerySchema.safeParse({ txHash: searchParams.get("txHash") });
    if (!parsed.success) throw new AppError("VALIDATION", "Missing or invalid txHash");

    const { txHash } = parsed.data;
    const server = sorobanRpc();
    const got = await server.getTransaction(txHash);

    if (got.status === "SUCCESS") {
      await audit({
        action: "DEPLOY_TRIGGER_CONFIRMED",
        ip,
        metadata: { deploymentId: id, txHash },
      });

      const envelopeXdr = (got as any).envelopeXdr as string | undefined;
      if (envelopeXdr) {
        try {
          const deployment = await db.deployment.findUnique({
            where: { id },
            select: { graphSnapshot: true },
          });
          const graph = deployment?.graphSnapshot as FlowGraph | null;
          await recordAllowanceEvent({
            deploymentId: id,
            envelopeXdr,
            txHash,
            ledger: got.ledger,
            occurredAt: new Date((got as any).ledgerClosedAt ?? Date.now()),
            graph,
          });
        } catch {
          // Never fail the status check because of synthetic event bookkeeping.
        }
      }

      return NextResponse.json({ data: { status: "SUCCESS", txHash } });
    }

    if (got.status === "FAILED") {
      return NextResponse.json({
        data: { status: "FAILED", txHash, errorMessage: "Transaction failed on the network" },
      });
    }

    // NOT_FOUND or other intermediate states → still pending
    return NextResponse.json({ data: { status: "PENDING", txHash } });
  });
}
