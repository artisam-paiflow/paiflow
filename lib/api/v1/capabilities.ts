import "server-only";
import type { Deployment } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
import { balanceCandidates } from "./balance-targets";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { isFeatureEnabled } from "@/lib/features";
import { conditionBranchTargets } from "@/lib/flows/branches";
import { FlowGraphSchema, isTrigger, type FlowGraph } from "@/lib/flows/schema";
import {
  CapabilitiesAssetSchema,
  EXECUTE_PREREQUISITES,
  type CapabilityOperation,
  type DeploymentCapabilities,
} from "./schema";
// Never infer deployed contracts by recompiling a graph, or promote a later
// node to the head when a snapshot is malformed. Unknown kinds stay unknown.
const PipelineSchema = z
  .array(
    z.object({
      nodeId: z.string().min(1),
      templateKind: z.string().min(1),
      contractAddress: z.string().refine(StrKey.isValidContract),
    }),
  )
  .min(1);
const operation = (
  status: CapabilityOperation["status"],
  requirements: string[],
  nodeIds: string[] = [],
  authentication: CapabilityOperation["authentication"] = "deployment_token",
): CapabilityOperation => ({ status, authentication, requirements, nodeIds });
/** Metadata-only projection: no RPC, simulation, secret serialization or mutation. */
export function deploymentCapabilities(
  deployment: Pick<
    Deployment,
    "id" | "status" | "network" | "pipelineSnapshot" | "graphSnapshot" | "webhookSecret"
  >,
): DeploymentCapabilities {
  if (deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment not found or not confirmed");
  const network = env().STELLAR_NETWORK;
  if (deployment.network !== network)
    throw new AppError("VALIDATION", "Deployment network does not match this environment");
  const pipeline = PipelineSchema.safeParse(deployment.pipelineSnapshot);
  const nodes = pipeline.success ? pipeline.data : [];
  const head = nodes[0];
  const graph = FlowGraphSchema.safeParse(deployment.graphSnapshot);
  const recordedGraph = graph.success ? graph.data : null;
  const headBlock = recordedGraph?.nodes.find((node) => node.id === head?.nodeId);
  const subscriptionNodes = nodes.filter((node) => ["SUBSCRIPTION"].includes(node.templateKind));
  let triggerType: DeploymentCapabilities["triggerType"] = "unknown";
  switch (head?.templateKind) {
    case "DEPOSIT_TRIGGER":
      triggerType = "deposit";
      break;
    case "WEBHOOK":
      triggerType = "webhook";
      break;
    case "SUBSCRIPTION":
      triggerType = headBlock?.type === "payroll" ? "payroll" : "subscription";
      break;
    case "PAYROLL":
      triggerType = "payroll";
      break;
    case "STREAMER":
      triggerType = "schedule";
      break;
    case "ORACLE":
      triggerType = "oracle";
      break;
  }
  const asset =
    headBlock && "asset" in headBlock.config
      ? CapabilitiesAssetSchema.safeParse(headBlock.config.asset)
      : null;
  const releaseNodes = nodes.filter((node) => node.templateKind === "TIMELOCK_BRANCH");

  const subscriptionTrigger = recordedGraph?.nodes.find(isTrigger);
  const allowanceCandidate =
    triggerType === "subscription" &&
    subscriptionTrigger?.type === "subscription" &&
    subscriptionNodes.length === 1 &&
    subscriptionNodes[0]?.nodeId === subscriptionTrigger.id;
  const stateCandidate =
    allowanceCandidate &&
    recordedGraph?.nodes.filter(isTrigger).length === 1 &&
    new Set(nodes.map((node) => node.nodeId)).size === nodes.length &&
    new Set(nodes.map((node) => node.contractAddress)).size === nodes.length &&
    head?.nodeId === subscriptionTrigger?.id;
  const fundingSnapshot = BalancePipelineSnapshotSchema.safeParse(deployment.pipelineSnapshot);
  const fundNodes = fundingSnapshot.success
    ? fundingSnapshot.data.filter((n) => ["STREAMER", "WEBHOOK"].includes(n.templateKind))
    : [];
  const scheduleNodes = nodes.filter((node) => node.templateKind === "STREAMER");
  const scheduleValid =
    scheduleNodes.length > 0 &&
    nodes.length <= 128 &&
    new Set(nodes.map((node) => node.nodeId)).size === nodes.length &&
    new Set(nodes.map((node) => node.contractAddress)).size === nodes.length;
  const webhookEnabled = triggerType === "webhook" && !!deployment.webhookSecret;
  return {
    deploymentId: deployment.id,
    network,
    configurationSource: "deployment_snapshot",
    triggerType,
    inputAsset: asset?.success ? asset.data : null,
    operations: {
      execute:
        triggerType === "deposit"
          ? operation("supported", [
              EXECUTE_PREREQUISITES,
              "Prepare, sign with the paying wallet, then submit the same envelope. Simulation checks current configuration; conditions can hold funds instead of paying immediately.",
            ])
          : operation("unsupported", [
              "Execute requires a pipeline headed by a deposit trigger; other triggers use their own funding, schedule or callback workflow.",
            ]),
      funding:
        fundNodes.length && fundNodes.length <= 16
          ? operation(
              "conditional",
              [
                "GET /funding discovers live assets; POST /funding prepares Schedule top-ups or Webhook pool deposits. Any consenting funder may sign; the deployment token cannot move funds.",
                "Funding adds funds only; it does not execute Schedule payouts or Webhook callbacks. One unresolved intent per node blocks all further preparations; reconcile before replacement. Hosted testnet verification remains pending.",
              ],
              fundNodes.map((n) => n.nodeId),
            )
          : operation("unsupported", [
              "No unambiguous supported Schedule or Webhook funding nodes.",
            ]),
      balances: balanceCandidates(deployment.pipelineSnapshot).length
        ? operation(
            "conditional",
            [
              "Reads current token contract balances, not Schedule payout availability or proof of payment. Live asset and balance reads must succeed; stale, partial and unsupported targets make totals incomplete.",
              "Display reads may be cached for 10 seconds. Multisig is excluded. Hosted testnet verification remains required before participant availability is claimed.",
            ],
            balanceCandidates(deployment.pipelineSnapshot).map((n) => n.nodeId),
          )
        : operation("unsupported", [
            "No supported balance targets were established from the deployment snapshot. Multisig is excluded.",
          ]),
      events: operation("supported", [
        "Returns recorded deployment events with forward pagination; collection can lag the chain. Missing events do not prove payment failure.",
      ]),
      transactions: operation("supported", [
        "Only transactions attributable to this deployment can be read. RPC history is limited; UNKNOWN or a 404 does not prove failure or authorize another payment.",
      ]),
      releaseEarly: releaseNodes.length
        ? operation(
            "supported",
            [
              "The selected timelock branch must hold funds and still be before its deadline. Strict Hold contracts cannot release early. Pass nodeId when several branches exist; the token authorizes a relayer-signed release.",
            ],
            releaseNodes.map((node) => node.nodeId),
          )
        : operation("unsupported", [
            "No deployed timelock branch supports early release. Strict Hold contracts cannot release early.",
          ]),
      webhook: webhookEnabled
        ? operation(
            "supported",
            [
              "Uses x-webhook-secret, not the deployment token. The owner obtains the secret separately; discovery never returns it.",
              "For escrow rewards, fund the pool first and send escrow:true. Use the same Idempotency-Key and effective payload for retries; unkeyed callbacks can each create another payout. Non-escrow execution needs the source account's signed authorization.",
            ],
            [],
            "webhook_secret",
          )
        : operation(
            "unsupported",
            ["Requires a deployed webhook trigger with HTTP callbacks enabled."],
            [],
            "webhook_secret",
          ),
      swapQuote:
        nodes.some((node) => node.templateKind === "SWAPPER") &&
        new Set(nodes.map((node) => node.nodeId)).size === nodes.length &&
        new Set(nodes.map((node) => node.contractAddress)).size === nodes.length
          ? operation(
              "conditional",
              [
                "GET /api/v1/deployments/{id}/swap-quote with amountStroops and nodeId when several Swap nodes exist. Live getters determine assets, router and slippage; no caller-selected pairs or routes.",
                "Requires the configured network router, liquidity and shared Redis in production. Fresh estimates cover only the selected node, never the entire flow or guaranteed output. Final preparation, simulation and execution remain authoritative.",
                "Hosted testnet quote-versus-execution verification remains pending; metadata identifies candidates, not verified hosted support.",
              ],
              nodes.filter((node) => node.templateKind === "SWAPPER").map((node) => node.nodeId),
            )
          : operation("unsupported", [
              "Requires a valid deployment snapshot containing a standard Swap node.",
            ]),
      scheduleState: scheduleValid
        ? operation(
            "supported",
            [
              "Read /schedule/state for current controller, token, pause permissions, holding balance and vested payout availability. Select nodeId when several Schedule nodes exist; reads are uncached and fail closed.",
            ],
            scheduleNodes.map((node) => node.nodeId),
          )
        : operation("unsupported", ["Requires a valid deployed STREAMER node."]),
      scheduleControls: scheduleValid
        ? operation(
            "conditional",
            [
              "Prepare /schedule/pause, /schedule/resume or /schedule/retrieve, sign the unchanged envelope with the current controller account wallet, then /submit. The token grants API access, not wallet authorization.",
              "Live permissions and state are checked before preparation and first submission. Retrieval requires a paused permitted Schedule; funds return only to its contract-configured controller. Contract controllers requiring address credentials are unsupported.",
              "Only one unresolved intent per node is permitted, including funding. Reconcile the matching action intent before replacement; UNKNOWN, queue rejection or elapsed wall-clock time does not authorize another envelope. Hosted testnet verification remains pending.",
            ],
            scheduleNodes.map((node) => node.nodeId),
          )
        : operation("unsupported", ["Requires a valid deployed STREAMER node."]),
      subscriptionState: stateCandidate
        ? operation(
            "supported",
            [
              "Read /api/v1/deployments/{id}/subscription/state for live subscriber, token, allowance and cancellation state. This deployment token permits reading, not wallet approval or cancellation.",
              "Token contract addresses are authoritative; RPC failures are reported as errors.",
            ],
            [head!.nodeId],
          )
        : operation("unsupported", [
            "Requires an unambiguous subscription-headed deployment; payroll and malformed snapshots are refused.",
          ]),
      subscriptionCancel: operation(
        stateCandidate ? "conditional" : "unsupported",
        [
          "Use subscription/cancel/prepare, sign with the currently configured subscriber, then submit the identical envelope. Requires an active subscription; cancellation revokes its allowance without charging. Recover an existing intent through subscription/cancel/reconcile before replacement.",
          "Deployment bearer token is also required for every route. live state, consent and simulation determine eligibility.",
        ],
        stateCandidate ? [head!.nodeId] : [],
        "subscriber_wallet",
      ),
      subscriptionReactivate: operation(
        stateCandidate ? "conditional" : "unsupported",
        [
          "Use subscription/reactivate/prepare, sign with the currently configured subscriber, then submit the identical envelope. Requires a cancelled subscription; reactivation does not grant allowance, change billing, create a subscriber or immediately charge. Approve allowance separately. Recover through subscription/reactivate/reconcile before replacement.",
          "Deployment bearer token is also required for every route. live state, consent and simulation determine eligibility.",
        ],
        stateCandidate ? [head!.nodeId] : [],
        "subscriber_wallet",
      ),
      subscriptionAllowance: allowanceCandidate
        ? operation(
            "conditional",
            [
              "Use the subscription allowance state/preparation endpoint or hosted allowance page. It verifies subscription classification and current on-chain configuration.",
              "Only the configured subscriber can sign approval; a different wallet does not create a new subscription. Subscriber setup and an active subscription are required. Approval grants allowance; it does not immediately charge or pay.",
            ],
            [],
            "subscriber_wallet",
          )
        : operation(
            "unsupported",
            [
              "Wallet-only subscription approval requires a subscription deployment; payroll and schedule flows use separate workflows.",
            ],
            [],
            "subscriber_wallet",
          ),
    },
  };
}
