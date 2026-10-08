import "server-only";
import type { Deployment } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
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

/** Only paths that could pass a deposit immediately; values remain live checks. */
function payoutCandidates(nodes: z.infer<typeof PipelineSchema>, graph: FlowGraph | null) {
  const head = nodes[0];
  if (!graph?.devMode || !head || head.templateKind !== "DEPOSIT_TRIGGER") return [];
  const deployed = new Map(nodes.map((node) => [node.nodeId, node]));
  const blocks = new Map(graph.nodes.map((node) => [node.id, node]));
  if (blocks.get(head.nodeId)?.type !== "on_receive") return [];
  const visited = new Set<string>();
  const queue = [head.nodeId];
  const candidates: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const contract = deployed.get(id);
    const block = blocks.get(id);
    if (!contract || !block) continue;
    if (contract.templateKind === "PAYER_DEV" && block.type === "pay") {
      if (block.config.payoutMode !== "fiat") candidates.push(id);
      continue;
    }
    const immediate =
      (id === head.nodeId && block.type === "on_receive") ||
      (["SPLITTER", "SPLITTER_DEV"].includes(contract.templateKind) && block.type === "split") ||
      (contract.templateKind === "ROUTER" &&
        block.type === "condition" &&
        ["amount_gt", "amount_lt"].includes(block.config.kind));
    if (!immediate) continue;
    if (contract.templateKind === "ROUTER") {
      const targets = conditionBranchTargets(graph, id);
      for (const branch of [targets.true, targets.false])
        if (branch.length === 1) queue.push(branch[0]!);
    } else {
      const targets = graph.edges.filter(
        (edge) => edge.source === id && blocks.get(edge.target)?.type !== "email_notify",
      );
      if (targets.length === 1) queue.push(targets[0]!.target);
    }
  }
  return candidates;
}

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
  const subscriptionNodes = nodes.filter((node) =>
    ["SUBSCRIPTION", "SUBSCRIPTION_DEV"].includes(node.templateKind),
  );
  let triggerType: DeploymentCapabilities["triggerType"] = "unknown";
  switch (head?.templateKind) {
    case "DEPOSIT_TRIGGER":
      triggerType = "deposit";
      break;
    case "WEBHOOK":
      triggerType = "webhook";
      break;
    case "SUBSCRIPTION":
    case "SUBSCRIPTION_DEV":
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

  // This is deliberately labelled initial snapshot metadata. In particular,
  // a Dev setter can change the asset without rewriting graphSnapshot.
  const asset =
    headBlock && "asset" in headBlock.config
      ? CapabilitiesAssetSchema.safeParse(headBlock.config.asset)
      : null;
  const releaseNodes = nodes.filter((node) => node.templateKind === "TIMELOCK_BRANCH");
  const payNodeIds = payoutCandidates(nodes, recordedGraph);
  const subscriptionTrigger = recordedGraph?.nodes.find(isTrigger);
  const allowanceCandidate =
    triggerType === "subscription" &&
    subscriptionTrigger?.type === "subscription" &&
    subscriptionNodes.length === 1 &&
    subscriptionNodes[0]?.nodeId === subscriptionTrigger.id;
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
      payouts: payNodeIds.length
        ? operation(
            "conditional",
            [
              "Requires an eligible immediate path to the selected mutable crypto Pay. Preparation checks current on-chain connectivity, balances and payment configuration; delayed or unsupported paths are refused.",
              "Recipient accounts and trustlines must exist. Pay must consume all incoming funds and have zero balance; upstream fixed Split must satisfy its balance and surplus rules.",
              "Requires functioning Redis and sequential payouts. Direct deposits, execute and other mutation paths bypass payout coordination. Sign within the 60-second envelope window; retry the same submitted envelope.",
            ],
            payNodeIds,
          )
        : operation("unsupported", [
            "Per-payment recipients require a deposit-triggered Dev flow with a deployed mutable crypto Pay on an immediate Split or amount-condition path. Standard flows use configured recipients.",
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
