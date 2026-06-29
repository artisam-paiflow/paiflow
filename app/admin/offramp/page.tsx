import { Role } from "@prisma/client";
import { requireSession } from "@/lib/auth";
import Topbar from "@/components/app/topbar";
import OffRampCredentialForm from "@/components/admin/offramp-credential-form";

export const dynamic = "force-dynamic";

export default async function AdminOffRampPage() {
  const user = await requireSession({ role: Role.ADMIN });

  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-3xl">
        <p className="text-label-sm text-on-surface-variant font-mono">/ ADMIN · OFF-RAMP</p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          PDAX credentials.
        </h1>
        <p className="text-on-surface-variant mt-2 font-mono text-sm">
          Store PDAX Institution tokens here instead of environment variables. Update the access/id
          tokens whenever they expire; the refresh token is used automatically on 401s.
        </p>

        <section className="glass-panel mt-lg p-md rounded-xl">
          <OffRampCredentialForm />
        </section>
      </main>
    </>
  );
}
