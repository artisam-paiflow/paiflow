import { NextResponse } from "next/server";
import { rpc } from "@stellar/stellar-sdk";
import { audit, wasTxConfirmedFor } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import {
  assertDepositEnvelope,
  explainFailedTx,
  ingestEventsBounded,
  resolveSwapperPipeline,
  waitForFinal,
} from "@/lib/api/v1/execute";
import {
  ExecuteSubmitQuerySchema,
  ExecuteSubmitSchema,
  type ExecuteSubmitted,
} from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { recordSignedTransaction } from "@/lib/signed-tx";
import { sorobanRpc } from "@/lib/stellar/client";
import { signerFromTransaction } from "@/lib/stellar/signer";

const rpcFailed = () => new AppError("UPSTREAM_RPC", "The Soroban RPC request failed; try again");

async function viaRpc<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn({ err }, "v1 execute submit: RPC call failed");
    throw rpcFailed();
  }
}

/**
 * Submit a signed deposit that executes a swapper flow, wait for it to be
 * final, ingest its events and record it.
 *
 * Idempotent on the hash of the signed envelope: the chain is asked first, and
 * an envelope it already knows is answered from there instead of sent again,
 * so resubmitting the same body is also how a caller checks a PENDING result.
 */
export const POST = v1Route(
  { rateLimit: V1_RATE_LIMITS.executeSubmit },
  async ({ req, params, token, deployment }) => {
    const input = ExecuteSubmitSchema.parse(
      await req.json().catch(() => {
        throw new AppError("VALIDATION", "Request body must be valid JSON");
      }),
    );
    const { wait } = ExecuteSubmitQuerySchema.parse({
      wait: new URL(req.url).searchParams.get("wait") ?? undefined,
    });
    const { nodes, triggerAddress } = resolveSwapperPipeline(deployment);
    const tx = assertDepositEnvelope(input.signedXdr, triggerAddress);
    const txHash = tx.hash().toString("hex");
    const signer = signerFromTransaction(tx);

    const ip = clientIp(req);
    const record = {
      deploymentId: params.id,
      tokenId: token.id,
      txHash,
      signerAddress: signer.ok ? signer.signerAddress : null,
    };
    // The partner signs with its own key and has no session; the token's
    // owner is not the signer, so no user is attached. Upsert on the hash, so
    // the resubmit-to-poll pattern this route documents adds no second row.
    await recordSignedTransaction({
      signer,
      kind: "API_EXECUTE",
      network: deployment.network,
      userId: null,
      deploymentId: params.id,
      ip,
    });
    const respond = (data: ExecuteSubmitted) => NextResponse.json({ data });

    const server = sorobanRpc();
    let got = await viaRpc(() => server.getTransaction(txHash));

    if (got.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      const send = await viaRpc(() => server.sendTransaction(tx));

      if (send.status === "ERROR") {
        const error = await explainFailedTx(
          { resultXdr: send.errorResult, diagnosticEventsXdr: send.diagnosticEvents },
          nodes,
        );
        return respond({ txHash, status: "FAILED", error });
      }
      if (send.status === "TRY_AGAIN_LATER") {
        throw new AppError(
          "UPSTREAM_RPC",
          "The network is busy and did not accept the transaction; submit the same envelope again",
        );
      }
      // DUPLICATE: an earlier submit already sent it and wrote the row.
      if (send.status === "PENDING") {
        await audit({
          action: "API_EXECUTE_SUBMITTED",
          userId: deployment.ownerId,
          ip,
          metadata: record,
        });
      }

      if (!wait) return respond({ txHash, status: "PENDING" });
      got = await viaRpc(() => waitForFinal(txHash));
    }

    if (got.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      // A lookup failure writes a possible duplicate row rather than none.
      const alreadyConfirmed = await wasTxConfirmedFor(params.id, txHash).catch(() => false);
      if (!alreadyConfirmed) {
        await ingestEventsBounded(params.id, txHash);
        await audit({
          action: "API_EXECUTE_CONFIRMED",
          userId: deployment.ownerId,
          ip,
          metadata: { ...record, ledger: got.ledger },
        });
      }
      return respond({ txHash, status: "SUCCESS", ledger: got.ledger });
    }

    if (got.status === rpc.Api.GetTransactionStatus.FAILED) {
      const error = await explainFailedTx(got, nodes);
      return respond({ txHash, status: "FAILED", ledger: got.ledger, error });
    }

    return respond({ txHash, status: "PENDING" });
  },
);
