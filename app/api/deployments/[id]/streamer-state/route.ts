import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { readStreamerAvailable, readStreamerPaused } from "@/lib/stellar/relayer";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");

    const pipeline = d.pipelineSnapshot as Array<{
      nodeId: string;
      contractAddress: string;
      templateKind: string;
    }> | null;

    const streamerNode = pipeline?.find((n) => n.templateKind === "STREAMER");
    if (!streamerNode?.contractAddress) {
      throw new AppError("VALIDATION", "No streamer contract found for deployment");
    }

    const [paused, available] = await Promise.all([
      readStreamerPaused(streamerNode.contractAddress),
      readStreamerAvailable(streamerNode.contractAddress),
    ]);

    return NextResponse.json({
      data: {
        paused,
        available: available.toString(),
      },
    });
  });
}
