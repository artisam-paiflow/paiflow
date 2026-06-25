import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import type { TemplateKind } from "@prisma/client";

const SenderSchema = z.object({
  firstName: z.string().min(1).max(128),
  middleName: z.string().max(128).optional(),
  lastName: z.string().min(1).max(128),
  countryOrigin: z.string().min(1).max(128),
  addressLineOne: z.string().max(256).optional(),
  addressLineTwo: z.string().max(256).optional(),
  city: z.string().max(128).optional(),
  province: z.string().max(128).optional(),
  country: z.string().max(128).optional(),
  zipCode: z.string().max(32).optional(),
  phoneNumber: z.string().max(64).optional(),
  nationality: z.string().max(128).optional(),
  nationalIdentityNumber: z.string().max(128).optional(),
  dob: z.string().max(32).optional(),
  placeOfBirth: z.string().max(128).optional(),
  sourceOfFunds: z.string().min(1).max(128),
  email: z.string().email().max(256).optional(),
});

const PostSchema = SenderSchema;

const OFFRAMP_TEMPLATE_KINDS: TemplateKind[] = ["PAYROLL", "CASH_OUT", "CASH_OUT_DEV"];

type PipelineNodeSnapshot = {
  nodeId: string;
  contractAddress: string;
  templateKind: TemplateKind;
};

async function requireOffRampDeployment(id: string, userId: string) {
  const d = await db.deployment.findFirst({
    where: { id, ownerId: userId },
    include: { flow: { select: { templateKind: true } } },
  });
  if (!d) throw new AppError("NOT_FOUND", "Deployment not found");

  // Payroll deployments are always allowed.
  if (d.flow.templateKind === "PAYROLL") return d;

  // Cash-out deployments are identified by their pipeline snapshot.
  const pipeline = (d.pipelineSnapshot as PipelineNodeSnapshot[] | null) ?? [];
  const hasOffRampNode = pipeline.some((n) => OFFRAMP_TEMPLATE_KINDS.includes(n.templateKind));
  if (!hasOffRampNode) {
    throw new AppError("VALIDATION", "Deployment has no off-ramp sink");
  }
  return d;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requireOffRampDeployment(id, user.id);

    const profile = await db.offRampSenderProfile.findUnique({
      where: { deploymentId: id },
    });

    return NextResponse.json({ data: { profile } });
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;
    await requireOffRampDeployment(id, user.id);

    const body = PostSchema.parse(await req.json());

    const profile = await db.offRampSenderProfile.upsert({
      where: { deploymentId: id },
      create: {
        deploymentId: id,
        ...body,
      },
      update: {
        ...body,
      },
    });

    return NextResponse.json({ data: { profile } });
  });
}
