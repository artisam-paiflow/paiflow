import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { subscriptionState } from "@/lib/subscription/state";
import { AllowanceDeploymentIdSchema } from "@/lib/subscription/schema";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";
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
