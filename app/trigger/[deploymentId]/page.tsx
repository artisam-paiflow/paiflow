import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema } from "@/lib/flows/schema";
import TriggerClient from "./trigger-client";

export const dynamic = "force-dynamic";

export default async function TriggerPage({
  params,
}: {
  params: Promise<{ deploymentId: string }>;
}) {
  const { deploymentId } = await params;
  const d = await db.deployment.findFirst({
    where: { id: deploymentId, status: "CONFIRMED" },
    include: {
      flow: { select: { name: true, templateKind: true } },
    },
  });
  if (!d || d.flow.templateKind !== "SPLITTER" || !d.contractAddress) notFound();

  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  const graph = graphResult.success ? graphResult.data : null;

  return (
    <TriggerClient
      deploymentId={d.id}
      contractAddress={d.contractAddress}
      flowName={d.flow.name}
      network={d.network as "testnet" | "mainnet"}
      graph={graph}
    />
  );
}
