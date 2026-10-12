import "server-only";
import type { Deployment } from "@prisma/client";
import { scValToNative, StrKey } from "@stellar/stellar-sdk";
import { BalancePipelineSnapshotSchema } from "@/lib/pipeline-snapshot";
import { env, stellarPassphrase } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { sorobanRpc } from "@/lib/stellar/client";
import { simulateGetter } from "@/lib/stellar/contract-read";
import { readStreamerConfig } from "@/lib/stellar/streamer-config";
import {
  prepareStreamerTopUpInvocation,
  prepareWebhookDepositInvocation,
} from "@/lib/stellar/invoke";
import { createControlIntent, readControlIntent, parseControlTransaction } from "./control-intent";
import {
  FundingPrepareSchema,
  FundingDiscoverySchema,
  FundingPreparedSchema,
  type FundingActionSchema,
} from "./funding-schema";
import type { z } from "zod";
import { linkApiTransaction } from "@/lib/api/request-history/context";

type FundingDeployment = Pick<Deployment, "id" | "network" | "status" | "pipelineSnapshot">;
export function fundingNodes(deployment: FundingDeployment) {
  if (deployment.network !== env().STELLAR_NETWORK || deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment unavailable on this network");
  const parsed = BalancePipelineSnapshotSchema.safeParse(deployment.pipelineSnapshot);
  if (!parsed.success) throw new AppError("VALIDATION", "Invalid or ambiguous deployment pipeline");
  const candidates = parsed.data.filter(
    (n) => n.templateKind === "STREAMER" || n.templateKind === "WEBHOOK",
  );
  if (candidates.length > 16)
    throw new AppError("VALIDATION", "Funding supports at most sixteen candidate nodes");
  return candidates;
}
export function fundingNode(deployment: FundingDeployment, nodeId?: string) {
  const nodes = fundingNodes(deployment).filter((n) => !nodeId || n.nodeId === nodeId);
  if (nodes.length !== 1)
    throw new AppError("VALIDATION", "Select exactly one supported funding node with nodeId");
  return nodes[0]!;
}
function actionOf(node: ReturnType<typeof fundingNode>): z.infer<typeof FundingActionSchema> {
  return node.templateKind === "STREAMER" ? "schedule.fund" : "webhook.fund";
}
export async function fundingAsset(node: ReturnType<typeof fundingNode>) {
  const asset: unknown =
    node.templateKind === "STREAMER"
      ? (await readStreamerConfig(node.contractAddress)).asset
      : await simulateGetter(node.contractAddress, "asset");
  if (typeof asset !== "string" || !StrKey.isValidContract(asset))
    throw new AppError("UPSTREAM_RPC", "Funding asset could not be verified");
  return asset;
}
export async function discoverFunding(deployment: FundingDeployment) {
  const nodes = fundingNodes(deployment);
  if (!nodes.length || nodes.length > 16)
    throw new AppError(
      "VALIDATION",
      "Funding discovery supports between one and sixteen candidate nodes",
    );
  const results: z.infer<typeof FundingDiscoverySchema>["nodes"] = [];
  // Bound live getter concurrency; never issue a pipeline-sized simulation burst.
  for (let offset = 0; offset < nodes.length; offset += 4) {
    results.push(
      ...(await Promise.all(
        nodes.slice(offset, offset + 4).map(async (node) => ({
          ...node,
          templateKind: node.templateKind as "STREAMER" | "WEBHOOK",
          action: actionOf(node),
          tokenContractAddress: await fundingAsset(node),
          authorization: "funding_wallet" as const,
          effect: "Adds funds only; does not execute a payout or Webhook callback",
        })),
      )),
    );
  }
  return FundingDiscoverySchema.parse({
    deploymentId: deployment.id,
    network: deployment.network,
    nodes: results,
  });
}
export async function prepareFunding(
  deployment: FundingDeployment,
  input: z.infer<typeof FundingPrepareSchema>,
) {
  const node = fundingNode(deployment, input.nodeId);
  const asset = await fundingAsset(node);
  if (asset !== input.tokenContractAddress)
    throw new AppError("VALIDATION", "Requested asset does not match the deployed funding asset");
  const ledger = await sorobanRpc().getLatestLedger();
  const action = actionOf(node);
  const { xdr } =
    action === "schedule.fund"
      ? await prepareStreamerTopUpInvocation({
          contractAddress: node.contractAddress,
          amount: input.amountStroops,
          invokerAddress: input.fromAddress,
        })
      : await prepareWebhookDepositInvocation({
          contractAddress: node.contractAddress,
          amount: input.amountStroops,
          from: input.fromAddress,
        });
  const prepared = parseControlTransaction(xdr);
  const op = prepared.operations[0];
  if (
    op?.type !== "invokeHostFunction" ||
    op.func.switch().name !== "hostFunctionTypeInvokeContract" ||
    op.func.invokeContract().args().length !== 2 ||
    op.func.invokeContract().args()[1]!.switch().name !== "scvI128" ||
    String(scValToNative(op.func.invokeContract().args()[1]!)) !== input.amountStroops
  )
    throw new AppError("VALIDATION", "Prepared funding amount does not match the request");
  const intent = await createControlIntent({
    deployment,
    nodeId: node.nodeId,
    action,
    walletAddress: input.fromAddress,
    unsignedXdr: xdr,
    preparationLedger: ledger.sequence,
  });
  linkApiTransaction(intent.txHash);
  return FundingPreparedSchema.parse({
    ...intent,
    xdr,
    action,
    nodeId: node.nodeId,
    fromAddress: input.fromAddress,
    tokenContractAddress: asset,
    amountStroops: input.amountStroops,
    network: deployment.network,
    networkPassphrase: stellarPassphrase(),
  });
}
export async function assertFundingEligible(
  deployment: FundingDeployment,
  id: string,
  action: z.infer<typeof FundingActionSchema>,
) {
  const intent = await readControlIntent(id, deployment.id, action);
  const node = fundingNode(deployment, intent.nodeId);
  if (node.contractAddress !== intent.contractAddress || actionOf(node) !== action)
    throw new AppError("VALIDATION", "Funding preparation no longer matches deployment");
  // Assets are immutable for these supported contracts. Simulation and the exact envelope
  // commit the actual transfer; no caller-supplied replacement asset or amount reaches submit.
  await fundingAsset(node);
}
