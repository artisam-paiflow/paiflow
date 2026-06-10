import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import Topbar from "@/components/app/topbar";
import DeploymentView from "@/components/deploy/deployment-view";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import {
  isStellarNetwork,
  stellarExpertContractUrl,
  type StellarNetwork,
} from "@/lib/stellar/explorer";
import { log } from "@/lib/log";

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

  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  if (!graphResult.success) notFound();
  const graph = graphResult.data;

  const pipeline = d.pipelineSnapshot as Array<{
    nodeId: string;
    contractAddress: string;
    templateKind: string;
  }> | null;
  const isPipeline = pipeline?.[0]?.templateKind === "DEPOSIT_TRIGGER";

  const triggerNode = graph.nodes.find(isTrigger);
  const isWebhookLike = triggerNode?.type === "webhook" || triggerNode?.type === "web2_webhook";

  const isStreamerLike = d.flow.templateKind === "STREAMER";

  const qrUrl =
    d.contractAddress &&
    (isPipeline || isWebhookLike || d.flow.templateKind === "SPLITTER" || isStreamerLike)
      ? `/api/deployments/${d.id}/qr?action=trigger`
      : null;

  const badge = statusMeta[d.status] ?? {
    label: d.status?.toUpperCase() ?? "—",
    tone: "border-outline-variant/40 bg-surface-container-low/60 text-on-surface-variant",
  };

  const network: StellarNetwork | null = isStellarNetwork(d.network) ? d.network : null;
  if (!network && d.network) {
    log.warn(
      { deploymentId: d.id, network: d.network },
      "deployment.network is not a known StellarNetwork; explorer link disabled",
    );
  }
  const explorerUrl =
    d.contractAddress && network ? stellarExpertContractUrl(d.contractAddress, network) : null;

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
                {explorerUrl ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-on-surface hover:text-primary inline-flex items-center gap-1 transition-colors"
                  >
                    {truncateAddr(d.contractAddress)}
                    <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                  </a>
                ) : (
                  <span className="text-on-surface">{truncateAddr(d.contractAddress)}</span>
                )}
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
          network={network}
          status={d.status}
          qrUrl={qrUrl}
          graph={graph}
          webhookSecret={d.webhookSecret}
          pipeline={pipeline}
          initialEvents={d.events.map((e) => ({
            id: e.id,
            kind: e.kind,
            ledger: e.ledger,
            txHash: e.txHash,
            payload: e.payload,
            decodedData: e.decodedData as Record<string, unknown> | null,
            occurredAt: e.occurredAt.toISOString(),
          }))}
        />
      </main>
    </>
  );
}
