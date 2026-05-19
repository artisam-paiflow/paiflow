import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import PasskeyManager from "@/components/account/passkeys";
import ChangePassword from "@/components/account/change-password";

export const dynamic = "force-dynamic";

export default async function Account() {
  const user = await requireSession();
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });
  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-3xl">
        <p className="text-label-sm text-on-surface-variant font-mono">/ ACCOUNT</p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Profile.
        </h1>

        <section className="glass-panel mt-md p-md grid grid-cols-[160px_1fr] gap-y-3 rounded-xl">
          <KV k="USERNAME" v={me?.username ?? "—"} mono />
          <KV k="ROLE" v={me?.role ?? "—"} mono />
          <KV
            k="MEMBER SINCE"
            v={me?.createdAt ? new Date(me.createdAt).toLocaleString() : "—"}
            mono
          />
          <KV
            k="LAST SIGN-IN"
            v={me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : "NEVER"}
            mono
          />
        </section>

        <ChangePassword />
        <PasskeyManager />
      </main>
    </>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-label-sm text-on-surface-variant font-mono uppercase">{k}</dt>
      <dd
        className={mono ? "text-body-md text-on-surface font-mono" : "text-body-md text-on-surface"}
      >
        {v}
      </dd>
    </>
  );
}
