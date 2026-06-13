import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema } from "@/lib/flows/schema";
import DeploymentView from "@/components/deploy/deployment-view";
import Logo from "@/components/app/logo";
import { isStellarNetwork, type StellarNetwork } from "@/lib/stellar/explorer";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

export default async function EmbedPage({ params }: { params: Promise<{ deploymentId: string }> }) {
  const { deploymentId } = await params;
  const d = await db.deployment.findUnique({
    where: { id: deploymentId },
    include: {
      flow: { select: { templateKind: true } },
      events: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!d || d.status !== "CONFIRMED" || !d.contractAddress) notFound();
  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  if (!graphResult.success) notFound();
  const graph = graphResult.data;

  const network: StellarNetwork | null = isStellarNetwork(d.network) ? d.network : null;
  if (!network && d.network) {
    log.warn(
      { deploymentId: d.id, network: d.network },
      "deployment.network is not a known StellarNetwork; explorer link disabled",
    );
  }

  const pipeline = d.pipelineSnapshot as Array<{
    nodeId: string;
    contractAddress: string;
    templateKind: string;
  }> | null;
  const isPipeline = pipeline?.[0]?.templateKind === "DEPOSIT_TRIGGER";

  const qrUrl =
    isPipeline || d.flow.templateKind === "SPLITTER"
      ? `/api/deployments/${d.id}/qr?action=trigger`
      : null;

  return (
    <main className="px-margin py-md mx-auto max-w-4xl">
      <div className="mb-md text-label-sm text-on-surface-variant flex items-center gap-2 font-mono">
        <Logo size={18} />
        <span className="text-outline-variant">·</span>
        <span>EMBED</span>
      </div>
      <DeploymentView
        deploymentId={d.id}
        contractAddress={d.contractAddress}
        network={network}
        status={d.status}
        qrUrl={qrUrl}
        graph={graph}
        webhookSecret={d.webhookSecret}
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
  );
}
