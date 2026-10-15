import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { validateFlow } from "@/lib/flows/validate";
import { serverFeatures } from "@/lib/features";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("flowValidate", user.id);
    const { id } = await ctx.params;
    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
    const v = validateFlow(flow.graph, { features: serverFeatures(), ignoreOwnerEmail: true });
    // HTTP 200 means the validation ran successfully. An invalid graph is a
    // normal result (data.ok: false), not a malformed request; clients use the
    // returned errors to explain what needs fixing before deployment.
    if (v.ok) return NextResponse.json({ data: { ok: true, templateKind: v.templateKind } });
    return NextResponse.json({ data: { ok: false, errors: v.errors } });
  });
}
