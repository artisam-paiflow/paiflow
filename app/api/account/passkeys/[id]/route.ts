import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { audit } from "@/lib/audit";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("passkeyManage", user.id);
    const { id } = await ctx.params;
    const pk = await db.passkey.findFirst({ where: { id, userId: user.id } });
    if (!pk) throw new AppError("NOT_FOUND", "Passkey not found");
    await db.passkey.delete({ where: { id } });
    await audit({ action: "PASSKEY_REMOVE", userId: user.id, metadata: { passkeyId: id } });
    return NextResponse.json({ data: { ok: true } });
  });
}
