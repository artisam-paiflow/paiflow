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
      funding: operation(
        ["schedule", "webhook"].includes(triggerType) ? "conditional" : "unsupported",
      ),
      balances: operation("conditional"),
      events: operation("supported"),
      transactions: operation("supported"),
      releaseEarly: operation("unsupported"),
      payouts: operation("unsupported"),
      webhook: operation(triggerType === "webhook" ? "supported" : "unsupported", "webhook_secret"),
      subscriptionCancel: operation(
        triggerType === "subscription" ? "conditional" : "unsupported",
        "subscriber_wallet",
      ),
      subscriptionReactivate: operation(
        triggerType === "subscription" ? "conditional" : "unsupported",
        "subscriber_wallet",
      ),
      swapQuote: operation("unsupported"),
      scheduleState: operation(triggerType === "schedule" ? "supported" : "unsupported"),
      scheduleControls: operation(triggerType === "schedule" ? "conditional" : "unsupported"),
      subscriptionState: operation(triggerType === "subscription" ? "supported" : "unsupported"),
      subscriptionAllowance: operation(
        triggerType === "subscription" ? "conditional" : "unsupported",
        "subscriber_wallet",
      ),
    },
  };
}
