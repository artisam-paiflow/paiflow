import Link from "next/link";
import { Role } from "@prisma/client";
import { getAuditLogPage } from "@/lib/admin/audit-log/page";
import { getWalletConnectionStats } from "@/lib/admin-stats";
import { requirePageSession } from "@/lib/auth";
import { db } from "@/lib/db";
import AuditLog from "@/components/admin/audit-log";
import Topbar from "@/components/app/topbar";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requirePageSession({ role: Role.ADMIN });
  const [users, deployments, recentAudit, walletStats] = await Promise.all([
    db.user.count(),
    db.deployment.count(),
    getAuditLogPage({ limit: 20 }),
    getWalletConnectionStats(),
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
            href="/admin/google-signup-codes"
            className="border-outline-variant/40 text-on-surface-variant rounded-lg border px-3 py-1.5"
          >
            GOOGLE SIGNUP CODES
          </Link>
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
          <Link
            href="/admin/submission-proof"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">receipt_long</span>
            SUBMISSION PROOF
          </Link>
        </nav>

        <section className="mt-md gap-md grid grid-cols-1 md:grid-cols-3">
          <Stat label="USERS" value={users} icon="group" tone="text-secondary" />
          <Stat label="DEPLOYMENTS" value={deployments} icon="rocket_launch" tone="text-primary" />
          <Stat label="AUDIT EVENTS (24H)" value="see below" icon="history" tone="text-tertiary" />
        </section>

        <section className="mt-md gap-md grid grid-cols-1 md:grid-cols-2">
          <Stat
            label="WALLET CONNECTIONS"
            value={walletStats.total}
            icon="account_balance_wallet"
            tone="text-secondary"
          />
          <Stat
            label="UNIQUE WALLETS"
            value={walletStats.unique}
            icon="wallet"
            tone="text-primary"
          />
        </section>

        <AuditLog initial={recentAudit} />
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
