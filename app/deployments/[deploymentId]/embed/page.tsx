import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { sep7PaymentUri } from "@/lib/stellar/sep7";
import { FlowGraphSchema, isTrigger } from "@/lib/flows/schema";
import DeploymentView from "@/components/deploy/deployment-view";

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
  const graph = FlowGraphSchema.safeParse(d.graphSnapshot);
  const trigger = graph.success ? graph.data.nodes.find(isTrigger) : null;
  const asset =
    trigger?.type === "on_receive" ? trigger.config.asset : ({ kind: "native" } as const);
  const sep7 = sep7PaymentUri({ destination: d.contractAddress, asset });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <DeploymentView
        deploymentId={d.id}
        contractAddress={d.contractAddress}
        status={d.status}
        sep7Uri={sep7}
        templateKind={d.flow.templateKind}
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
  );
}
