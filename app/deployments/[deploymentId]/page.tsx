import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import DeploymentView from "@/components/deploy/deployment-view";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";

export const dynamic = "force-dynamic";

const statusMeta: Record<string, { label: string; tone: string; dot?: string }> = {
  PENDING: {
    label: "PENDING",
    tone: "border-tertiary/30 bg-tertiary/10 text-tertiary",
    dot: "status-dot-warn",
  },
  RUNNING: {
    label: "DEPLOYING",
    tone: "border-secondary/30 bg-secondary/10 text-secondary",
    dot: "status-dot-deploy",
  },
  CONFIRMED: {
    label: "ACTIVE",
    tone: "border-primary/30 bg-primary/10 text-primary",
    dot: "status-dot-live",
  },
  SUCCEEDED: {
    label: "ACTIVE",
    tone: "border-primary/30 bg-primary/10 text-primary",
    dot: "status-dot-live",
  },
  FAILED: {
    label: "FAILED",
    tone: "border-error/40 bg-error-container/30 text-error",
  },
};

function truncateAddr(addr: string | null) {
  if (!addr) return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default async function DeploymentPage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const user = await requireSession();
  const { deploymentId } = await params;
  const d = await db.deployment.findFirst({
    where: { id: deploymentId, ownerId: user.id },
    include: {
      flow: { select: { name: true, templateKind: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!d) notFound();

  const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
  const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
  const asset = trigger?.type === "on_receive" ? trigger.config.asset : { kind: "native" as const };

  const sep7 = d.contractAddress
    ? sep7PaymentUri({
        destination: d.contractAddress,
        asset,
        message: "Pink Raft deployment",
      })
    : null;

  const badge = statusMeta[d.status] ?? {
    label: d.status?.toUpperCase() ?? "—",
    tone: "border-outline-variant/40 bg-surface-container-low/60 text-on-surface-variant",
  };

  return (
    <>
      <Topbar username={user.username} />
      <main className="px-margin py-lg mx-auto max-w-7xl">
        <Link
          href="/dashboard"
          className="text-label-sm text-on-surface-variant hover:text-primary inline-flex items-center gap-1 font-mono transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">arrow_back</span>
          BACK
        </Link>

        {/* Header */}
        <div className="mt-md gap-md flex flex-wrap items-end justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-label-sm text-on-surface-variant font-mono">/ SOROBAN CONTRACT</p>
              <span
                className={`text-label-sm inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono ${badge.tone}`}
              >
                {badge.dot ? <span className={`${badge.dot} h-1.5 w-1.5`} /> : null}
                {badge.label}
              </span>
            </div>
            <h1 className="font-display text-on-surface mt-2 truncate text-[40px] leading-[1.1] font-semibold tracking-[-0.02em]">
              {d.flow.name}
            </h1>
            <div className="text-label-sm text-on-surface-variant mt-3 flex flex-wrap items-center gap-3 font-mono">
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">category</span>
                {d.flow.templateKind?.toUpperCase()}
              </span>
              <span className="text-outline-variant">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">hub</span>
                {d.network?.toUpperCase()}
              </span>
              <span className="text-outline-variant">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">tag</span>
                <span className="text-on-surface">{truncateAddr(d.contractAddress)}</span>
              </span>
              <span className="text-outline-variant">·</span>
              <span className="inline-flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                {new Date(d.createdAt).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <DeploymentView
          deploymentId={d.id}
          contractAddress={d.contractAddress}
          status={d.status}
          sep7Uri={sep7}
          graph={graph.success ? graph.data : null}
          initialEvents={d.events.map((e) => ({
            id: e.id,
            kind: e.kind,
            ledger: e.ledger,
            txHash: e.txHash,
            payload: e.payload,
            occurredAt: e.occurredAt.toISOString(),
          }))}
        />
      </main>
    </>
  );
}
