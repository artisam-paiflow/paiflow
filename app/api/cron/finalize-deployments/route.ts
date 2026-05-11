import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError, withErrorHandler } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }
    // Mark stuck SUBMITTED deployments as FAILED after 5 minutes (submit() handles the common case).
    const cutoff = new Date(Date.now() - 5 * 60_000);
    const updated = await db.deployment.updateMany({
      where: { status: "SUBMITTED", createdAt: { lt: cutoff } },
      data: { status: "FAILED", errorMessage: "Timed out before finality" },
    });
    return NextResponse.json({ data: { failed: updated.count } });
  });
}

export const GET = POST;
