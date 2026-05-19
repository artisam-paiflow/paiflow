import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema } from "@/lib/flows/schema";
import { sep7InvokeUri } from "@/lib/stellar/sep7";
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
  const graph = FlowGraphSchema.parse(d.graphSnapshot);

  const invokeUri =
    d.flow.templateKind === "SPLITTER"
      ? sep7InvokeUri({
          destination: d.contractAddress,
          function: "distribute",
          paramName: "amount",
          paramType: "i128",
          message: "Trigger splitter distribution",
        })
      : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <DeploymentView
        deploymentId={d.id}
        contractAddress={d.contractAddress}
        status={d.status}
        invokeUri={invokeUri}
        graph={graph}
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
