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

  const allowedKinds = ["SUBSCRIPTION", "PAYROLL"];
  if (!d || !allowedKinds.includes(d.flow.templateKind) || !d.contractAddress) notFound();

  const graphResult = FlowGraphSchema.safeParse(d.graphSnapshot);
  const graph = graphResult.success ? graphResult.data : null;
  const triggerNode = graph?.nodes.find(isTrigger);
  if (
    !triggerNode ||
    (triggerNode.type !== "subscription" && triggerNode.type !== "payroll") ||
    !("asset" in triggerNode.config)
  )
    notFound();

  const asset = triggerNode.config.asset;

  return (
    <AllowanceClient
      deploymentId={d.id}
      contractAddress={d.contractAddress}
      flowName={d.flow.name}
      network={d.network as "testnet" | "mainnet"}
      assetLabel={assetLabel(asset)}
      templateKind={d.flow.templateKind as "SUBSCRIPTION" | "PAYROLL"}
    />
  );
}
