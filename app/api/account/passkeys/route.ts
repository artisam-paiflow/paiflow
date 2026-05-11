import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";

export async function GET() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const items = await db.passkey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        nickname: true,
        deviceType: true,
        backedUp: true,
        transports: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: items });
  });
}
