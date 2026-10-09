import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { requirePageSession } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { subscriptionState } from "@/lib/subscription/state";
import { AllowanceDeploymentIdSchema } from "@/lib/subscription/schema";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
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
  await enforceRateLimit({
    key: `allowance-page:${clientIp(new NextRequest("https://paiflow.local", { headers: await headers() }))}`,
    limit: 40,
    windowSeconds: 60,
  });
  if (!AllowanceDeploymentIdSchema.safeParse(deploymentId).success) notFound();
  const kind = await db.deployment.findFirst({
    where: { id: deploymentId, serviceState: "ACTIVE", status: "CONFIRMED" },
    select: { flow: { select: { templateKind: true } } },
  });
  if (!kind || !["SUBSCRIPTION", "PAYROLL"].includes(kind.flow.templateKind)) notFound();
  if (kind.flow.templateKind === "SUBSCRIPTION") {
    try {
      const state = await subscriptionState(deploymentId);
      return (
        <AllowanceClient
          deploymentId={deploymentId}
          contractAddress={state.contractAddress}
          flowName={state.flowName}
          network={state.network}
          assetLabel={state.assetLabel}
          templateKind="SUBSCRIPTION"
          subscriber={state.subscriber}
          isCancelled={state.isCancelled}
        />
      );
    } catch (error) {
      if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION"))
        notFound();
      throw error;
    }
  }
  // Payroll retains its existing session/token boundary despite the shared URL.
  await requirePageSession();
  const d = await db.deployment.findFirst({
    where: { id: deploymentId, serviceState: "ACTIVE", status: "CONFIRMED" },
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
