import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const { id } = await ctx.params;

    const entry = await db.addressBookEntry.findFirst({
      where: { id, ownerId: user.id },
    });
    if (!entry) throw new AppError("NOT_FOUND", "Address book entry not found");

    await db.addressBookEntry.delete({ where: { id } });
    return NextResponse.json({ data: { ok: true } });
  });
}
