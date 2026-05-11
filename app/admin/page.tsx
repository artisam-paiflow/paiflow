import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requireSession({ role: Role.ADMIN });
  const [users, deployments, recentAudit] = await Promise.all([
    db.user.count(),
    db.deployment.count(),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { username: true } } },
    }),
  ]);
  return (
    <>
      <Topbar username={user.username} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold">Admin</h1>
        <nav className="mt-4 flex gap-3 text-sm">
          <Link className="text-brand-300 hover:underline" href="/admin/users">
            Users
          </Link>
          <Link className="text-brand-300 hover:underline" href="/admin/templates">
            Contract templates
          </Link>
        </nav>
        <section className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat label="Users" value={users} />
          <Stat label="Deployments" value={deployments} />
          <Stat label="Audit entries (24h)" value="see below" />
        </section>
        <section className="mt-12 rounded-xl border border-zinc-800">
          <header className="border-b border-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300">
            Recent audit events
          </header>
          <ul className="divide-y divide-zinc-900">
            {recentAudit.map((a) => (
              <li
                key={a.id}
                className="grid grid-cols-[180px_140px_1fr_180px] gap-2 px-4 py-2 text-sm"
              >
                <span className="text-brand-300 font-mono">{a.action}</span>
                <span className="text-zinc-400">{a.user?.username ?? "—"}</span>
                <span className="truncate text-zinc-300">
                  {a.metadata ? JSON.stringify(a.metadata) : ""}
                </span>
                <span className="text-right text-xs text-zinc-500">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
            {recentAudit.length === 0 && (
              <li className="px-4 py-3 text-sm text-zinc-500">No events yet.</li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <div className="text-xs tracking-wide text-zinc-500 uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
