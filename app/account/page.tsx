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
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Account</h1>
        <dl className="mt-6 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
          <dt className="text-zinc-400">Username</dt>
          <dd>{me?.username}</dd>
          <dt className="text-zinc-400">Role</dt>
          <dd>{me?.role}</dd>
          <dt className="text-zinc-400">Member since</dt>
          <dd>{me?.createdAt ? new Date(me.createdAt).toLocaleString() : ""}</dd>
          <dt className="text-zinc-400">Last sign-in</dt>
          <dd>{me?.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : "never"}</dd>
        </dl>
        <ChangePassword />
        <PasskeyManager />
      </main>
    </>
  );
}
