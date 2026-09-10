import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { env, soroswapRouterAddress, SWAP_ROUTER_UNSET_MESSAGE } from "@/lib/env";
import { FlowGraphSchema, getPendingLabels } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToPipeline } from "@/lib/flows/to-params";
import { preparePipelineDeployTx, checkAccountFunding } from "@/lib/stellar/deploy";
import { getWasmHashes } from "@/lib/stellar/config";
import { stellarRelayerAddress, offRampTreasuryAddress } from "@/lib/env";
import { Role, TemplateKind } from "@prisma/client";

/**
 * Template kinds a SANDBOX session may deploy: every on-chain move in these is
 * signed by the visitor's own wallet, so none of them can draw on the
 * server-held relayer key. Anything else is refused above.
 */
const SANDBOX_TEMPLATE_KINDS: TemplateKind[] = [
  TemplateKind.SWAPPER,
  TemplateKind.SPLITTER,
  TemplateKind.PAYER,
  TemplateKind.DEPOSIT_TRIGGER,
];

const PrepareSchema = z.object({
  flowId: z.string().uuid(),
  sourceAccount: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar account"),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`deploy:${user.id}`, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many deploys");

    const body = PrepareSchema.parse(await req.json());
    const network = env().STELLAR_NETWORK;

    const flow = await db.flow.findFirst({
      where: { id: body.flowId, ownerId: user.id },
    });
    if (!flow) throw new AppError("NOT_FOUND", "Flow not found");

    const graph = FlowGraphSchema.parse(flow.graph);
    const v = validateFlow(graph);
    if (!v.ok) {
      throw new AppError(
        "VALIDATION",
        "Flow is invalid",
        Object.fromEntries(v.errors.map((e) => [e.path, [e.message]])),
      );
    }

    // Dev-mode flows are allowed to deploy with blank (pending) recipients —
    // that is the whole point: deploy now, fill the values via the API later.
    // The mutable contracts deploy "not yet configured" and guard execution.
    const pending = getPendingLabels(graph);
    if (!graph.devMode && pending.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Cannot deploy: these recipients need Stellar addresses first: ${pending.join(", ")}. Resolve them in the flow editor before deploying.`,
      );
    }

    // A sandbox identity is disposable and needs no account, so it must not be
    // able to create a deployment the platform later signs for. SUBSCRIPTION,
    // PAYROLL, CASH_OUT and STREAMER pipelines are picked up by the
    // `cron/auto-charge-*`, `auto-release` and `process-*-jobs` jobs, which
    // select on status and template kind alone and then sign with
    // STELLAR_RELAYER_SECRET_KEY. Restrict the sandbox to the kinds whose every
    // on-chain move is signed by the visitor's own wallet.
    if (user.role === Role.SANDBOX && !SANDBOX_TEMPLATE_KINDS.includes(v.templateKind)) {
      throw new AppError(
        "FORBIDDEN",
        `The sandbox can deploy swap and split flows only. This flow is a ${v.templateKind} pipeline, which runs on Paiflow's scheduled signer — sign in with a full account to deploy it.`,
      );
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

    const pipeline = flowToPipeline(v.graph, relayerAddress, offRampTreasuryAddress());

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
      };
    });

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
        graph,
        nodes: deployNodes,
      });

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
}
