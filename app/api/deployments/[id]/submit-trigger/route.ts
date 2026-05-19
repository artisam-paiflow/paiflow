import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, withErrorHandler } from "@/lib/errors";
import { submitTriggerTx } from "@/lib/stellar/trigger";

const SubmitSchema = z.object({ signedXdr: z.string().min(10).max(200_000) });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    const body = SubmitSchema.parse(await req.json());

    const d = await db.deployment.findFirst({
      where: { id, status: "CONFIRMED" },
      include: { flow: { select: { templateKind: true } } },
    });
    if (!d) throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
    if (d.flow.templateKind !== "SPLITTER") {
      throw new AppError("VALIDATION", "Only splitter deployments support trigger submit");
    }

    const result = await submitTriggerTx(body.signedXdr);
    if (result.status === "SUCCESS") {
      return NextResponse.json({ data: { txHash: result.txHash } });
    }
    return NextResponse.json(
      { error: { code: "UPSTREAM_RPC", message: result.errorMessage ?? "Submission failed" } },
      { status: 502 },
    );
  });
}
