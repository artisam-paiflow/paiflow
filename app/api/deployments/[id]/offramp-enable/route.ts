import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireDevAuth } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const PostSchema = z.object({
  enabled: z.boolean(),
});

async function requirePayrollDeployment(id: string, userId: string | null) {
  const where = userId ? { id, ownerId: userId } : { id };
  const d = await db.deployment.findFirst({
    where,
    include: { flow: { select: { templateKind: true } } },
  });
  if (!d) throw new AppError("NOT_FOUND", "Deployment not found");
  if (d.flow.templateKind !== "PAYROLL") {
    throw new AppError("VALIDATION", "Deployment is not a payroll");
  }
  return d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const d = await requirePayrollDeployment(id, user?.id ?? null);
    return NextResponse.json({ data: { offRampEnabled: d.offRampEnabled } });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { user } = await requireDevAuth(req);
    const { id } = await ctx.params;
    const rlKey = user ? `offramp-enable:${user.id}` : `offramp-enable:machine:${clientIp(req)}`;
    const rl = await rateLimit(rlKey, 30, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many off-ramp toggles");
    const d = await requirePayrollDeployment(id, user?.id ?? null);

    const body = PostSchema.parse(await req.json());

    await db.deployment.update({
      where: { id },
      data: { offRampEnabled: body.enabled },
    });

    return NextResponse.json({ data: { offRampEnabled: body.enabled } });
  });
}
