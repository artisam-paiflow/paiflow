import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { getSubmissionProof } from "@/lib/admin-stats";
import Topbar from "@/components/app/topbar";

export const dynamic = "force-dynamic";

export default async function SubmissionProofPage() {
  const user = await requireSession({ role: Role.ADMIN });
  const proof = await getSubmissionProof();

  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-7xl print:p-0">
        <p className="text-label-sm text-on-surface-variant font-mono">
          / ADMIN · SUBMISSION PROOF
        </p>
        <h1 className="font-display text-on-surface mt-2 text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
          Submission proof.
        </h1>

        <div className="mt-md flex flex-wrap gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-primary text-on-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-sm font-bold"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            PRINT
          </button>
          <a
            href="/api/admin/submission-proof?format=json"
            download="paiflow-submission-proof.json"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            DOWNLOAD JSON
          </a>
          <a
            href="/api/admin/submission-proof?format=csv"
            download="paiflow-submission-proof.csv"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            DOWNLOAD CSV
          </a>
          <Link
            href="/admin"
            className="border-outline-variant/40 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            BACK
          </Link>
        </div>

        <section className="mt-md gap-md grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          <Stat label="USERS" value={proof.userCount} />
          <Stat label="DEPLOYMENTS" value={proof.deploymentCount} />
          <Stat label="WALLET CONNECTIONS" value={proof.walletConnectionTotal} />
          <Stat label="UNIQUE WALLETS" value={proof.uniqueWalletAddresses} />
        </section>

        <section className="glass-panel mt-lg overflow-hidden rounded-xl">
          <header className="border-outline-variant/15 bg-surface-container/60 px-md flex items-center justify-between border-b py-2.5">
            <span className="text-label-sm text-on-surface-variant font-mono">
              / RECENT WALLET CONNECTIONS
            </span>
            <span className="text-label-sm text-on-surface-variant font-mono">
              {proof.recentWalletConnections.length} SHOWN
            </span>
          </header>
          <ul className="divide-outline-variant/10 divide-y">
            {proof.recentWalletConnections.map((c, i) => (
              <li
                key={i}
                className="px-md text-body-md hover:bg-surface-container-high/40 grid grid-cols-[140px_120px_1fr_100px_180px] gap-3 py-2.5 transition-colors"
              >
                <span className="text-label-sm text-primary font-mono">{c.addressHash}</span>
                <span className="text-on-surface-variant">{c.maskedAddress}</span>
                <span className="text-label-sm text-on-surface-variant truncate font-mono">
                  {c.walletId} · {c.network}
                </span>
                <span className="text-label-sm text-on-surface-variant font-mono">
                  {new Date(c.occurredAt).toLocaleDateString()}
                </span>
                <span className="text-label-sm text-on-surface-variant text-right font-mono">
                  {new Date(c.occurredAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
            {proof.recentWalletConnections.length === 0 && (
              <li className="px-md py-md text-label-sm text-on-surface-variant font-mono">
                NO WALLET CONNECTIONS YET.
              </li>
            )}
          </ul>
        </section>

        <section className="glass-panel mt-lg overflow-hidden rounded-xl">
          <header className="border-outline-variant/15 bg-surface-container/60 px-md flex items-center justify-between border-b py-2.5">
            <span className="text-label-sm text-on-surface-variant font-mono">
              / RECENT ON-CHAIN INTERACTIONS
            </span>
            <span className="text-label-sm text-on-surface-variant font-mono">
              {proof.recentOnChainInteractions.length} SHOWN
            </span>
          </header>
          <ul className="divide-outline-variant/10 divide-y">
            {proof.recentOnChainInteractions.map((e, i) => (
              <li
                key={i}
                className="px-md text-body-md hover:bg-surface-container-high/40 grid grid-cols-[1fr_140px_180px] gap-3 py-2.5 transition-colors"
              >
                <span className="text-label-sm text-primary truncate font-mono">{e.txHash}</span>
                <span className="text-on-surface-variant">{e.kind}</span>
                <span className="text-label-sm text-on-surface-variant text-right font-mono">
                  {new Date(e.occurredAt).toLocaleString()}
                </span>
              </li>
            ))}
            {proof.recentOnChainInteractions.length === 0 && (
              <li className="px-md py-md text-label-sm text-on-surface-variant font-mono">
                NO ON-CHAIN EVENTS YET.
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-panel p-md rounded-xl">
      <div className="flex items-center justify-between">
        <span className="text-label-sm text-on-surface-variant font-mono">{label}</span>
      </div>
      <div className="font-display text-on-surface mt-3 text-[40px] leading-none font-bold tracking-[-0.02em]">
        {value}
      </div>
    </div>
  );
}
