import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { FlowGraphSchema, isTrigger, assetLabel, migrateFlowGraph } from "@/lib/flows/schema";
import { inboundRequirement } from "@/lib/flows/inbound-amount";
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

  // Migrate first, as validateFlow does: rows saved before the split-recipient
  // `mode` field would otherwise fail to parse and silently skip the lock.
  const graphResult = FlowGraphSchema.safeParse(migrateFlowGraph(d.graphSnapshot));
  const graph = graphResult.success ? graphResult.data : null;
  const triggerNode = graph?.nodes.find(isTrigger);
  const isWeb2Webhook = triggerNode?.type === "web2_webhook";
  const triggerAssetLabel =
    triggerNode && "asset" in triggerNode.config ? assetLabel(triggerNode.config.asset) : undefined;

  // What the pipeline will actually consume. A webhook deposit and a streamer
  // top-up are open-ended funding rather than a payout run, so they keep the
  // free-form field — same carve-out as the API guard.
  const requirement =
    isWebhook || isStreamer || !graph ? { kind: "variable" as const } : inboundRequirement(graph);

  return (
    <TriggerClient
      deploymentId={d.id}
      contractAddress={d.contractAddress}
      flowName={d.flow.name}
      network={d.network as "testnet" | "mainnet"}
      requirement={requirement}
      isDeposit={isWeb2Webhook || isStreamer}
      assetLabel={triggerAssetLabel}
    />
  );
}
