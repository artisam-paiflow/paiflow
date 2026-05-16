import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { FlowGraphSchema, getPendingLabels } from "@/lib/flows/schema";
import { validateFlow } from "@/lib/flows/validate";
import { flowToParams } from "@/lib/flows/to-params";
import { prepareDeployTx } from "@/lib/stellar/deploy";
import { assertMainnetAllowed } from "@/lib/mainnet";

const PrepareSchema = z.object({
  flowId: z.string().uuid(),
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  sourceAccount: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar account"),
  confirmation: z.string().optional(),
});

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    const rl = await rateLimit(`deploy:${user.id}`, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many deploys");

    const body = PrepareSchema.parse(await req.json());
    assertMainnetAllowed({
      network: body.network,
      userId: user.id,
      confirmation: body.confirmation,
    });

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

    const pending = getPendingLabels(graph);
    if (pending.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Cannot deploy: these recipients need Stellar addresses first: ${pending.join(", ")}. Resolve them in the flow editor before deploying.`,
      );
    }

    const params = flowToParams(v.graph, v.templateKind);

    const template = await db.contractTemplate.findFirst({
      where: { kind: v.templateKind, network: body.network },
    });
    if (!template) {
      throw new AppError(
        "VALIDATION",
        `No WASM uploaded for ${v.templateKind} on ${body.network}. Run pnpm contracts:upload.`,
      );
    }

    const deployment = await db.deployment.create({
      data: {
        flowId: flow.id,
        ownerId: user.id,
        network: body.network,
        status: "BUILDING",
        graphSnapshot: graph as object,
        paramsSnapshot: params as object,
        sourceAccount: body.sourceAccount,
      },
    });

    try {
      const prepared = await prepareDeployTx({
        wasmHash: template.wasmHash,
        sourceAccount: body.sourceAccount,
        params,
      });
      await db.deployment.update({
        where: { id: deployment.id },
        data: { status: "PENDING_SIGNATURE", unsignedXdr: prepared.xdr },
      });
      await audit({
        action: "DEPLOY_PREPARE",
        userId: user.id,
        metadata: { deploymentId: deployment.id, network: body.network },
      });
      return NextResponse.json({
        data: {
          deploymentId: deployment.id,
          xdr: prepared.xdr,
          expectedContractAddress: prepared.contractAddress,
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
