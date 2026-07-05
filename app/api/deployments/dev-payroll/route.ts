import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StrKey, Keypair } from "@stellar/stellar-sdk";
import { db } from "@/lib/db";
import { requireDevApiToken } from "@/lib/auth";
import { AppError, withErrorHandler } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { stellarRelayerAddress, stellarRelayerSecretKey, offRampTreasuryAddress } from "@/lib/env";
import { getWasmHashes } from "@/lib/stellar/config";
import { AssetSchema, type Asset, type FlowGraph } from "@/lib/flows/schema";
import { flowToPipeline } from "@/lib/flows/to-params";
import { deployPipelineByRelayer, checkAccountFunding } from "@/lib/stellar/deploy";
import { ChargeRelayerMode, TemplateKind } from "@prisma/client";

// A far-future placeholder end so the machine-deployed dev payroll doesn't
// expire on its own. Recipients and any real end date are configured later via
// POST /api/deployments/:id/dev-splitter and friends.
const TEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 10;
// If a BUILDING row is older than this we assume the previous deploy worker
// crashed before any on-chain success and allow a retry with the same
// idempotency key.
const BUILDING_TIMEOUT_MS = 5 * 60 * 1000;

const BodySchema = z.object({
  // Required client-supplied key that makes this deploy idempotent per owner. A
  // retry with the same key returns the existing deployment rather than paying
  // to deploy a second, independent set of contracts.
  idempotencyKey: z.string().min(8).max(255),
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
  const [rawCode, rawIssuer] = trimmed.split(":");
  const code = rawCode?.trim();
  const issuer = rawIssuer?.trim();
  if (code && issuer) {
    return AssetSchema.parse({ kind: "custom", code, issuer });
  }
  throw new AppError(
    "VALIDATION",
    `Unsupported asset "${input}". Use "XLM", "USDC", or "CODE:ISSUER".`,
  );
}

/** Read a node's deployed contract address out of a stored pipeline snapshot. */
function pipelineAddress(snapshot: unknown, kind: TemplateKind): string | null {
  if (!Array.isArray(snapshot)) return null;
  const node = snapshot.find(
    (p) =>
      p != null && typeof p === "object" && (p as { templateKind?: unknown }).templateKind === kind,
  ) as { contractAddress?: unknown } | undefined;
  return typeof node?.contractAddress === "string" ? node.contractAddress : null;
}

/** Shape the JSON response from a Deployment row (used by fresh + replay). */
function deploymentResponse(d: {
  id: string;
  status: string;
  network: string;
  pipelineSnapshot: unknown;
  createdAt: Date;
}) {
  return {
    deploymentId: d.id,
    status: d.status,
    network: d.network,
    subscriptionDevContractAddress: pipelineAddress(
      d.pipelineSnapshot,
      TemplateKind.SUBSCRIPTION_DEV,
    ),
    splitterDevContractAddress: pipelineAddress(d.pipelineSnapshot, TemplateKind.SPLITTER_DEV),
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * Deploy a dev-mode payroll pipeline (SUBSCRIPTION_DEV → SPLITTER_DEV) for a
 * machine caller. The relayer signs and submits the deployment; recipients,
 * fiat sinks and cash-out are configured afterwards via the dev-* endpoints.
 *
 * Auth: a per-developer API token (`x-dev-api-secret` header) that maps to the
 * Paiflow user who will own the deployment.
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

    // Idempotent replay: a retry with the same key returns the existing
    // deployment (whatever its status) instead of deploying a second,
    // independent set of contracts. To re-attempt a genuinely FAILED deploy,
    // the caller must supply a new idempotency key.
    // A stale BUILDING row means a previous worker crashed before any on-chain
    // success; recover by deleting it and its orphan flow so this request can
    // safely retry with the same key.
    const existing = await db.deployment.findUnique({
      where: {
        ownerId_idempotencyKey: { ownerId: user.id, idempotencyKey: body.idempotencyKey },
      },
    });
    if (existing) {
      if (
        existing.status === "BUILDING" &&
        Date.now() - existing.createdAt.getTime() > BUILDING_TIMEOUT_MS
      ) {
        await db.$transaction([
          db.deployment.delete({ where: { id: existing.id } }),
          db.flow.delete({ where: { id: existing.flowId } }),
        ]);
      } else {
        return NextResponse.json({ data: deploymentResponse(existing) });
      }
    }

    const relayerAddress = stellarRelayerAddress();
    const relayerSecret = stellarRelayerSecretKey();
    if (!relayerAddress || !relayerSecret) {
      throw new AppError(
        "INTERNAL",
        "STELLAR_RELAYER_ADDRESS / STELLAR_RELAYER_SECRET_KEY must be configured to deploy dev-payroll flows.",
      );
    }
    const relayerKeypair = Keypair.fromSecret(relayerSecret);
    if (relayerKeypair.publicKey() !== relayerAddress) {
      throw new AppError(
        "INTERNAL",
        "STELLAR_RELAYER_SECRET_KEY does not match STELLAR_RELAYER_ADDRESS",
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
    const wasmHashes = await getWasmHashes(network);
    const deployNodes = pipeline.map((node) => {
      const wasmHash = wasmHashes.get(node.templateKind);
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

    // Create the Flow + Deployment atomically so a DB failure never leaves an
    // orphan Flow. If a concurrent request with the same idempotency key won the
    // unique index, the transaction rolls back and we replay the winner — no
    // second deploy happens.
    let deployment: Awaited<ReturnType<typeof db.deployment.create>>;
    try {
      [, deployment] = await db.$transaction(async (tx) => {
        const flow = await tx.flow.create({
          data: {
            ownerId: user.id,
            name: body.label ?? "Dev payroll",
            templateKind: TemplateKind.PAYROLL,
            graph: graph as object,
            parameters: {},
          },
        });
        const d = await tx.deployment.create({
          data: {
            flowId: flow.id,
            ownerId: user.id,
            network,
            status: "BUILDING",
            graphSnapshot: graph as object,
            paramsSnapshot: pipeline as object,
            sourceAccount: body.sourceAccount,
            idempotencyKey: body.idempotencyKey,
          },
        });
        return [flow, d] as const;
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        const winner = await db.deployment.findUnique({
          where: {
            ownerId_idempotencyKey: { ownerId: user.id, idempotencyKey: body.idempotencyKey },
          },
        });
        if (winner) return NextResponse.json({ data: deploymentResponse(winner) });
      }
      throw err;
    }

    // Phase 1 — submit on-chain. A throw here (prepare/sign/network) means no
    // successful, fee-paying transaction was produced, so it is safe to mark
    // the row FAILED.
    let result: Awaited<ReturnType<typeof deployPipelineByRelayer>>;
    try {
      result = await deployPipelineByRelayer({ graph, nodes: deployNodes });
    } catch (err) {
      await db.deployment
        .update({
          where: { id: deployment.id },
          data: { status: "FAILED", errorMessage: (err as Error).message },
        })
        .catch(() => {});
      throw err;
    }

    // On-chain rejection: the tx was submitted but did not succeed. Record the
    // attempted hash for reconciliation, then fail.
    if (result.status !== "SUCCESS") {
      const isTimeout = result.errorMessage === "Timed out waiting for finality";
      if (isTimeout) {
        // The tx was accepted by the network but finality polling timed out.
        // Keep the row BUILDING so the idempotency key is not poisoned with a
        // false FAILED status; persist the txHash for reconciliation.
        await db.deployment
          .update({
            where: { id: deployment.id },
            data: {
              deployTxHash: result.txHash || null,
              errorMessage: result.errorMessage,
            },
          })
          .catch(() => {});
        return NextResponse.json(
          {
            data: {
              deploymentId: deployment.id,
              status: "BUILDING",
              network,
              deployTxHash: result.txHash || null,
              subscriptionDevContractAddress: null,
              splitterDevContractAddress: null,
              message: "Deployment transaction submitted; waiting for finality",
            },
          },
          { status: 202 },
        );
      }

      await db.deployment
        .update({
          where: { id: deployment.id },
          data: {
            status: "FAILED",
            deployTxHash: result.txHash || null,
            errorMessage: result.errorMessage ?? "Deployment failed on-chain",
          },
        })
        .catch(() => {});
      throw new AppError("UPSTREAM_RPC", result.errorMessage ?? "Deployment failed on-chain");
    }

    // Phase 2 — the tx SUCCEEDED on-chain and relayer fees were spent; the
    // contracts are live. From here the deploy must NEVER be recorded as FAILED:
    // any bookkeeping error below still preserves the successful tx hash and a
    // CONFIRMED status so the row can be reconciled to the real deployment.
    const subscriptionNode = result.pipeline.find(
      (p) => p.templateKind === TemplateKind.SUBSCRIPTION_DEV,
    );

    let confirmed: Awaited<ReturnType<typeof db.deployment.update>>;
    try {
      confirmed = await db.deployment.update({
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
    } catch (err) {
      // The full update failed, but the on-chain deploy succeeded. Best-effort
      // persist just the successful hash + CONFIRMED status so the row never
      // misrepresents a live deployment as FAILED, then surface the error.
      await db.deployment
        .update({
          where: { id: deployment.id },
          data: {
            status: "CONFIRMED",
            deployTxHash: result.txHash,
            contractAddress: subscriptionNode?.contractAddress ?? null,
            pipelineSnapshot: result.pipeline as object,
          },
        })
        .catch(() => {});
      throw err;
    }

    // Audit is a non-critical trail; a failure here must not mask the successful
    // deploy or flip the (already CONFIRMED) row.
    await audit({
      action: "DEPLOY_DEV_PAYROLL",
      userId: user.id,
      metadata: { deploymentId: deployment.id, txHash: result.txHash, network },
    }).catch(() => {});

    return NextResponse.json({ data: deploymentResponse(confirmed) });
  });
}
