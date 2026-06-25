import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema, isTrigger, assetLabel } from "@/lib/flows/schema";
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
  const pipeline = d?.pipelineSnapshot as Array<{
    nodeId: string;
    contractAddress: string;
    templateKind: string;
  }> | null;
  const isPipeline = pipeline?.[0]?.templateKind === "DEPOSIT_TRIGGER";
  const triggerKind = pipeline?.[0]?.templateKind;
  const isWebhook = triggerKind === "WEBHOOK";
  const isStreamer = d?.flow.templateKind === "STREAMER";

  if (
    !d ||
    (!isPipeline && !isWebhook && d.flow.templateKind !== "SPLITTER" && !isStreamer) ||
    !d.contractAddress
  )
    notFound();

  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  const graph = graphResult.success ? graphResult.data : null;
  const triggerNode = graph?.nodes.find(isTrigger);
  const isWeb2Webhook = triggerNode?.type === "web2_webhook";
  const triggerAssetLabel =
    triggerNode && "asset" in triggerNode.config ? assetLabel(triggerNode.config.asset) : undefined;

  return (
    <TriggerClient
      deploymentId={d.id}
      contractAddress={d.contractAddress}
      flowName={d.flow.name}
      network={d.network as "testnet" | "mainnet"}
      graph={graph}
      isDeposit={isWeb2Webhook || isStreamer}
      assetLabel={triggerAssetLabel}
    />
  );
}
