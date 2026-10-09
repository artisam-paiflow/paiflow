import type { CapabilityOperation, DeploymentCapabilities } from "@/lib/api/v1/schema";

export const DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000000";
export function capabilities(
  triggerType: DeploymentCapabilities["triggerType"],
): DeploymentCapabilities {
  const operation = (
    status: CapabilityOperation["status"],
    authentication: CapabilityOperation["authentication"] = "deployment_token",
  ): CapabilityOperation => ({
    status,
    authentication,
    requirements: ["Synthetic operation requirement"],
    nodeIds: [],
  });
  return {
    deploymentId: DEPLOYMENT_ID,
    network: "testnet",
    configurationSource: "deployment_snapshot",
    triggerType,
    inputAsset: { kind: "native" },
    operations: {
      execute: operation(triggerType === "deposit" ? "supported" : "unsupported"),
      events: operation("supported"),
      transactions: operation("supported"),
      releaseEarly: operation("unsupported"),
      payouts: operation("unsupported"),
      webhook: operation(triggerType === "webhook" ? "supported" : "unsupported", "webhook_secret"),
      subscriptionAllowance: operation(
        triggerType === "subscription" ? "conditional" : "unsupported",
        "subscriber_wallet",
      ),
    },
  };
}
