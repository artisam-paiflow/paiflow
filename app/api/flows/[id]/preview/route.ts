import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { flowToEnglish } from "@/lib/flows/english";
import { readOrdinaryFlowGraph } from "@/lib/flows/ordinary-flow";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
    const graph = readOrdinaryFlowGraph(flow.graph);
    return NextResponse.json({ data: { english: flowToEnglish(graph) } });
  });
}
