import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, errorResponse } from "@/lib/errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getWorkflowBalances } from "@/lib/stellar/balances";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession().catch(() => null);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = clientIp(req);
    const limit = await rateLimit(`balances:${ip}`, 60, 60);
    if (!limit.ok) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const { id } = await ctx.params;
    const deployment = await db.deployment.findFirst({
      where: { id, ownerId: user.id },
      include: {
        flow: { select: { templateKind: true } },
      },
    });
    if (!deployment) {
      throw new AppError("NOT_FOUND", "Deployment not found");
    }

    if (deployment.status !== "CONFIRMED" || !deployment.contractAddress) {
      return NextResponse.json({ totals: [], nodes: [] });
    }

    const { totals, nodes } = await getWorkflowBalances(deployment);

    return NextResponse.json({ totals, nodes });
  } catch (err) {
    return errorResponse(err);
  }
}
