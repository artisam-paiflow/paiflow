import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, signOut } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";

export async function POST() {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await db.session.deleteMany({ where: { userId: user.id } });
    await audit({ action: "USER_SESSIONS_REVOKED", userId: user.id });
    // Best-effort: clear current cookie too. The JWT itself is opaque to the
    // server outside Auth.js, so the next request will re-validate against
    // the (now-empty) session table.
    await signOut({ redirect: false });
    return NextResponse.json({ data: { ok: true } });
  });
}
