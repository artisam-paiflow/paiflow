import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema, isTrigger, assetLabel } from "@/lib/flows/schema";
import AllowanceClient from "./allowance-client";

export const dynamic = "force-dynamic";

export default async function AllowancePage({
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

  if (!d || d.flow.templateKind !== "SUBSCRIPTION" || !d.contractAddress) notFound();

  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  const graph = graphResult.success ? graphResult.data : null;
  const triggerNode = graph?.nodes.find(isTrigger);
  if (triggerNode?.type !== "subscription") notFound();

  const asset = triggerNode.config.asset;

  return (
    <AllowanceClient
      deploymentId={d.id}
      contractAddress={d.contractAddress}
      flowName={d.flow.name}
      network={d.network as "testnet" | "mainnet"}
      assetLabel={assetLabel(asset)}
    />
  );
}
