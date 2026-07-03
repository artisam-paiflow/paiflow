import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const d = await db.deployment.findFirst({ where: { id, ownerId: user.id } });
    if (!d || !d.contractAddress) throw new AppError("NOT_FOUND", "Deployment not ready");
    const graph = FlowGraphSchema.parse(d.graphSnapshot);
    const trigger = graph.nodes.find(isTrigger);
    const asset =
      trigger && "asset" in trigger.config ? trigger.config.asset : ({ kind: "native" } as const);
    const uri = sep7PaymentUri({
      destination: d.contractAddress,
      asset,
      message: "Paiflow deployment",
    });
    return NextResponse.json({ data: { uri } });
  });
}
