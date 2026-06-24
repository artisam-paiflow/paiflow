import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

const PostSchema = z.object({
  enabled: z.boolean(),
});

async function requirePayrollDeployment(id: string, userId: string) {
  const d = await db.deployment.findFirst({
    where: { id, ownerId: userId },
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
    const user = await requireSession();
    const { id } = await ctx.params;
    const d = await requirePayrollDeployment(id, user.id);
    return NextResponse.json({ data: { offRampEnabled: d.offRampEnabled } });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requirePayrollDeployment(id, user.id);

    const body = PostSchema.parse(await req.json());

    await db.deployment.update({
      where: { id },
      data: { offRampEnabled: body.enabled },
    });

    return NextResponse.json({ data: { offRampEnabled: body.enabled } });
  });
}
