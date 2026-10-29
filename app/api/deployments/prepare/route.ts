import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import {
  env,
  stellarPassphrase,
  soroswapRouterAddress,
  SWAP_ROUTER_UNSET_MESSAGE,
} from "@/lib/env";
import {
  FlowGraphSchema,
  migrateFlowGraph,
  sandboxNotifications,
  getPendingLabels,
} from "@/lib/flows/schema";
import { issuesToFields } from "@/lib/flows/issues-to-fields";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { preparePipelineDeployTx, checkAccountFunding } from "@/lib/stellar/deploy";
import { withInteractiveRpcBudget } from "@/lib/stellar/interactive-rpc-budget";
import { assertDeploymentPreparationBudget } from "@/lib/stellar/deployment-preparation";
import { getWasmHashes } from "@/lib/stellar/config";
import { stellarRelayerAddress, offRampTreasuryAddress } from "@/lib/env";
import { Role } from "@prisma/client";
import { SANDBOX_TEMPLATE_KINDS } from "@/lib/sandbox";
import { assertNoHiddenSurfaces, serverFeatures } from "@/lib/features";
const PrepareInputSchema = z.object({
  flowId: z.string().guid({ error: "Invalid uuid" }),
  sourceAccount: z.string().optional(),
});
const PrepareSchema = z.object({
  flowId: z.string().guid({ error: "Invalid uuid" }),
  sourceAccount: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar account"),
});
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`deploy:${user.id}`, 10, 60);
    if (!rl.ok) throw rateLimitedError(rl, "Too many deploys");
    const input = PrepareInputSchema.parse(await req.json());
    const network = env().STELLAR_NETWORK;
    const flow = await db.flow.findFirst({
      where: { id: input.flowId, ownerId: user.id },
    });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");
    const parsedGraph = FlowGraphSchema.parse(migrateFlowGraph(flow.graph));
    const graph = user.role === "SANDBOX" ? sandboxNotifications(parsedGraph) : parsedGraph;
    if (
      graph.nodes.some((node) => node.type === "return_to_owner") &&
      !StrKey.isValidEd25519PublicKey(input.sourceAccount ?? "")
    ) {
      throw new AppError("VALIDATION", "Return to owner requires the deploying wallet address");
    }
    const body = PrepareSchema.parse(input);
    // Switched-off surfaces (#722) are refused on their node here, so an old
    // flow, an AI edit or a crafted save cannot deploy a hidden block.
    const features = serverFeatures();
    const v = validateFlow(graph, { features, ignoreOwnerEmail: true });
    if (!v.ok) {
      throw new AppError("VALIDATION", "Flow is invalid", issuesToFields(v.errors));
    }
    const pending = getPendingLabels(graph);
    if (pending.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Cannot deploy: these recipients need Stellar addresses first: ${pending.join(", ")}. Resolve them in the flow editor before deploying.`,
      );
    }
    if (user.role === Role.SANDBOX) {
      const disallowed = [
        ...new Set(v.pipeline.filter((k) => !SANDBOX_TEMPLATE_KINDS.includes(k))),
      ];
      if (disallowed.length > 0) {
        throw new AppError(
          "FORBIDDEN",
          `The sandbox cannot deploy this flow: it builds ${disallowed.join(", ")} ${disallowed.length === 1 ? "contract" : "contracts"}, which run on Paiflow's own signer. The sandbox is limited to ${SANDBOX_TEMPLATE_KINDS.join(", ")} pipelines, where every on-chain move is signed by your wallet — sign in with a full account to deploy it.`,
        );
      }
    }
    const trigger = v.graph.nodes.find((n) => n.type === "web2_webhook");
    const relayerAddress = stellarRelayerAddress();
    if (trigger && !relayerAddress) {
      throw new AppError(
        "VALIDATION",
        "STELLAR_RELAYER_ADDRESS is required to deploy an HTTP Webhook flow. Set it in your environment.",
      );
    }
    if (v.graph.nodes.some((n) => n.type === "swap") && !soroswapRouterAddress()) {
      throw new AppError("VALIDATION", SWAP_ROUTER_UNSET_MESSAGE);
    }
    const pipeline = flowToPipeline(v.graph, relayerAddress, offRampTreasuryAddress(), {
      ownerAddress: body.sourceAccount,
    });
    // Second line behind the graph check above: the contract kinds actually
    // being deployed, the way the sandbox guard reads every pipeline node.
    assertNoHiddenSurfaces(
      v.graph,
      pipeline.map((n) => n.templateKind),
      features,
    );
    // Ensure every pipeline node has a corresponding WASM template on-chain.
    const wasmHashes = await getWasmHashes(network);
    const deployNodes = pipeline.map((node) => {
      const hash = wasmHashes.get(node.templateKind);
      if (!hash) {
        throw new AppError(
          "VALIDATION",
          `No WASM uploaded for ${node.templateKind} on ${network}. Run pnpm contracts:upload --network=${network}.`,
        );
      }
      return {
        nodeId: node.nodeId,
        templateKind: node.templateKind,
        wasmHash: hash,
        params: node.params,
        implementation: node.implementation,
      };
    });
    return withInteractiveRpcBudget(async () => {
      await checkAccountFunding(body.sourceAccount);
      const deployment = await db.deployment.create({
        data: {
          flowId: flow.id,
          ownerId: user.id,
          network,
          status: "BUILDING",
          graphSnapshot: graph as object,
          paramsSnapshot: pipeline as object,
          sourceAccount: body.sourceAccount,
        },
      });
      try {
        const prepared = await preparePipelineDeployTx({
          sourceAccount: body.sourceAccount,
          deploymentId: deployment.id,
          graph,
          nodes: deployNodes,
        });
        assertDeploymentPreparationBudget(deployment.id);
        // Use the trigger contract (first node) as the primary contract address.
        const triggerNode = prepared.pipeline[0];
        await db.deployment.update({
          where: { id: deployment.id },
          data: {
            status: "PENDING_SIGNATURE",
            unsignedXdr: prepared.xdr,
            contractAddress: triggerNode?.contractAddress ?? null,
            pipelineSnapshot: prepared.pipeline as object,
          },
        });
        await audit({
          action: "DEPLOY_PREPARE",
          userId: user.id,
          metadata: { deploymentId: deployment.id, network },
        });
        return NextResponse.json({
          data: {
            deploymentId: deployment.id,
            xdr: prepared.xdr,
            networkPassphrase: stellarPassphrase(network),
            expectedContractAddress: triggerNode?.contractAddress ?? null,
            pipeline: prepared.pipeline,
          },
        });
      } catch (err) {
        await db.deployment.update({
          where: { id: deployment.id },
          data: { status: "FAILED", errorMessage: (err as Error).message },
        });
        throw err;
      }
    });
  });
}
