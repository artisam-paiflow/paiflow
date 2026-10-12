import "server-only";
import { randomUUID } from "node:crypto";
import type { Deployment } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import { env, soroswapRouterAddress } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { simulateGetter } from "@/lib/stellar/contract-read";
import { readSoroswapContractQuote } from "@/lib/stellar/soroswap";
import { SwapQuoteSchema, type SwapQuoteQuery, type SwapQuote } from "./swap-quote-schema";
import { V1_RATE_LIMITS } from "./limits";

const PipelineSchema = z
  .array(
    z.object({
      nodeId: z.string().min(1),
      contractAddress: z.string().refine(StrKey.isValidContract),
      templateKind: z.string().min(1),
    }),
  )
  .min(1)
  .refine(
    (nodes) =>
      new Set(nodes.map((n) => n.nodeId)).size === nodes.length &&
      new Set(nodes.map((n) => n.contractAddress)).size === nodes.length,
  );

export async function deploymentSwapQuote(
  deployment: Pick<Deployment, "id" | "status" | "network" | "pipelineSnapshot">,
  query: SwapQuoteQuery,
): Promise<SwapQuote> {
  const network = env().STELLAR_NETWORK;
  if (deployment.status !== "CONFIRMED")
    throw new AppError("NOT_FOUND", "Deployment not confirmed");
  if (deployment.network !== network)
    throw new AppError("VALIDATION", "Deployment network does not match this environment");
  const parsed = PipelineSchema.safeParse(deployment.pipelineSnapshot);
  if (!parsed.success)
    throw new AppError("VALIDATION", "Deployment has an invalid pipeline snapshot");
  const matches = parsed.data.filter(
    (n) => n.templateKind === "SWAPPER" && (!query.nodeId || n.nodeId === query.nodeId),
  );
  if (matches.length !== 1)
    throw new AppError(
      "VALIDATION",
      matches.length > 1
        ? "Multiple Swap nodes exist; pass nodeId to select one"
        : "No supported deployed Swap matches this node",
    );
  const node = matches[0]!;
  const configuredRouter = soroswapRouterAddress();
  if (!configuredRouter)
    throw new AppError("VALIDATION", "Swap quoting is not configured on this network");
  // Deployment-wide budget across tokens/replicas, like transaction-status reads.
  // Fixed work: four configuration getters and at most five pool/router calls.
  const budget = await rateLimit(
    `v1:swap-quote-rpc:${network}:${deployment.id}`,
    V1_RATE_LIMITS.swapQuote.limit,
    V1_RATE_LIMITS.swapQuote.windowSeconds,
  );
  if (!budget.ok) throw rateLimitedError(budget);
  if (!budget.shared && env().NODE_ENV === "production")
    throw new AppError("UPSTREAM_RPC", "Shared quote limiter unavailable; retry later");
  const context = { requestId: randomUUID() };
  const readStartedAt = new Date().toISOString();
  const [inId, outId, routerAddress, slippageBps] = await Promise.all(
    ["asset_in", "asset_out", "router", "slippage_bps"].map((name) =>
      simulateGetter(node.contractAddress, name, context),
    ),
  );
  if (
    typeof inId !== "string" ||
    !StrKey.isValidContract(inId) ||
    typeof outId !== "string" ||
    !StrKey.isValidContract(outId) ||
    typeof routerAddress !== "string" ||
    !StrKey.isValidContract(routerAddress) ||
    typeof slippageBps !== "number" ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps > 10_000
  )
    throw new AppError("UPSTREAM_RPC", "Deployed Swap returned unusable configuration");
  if (inId === outId || routerAddress !== configuredRouter)
    throw new AppError(
      "VALIDATION",
      "Deployed Swap assets or router are not supported by this environment",
    );
  const quote = await readSoroswapContractQuote(
    { inId, outId, routerAddress, amountStroops: query.amountStroops, slippageBps },
    context,
  );
  return SwapQuoteSchema.parse({
    deploymentId: deployment.id,
    network,
    nodeId: node.nodeId,
    contractAddress: node.contractAddress,
    assetInContractAddress: inId,
    assetOutContractAddress: outId,
    ...quote,
    amountInStroops: query.amountStroops,
    slippageBps,
    readStartedAt,
    quotedAt: new Date().toISOString(),
    freshness: "live",
    estimate: true,
    scope: "selected_node",
    meetsMinimumAtQuote: BigInt(quote.amountOutStroops) >= BigInt(quote.amountOutMinStroops),
  });
}
