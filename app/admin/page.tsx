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
      <main className="px-margin py-lg mx-auto max-w-7xl">
        <p className="text-label-sm text-on-surface-variant font-mono">/ ADMIN · OVERVIEW</p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Operations.
        </h1>

        <nav className="mt-md flex flex-wrap gap-2">
          <Link
            href="/admin/users"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">group</span>
            USERS
          </Link>
          <Link
            href="/admin/templates"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">deployed_code</span>
            CONTRACT TEMPLATES
          </Link>
          <Link
            href="/admin/offramp"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">account_balance</span>
            OFF-RAMP
          </Link>
        </nav>

        <section className="mt-md gap-md grid grid-cols-1 md:grid-cols-3">
          <Stat label="USERS" value={users} icon="group" tone="text-secondary" />
          <Stat label="DEPLOYMENTS" value={deployments} icon="rocket_launch" tone="text-primary" />
          <Stat label="AUDIT EVENTS (24H)" value="see below" icon="history" tone="text-tertiary" />
        </section>

        <section className="glass-panel mt-lg overflow-hidden rounded-xl">
          <header className="border-outline-variant/15 bg-surface-container/60 px-md flex items-center justify-between border-b py-2.5">
            <span className="text-label-sm text-on-surface-variant font-mono">
              / RECENT AUDIT EVENTS
            </span>
            <span className="text-label-sm text-on-surface-variant font-mono">
              {recentAudit.length} SHOWN
            </span>
          </header>
          <ul className="divide-outline-variant/10 divide-y">
            {recentAudit.map((a) => (
              <li
                key={a.id}
                className="px-md text-body-md hover:bg-surface-container-high/40 grid grid-cols-[180px_140px_1fr_180px] gap-3 py-2.5 transition-colors"
              >
                <span className="text-label-sm text-primary font-mono">{a.action}</span>
                <span className="text-on-surface-variant">{a.user?.username ?? "—"}</span>
                <span className="text-label-sm text-on-surface-variant truncate font-mono">
                  {a.metadata ? JSON.stringify(a.metadata) : ""}
                </span>
                <span className="text-label-sm text-on-surface-variant text-right font-mono">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
            {recentAudit.length === 0 && (
              <li className="px-md py-md text-label-sm text-on-surface-variant font-mono">
                NO EVENTS YET.
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: string;
  tone: string;
}) {
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="flex items-center justify-between">
        <span className={`text-label-sm font-mono ${tone}`}>{label}</span>
        <span className={`material-symbols-outlined text-[18px] ${tone} opacity-80`}>{icon}</span>
      </div>
      <div className="font-display text-on-surface mt-3 text-[40px] leading-none font-bold tracking-[-0.02em]">
        {value}
      </div>
    </div>
  );
}
