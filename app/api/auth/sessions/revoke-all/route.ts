import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, signOut } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function POST() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await db.user.update({
      where: { id: user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    await audit({ action: "USER_SESSIONS_REVOKED", userId: user.id });
    // The bump already ended this session along with the others; clearing the
    // cookie just saves this browser a trip through /api/auth/stale-session.
    await signOut({ redirect: false });
    return NextResponse.json({ data: { ok: true } });
  });
}
