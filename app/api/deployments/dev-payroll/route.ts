import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevApiToken } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import {
  stellarWasmHash,
  stellarRelayerAddress,
  stellarRelayerSecretKey,
  offRampTreasuryAddress,
} from "@/lib/env";
import { AssetSchema, type Asset, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { deployPipelineByRelayer, checkAccountFunding } from "@/lib/stellar/deploy";
import { ChargeRelayerMode, TemplateKind } from "@prisma/client";

// A far-future placeholder end so the machine-deployed dev payroll doesn't
// expire on its own. Recipients and any real end date are configured later via
// POST /api/deployments/:id/dev-splitter and friends.
const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;

const BodySchema = z.object({
  sourceAccount: z
    .string()
    .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar account"),
  // "USDC" | "XLM" | "native" | "CODE:ISSUER"
  asset: z.string().min(1).max(80),
  network: z.enum(["testnet", "mainnet"]),
  intervalUnit: z.enum(["day", "week", "month"]),
  intervalAmount: z.number().int().positive().max(365).default(1),
  firstPaymentAt: z.string().datetime(),
  amountPerPeriodStroops: z
    .string()
    .regex(/^\d+$/, "Amount must be a positive integer string")
    .refine((s) => BigInt(s) > 0n, "Amount must be greater than zero"),
  label: z.string().min(1).max(80).optional(),
});

/**
 * Parse the API `asset` string into the flow-graph {@link Asset} shape.
 *  - "XLM" / "native"      → native XLM
 *  - "USDC"                → the known USDC asset
 *  - "CODE:ISSUER"         → a custom asset (validated by AssetSchema)
 */
function parseAsset(input: string): Asset {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (upper === "XLM" || upper === "NATIVE") {
    return AssetSchema.parse({ kind: "native" });
  }
  if (upper === "USDC") {
    return AssetSchema.parse({ kind: "known", symbol: "USDC" });
  }
  const [code, issuer] = trimmed.split(":");
  if (code && issuer) {
    return AssetSchema.parse({ kind: "custom", code, issuer });
  }
  throw new AppError(
    "VALIDATION",
    `Unsupported asset "${input}". Use "XLM", "USDC", or "CODE:ISSUER".`,
  );
}

/**
 * Deploy a dev-mode payroll pipeline (SUBSCRIPTION_DEV → SPLITTER_DEV) for a
 * machine caller. The relayer signs and submits the deployment; recipients,
 * fiat sinks and cash-out are configured afterwards via the dev-* endpoints.
 *
 * Auth: a per-developer API token (`x-dev-api-secret` header) that maps to the
 * Pinkraft user who will own the deployment.
 */
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireDevApiToken(req);
    const rl = await rateLimit(`dev-payroll:${user.id}`, 10, 60);
    if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many dev-payroll deploys");

    const body = BodySchema.parse(await req.json());

    const network = env().STELLAR_NETWORK;
    if (body.network !== network) {
      throw new AppError(
        "VALIDATION",
        `Network mismatch: requested ${body.network} but this backend is pinned to ${network}.`,
      );
    }

    const relayerAddress = stellarRelayerAddress();
    if (!relayerAddress || !stellarRelayerSecretKey()) {
      throw new AppError(
        "INTERNAL",
        "STELLAR_RELAYER_ADDRESS / STELLAR_RELAYER_SECRET_KEY must be configured to deploy dev-payroll flows.",
      );
    }

    const asset = parseAsset(body.asset);
    const startTs = Math.floor(new Date(body.firstPaymentAt).getTime() / 1000);
    const endTs = startTs + TEN_YEARS_SECONDS;

    // Build a synthetic dev-mode flow: a subscription trigger (employer pull)
    // forwarding to a split action with no recipients yet. `flowToPipeline`
    // decomposes this into SUBSCRIPTION_DEV → SPLITTER_DEV. Recipients stay
    // empty; the caller fills them via POST /api/deployments/:id/dev-splitter.
    const triggerId = "sub";
    const splitId = "split";
    const graph: FlowGraph = {
      devMode: true,
      nodes: [
        {
          id: triggerId,
          type: "subscription",
          config: {
            asset,
            subscriber: body.sourceAccount,
            amountPerPeriodStroops: body.amountPerPeriodStroops,
            intervalAmount: body.intervalAmount,
            intervalUnit: body.intervalUnit,
          },
        },
        {
          id: splitId,
          type: "split",
          config: { asset, recipients: [] },
        },
      ],
      edges: [{ id: `${triggerId}-${splitId}`, source: triggerId, target: splitId }],
    };

    const pipeline = flowToPipeline(graph, relayerAddress, offRampTreasuryAddress());

    // Honor the requested first-payment / interval on-chain. The subscription
    // decomposition otherwise starts "now"; override the schedule window.
    for (const node of pipeline) {
      if (
        node.templateKind === TemplateKind.SUBSCRIPTION_DEV &&
        node.params.kind === "subscription_dev_trigger"
      ) {
        node.params.startTs = startTs;
        node.params.endTs = endTs;
      }
    }

    // Every node needs an uploaded WASM template on this network.
    const deployNodes = pipeline.map((node) => {
      const wasmHash = stellarWasmHash(node.templateKind);
      if (!wasmHash) {
        throw new AppError(
          "VALIDATION",
          `No WASM uploaded for ${node.templateKind} on ${network}. Run pnpm contracts:upload --network=${network}.`,
        );
      }
      return {
        nodeId: node.nodeId,
        templateKind: node.templateKind,
        wasmHash,
        params: node.params,
      };
    });

    // The relayer is the fee payer / deployer; make sure it can pay.
    await checkAccountFunding(relayerAddress);

    // Persist a Flow (owner = mapped token user) so the deployment satisfies its
    // required foreign keys and the auto-charge cron (which filters on
    // templateKind = PAYROLL) picks it up.
    const flow = await db.flow.create({
      data: {
        ownerId: user.id,
        name: body.label ?? "Dev payroll",
        templateKind: TemplateKind.PAYROLL,
        graph: graph as object,
        parameters: {},
      },
    });

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
      const result = await deployPipelineByRelayer({ graph, nodes: deployNodes });
      if (result.status !== "SUCCESS") {
        throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "Deployment failed on-chain");
      }

      const subscriptionNode = result.pipeline.find(
        (p) => p.templateKind === TemplateKind.SUBSCRIPTION_DEV,
      );
      const splitterNode = result.pipeline.find(
        (p) => p.templateKind === TemplateKind.SPLITTER_DEV,
      );

      const confirmed = await db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: "CONFIRMED",
          deployTxHash: result.txHash,
          contractAddress: subscriptionNode?.contractAddress ?? null,
          pipelineSnapshot: result.pipeline as object,
          confirmedAt: new Date(),
          // The relayer is the platform charger; enable auto-charge from the
          // first payment date onward.
          chargeRelayerMode: ChargeRelayerMode.PLATFORM,
          chargeRelayerAddress: relayerAddress,
          nextChargeAt: new Date(Math.max(startTs, Math.floor(Date.now() / 1000)) * 1000),
          chargeEndAt: new Date(endTs * 1000),
        },
      });

      await audit({
        action: "DEPLOY_DEV_PAYROLL",
        userId: user.id,
        metadata: { deploymentId: deployment.id, txHash: result.txHash, network },
      });

      return NextResponse.json({
        data: {
          deploymentId: confirmed.id,
          status: "CONFIRMED" as const,
          network,
          subscriptionDevContractAddress: subscriptionNode?.contractAddress ?? null,
          splitterDevContractAddress: splitterNode?.contractAddress ?? null,
          createdAt: confirmed.createdAt.toISOString(),
        },
      });
    } catch (err) {
      // Any failure after the row exists marks it FAILED. The success path
      // returns above and never reaches here.
      await db.deployment
        .update({
          where: { id: deployment.id },
          data: { status: "FAILED", errorMessage: (err as Error).message },
        })
        .catch(() => {});
      throw err;
    }
  });
}
