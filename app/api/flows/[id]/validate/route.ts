import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { validateFlow } from "@/lib/flows/validate";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    const flow = await db.flow.findFirst({ where: { id, ownerId: user.id } });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
    const v = validateFlow(flow.graph);
    if (v.ok) return NextResponse.json({ data: { ok: true, templateKind: v.templateKind } });
    return NextResponse.json({ data: { ok: false, errors: v.errors } });
  });
}
