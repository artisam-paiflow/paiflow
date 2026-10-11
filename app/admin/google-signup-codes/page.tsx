import { Role } from "@prisma/client";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { signupCodeSelect } from "@/lib/auth/google-signup";
import Topbar from "@/components/app/topbar";
import GoogleSignupCodes from "@/components/admin/google-signup-codes";

export const dynamic = "force-dynamic";
export default async function GoogleSignupCodesPage() {
  const user = await requirePageSession({ role: Role.ADMIN });
  const rows = await db.googleSignupCode.findMany({
    select: signupCodeSelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
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
