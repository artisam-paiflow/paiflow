import { Role } from "@prisma/client";
import { requirePageSession } from "@/lib/auth";
import { listGoogleSignupCodes } from "@/lib/auth/google-signup";
import Topbar from "@/components/app/topbar";
import GoogleSignupCodes from "@/components/admin/google-signup-codes";

export const dynamic = "force-dynamic";
export default async function GoogleSignupCodesPage() {
  const user = await requirePageSession({ role: Role.ADMIN });
  const { data: rows, nextCursor } = await listGoogleSignupCodes();
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-5xl">
        <h1 className="font-display text-on-surface text-3xl">Google signup codes</h1>
        <p className="text-on-surface-variant mt-3">
          Reusable access codes for invited participants. Codes grant ordinary user access while
          Google registration is enabled.
        </p>
        <GoogleSignupCodes
          initialNextCursor={nextCursor}
          initial={rows.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
            disabledAt: row.disabledAt?.toISOString() ?? null,
          }))}
        />
      </main>
    </>
  );
}
