import Link from "next/link";
import { requirePageSession } from "@/lib/auth";
import { googleErrorMessage } from "@/lib/auth/google-messages";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import ChangePassword from "@/components/account/change-password";
import PasskeyManager from "@/components/account/passkeys";
import Topbar from "@/components/app/topbar";
import GoogleButton from "@/components/auth/google-button";

export const dynamic = "force-dynamic";

export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ googleError?: string; googleLinked?: string }>;
}) {
  const params = await searchParams;
  const user = await requirePageSession();
  const me = await db.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      email: true,
      passwordHash: true,
      googleIdentities: { select: { id: true } },
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

        {params.googleError ? (
          <p role="alert" className="text-error mt-md">
            {googleErrorMessage(params.googleError)}
          </p>
        ) : null}
        {params.googleLinked && me?.googleIdentities.length ? (
          <p role="status" className="text-secondary mt-md">
            Google is linked to your account.
          </p>
        ) : null}
        {me?.passwordHash ? (
          <ChangePassword />
        ) : (
          <p className="text-on-surface-variant mt-md">
            This account has no local password. Use Google account recovery if you lose access.
          </p>
        )}
        {env().GOOGLE_AUTH_ENABLED && user.role !== "SANDBOX" ? (
          <section className="glass-panel mt-md p-md rounded-xl">
            <h2 className="text-on-surface">Google sign-in</h2>
            {me?.googleIdentities.length ? (
              <p className="text-on-surface-variant mt-3">
                Google is linked. Your existing account and permissions are preserved.
              </p>
            ) : (
              <>
                <p className="text-on-surface-variant mt-3">
                  Link Google within five minutes of signing in. If needed, sign out using the menu
                  and sign in again before returning here.
                </p>
                <GoogleButton link authOrigin={new URL(env().AUTH_URL).origin} />
              </>
            )}
          </section>
        ) : null}
        {user.role !== "SANDBOX" ? (
          <section className="glass-panel mt-md p-md rounded-xl">
            <h2 className="text-on-surface">Developer API</h2>
            <p className="text-on-surface-muted mt-2">
              Connect your backend to selected existing deployments with one API token.
            </p>
            <Link
              href="/account/developer"
              className="text-primary mt-2 inline-block min-h-11 py-2 underline"
            >
              Manage developer tokens
            </Link>
          </section>
        ) : null}
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
