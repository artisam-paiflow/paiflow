import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import {
  prepareStreamerClaimByRelayerTx,
  readStreamerAvailable,
  submitStreamerClaimByRelayerTx,
} from "@/lib/stellar/relayer";
import { withRelayerLock } from "@/lib/stellar/client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const secret = env().CRON_SECRET;
    if (secret && req.headers.get("x-cron-secret") !== secret) {
      throw new AppError("FORBIDDEN", "Bad cron secret");
    }

    const deployments = await db.deployment.findMany({
      where: { status: "CONFIRMED" },
    });

    const results: Array<{
      contractAddress: string;
      status: "claimed" | "skipped" | "failed";
      error?: string;
    }> = [];

    for (const d of deployments) {
      const pipeline = d.pipelineSnapshot as Array<{
        nodeId: string;
        contractAddress: string;
        templateKind: string;
      }> | null;

      if (!pipeline) continue;

      for (const node of pipeline) {
        if (node.templateKind !== "STREAMER") continue;

        const contractAddress = node.contractAddress;
        try {
          const available = await readStreamerAvailable(contractAddress);
          if (available <= 0) {
            results.push({ contractAddress, status: "skipped" });
            continue;
          }

          const submit = await withRelayerLock(async () => {
            const { xdr } = await prepareStreamerClaimByRelayerTx(contractAddress);
            return submitStreamerClaimByRelayerTx(xdr);
          });

          if (submit.status === "SUCCESS") {
            log.info(
              { deploymentId: d.id, contractAddress, txHash: submit.txHash },
              "Auto-claimed streamer contract",
            );
            results.push({ contractAddress, status: "claimed" });
          } else {
            log.warn(
              { deploymentId: d.id, contractAddress, error: submit.errorMessage },
              "Auto-claim simulation succeeded but submission failed",
            );
            results.push({
              contractAddress,
              status: "failed",
              error: submit.errorMessage,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // Expected cases — don't log warnings for these:
          if (message.includes("NothingToClaim") || message.includes("Paused")) {
            // No vested amount yet, or contract is paused
            results.push({ contractAddress, status: "skipped" });
          } else if (
            message.includes("non-existent contract function") ||
            message.includes("MissingValue")
          ) {
            // Old WASM that doesn't have claim
            results.push({ contractAddress, status: "skipped" });
          } else if (message.includes("Unauthorized")) {
            // Defensive parity with auto-release
            results.push({ contractAddress, status: "skipped" });
          } else if (message.includes("not sufficient to spend")) {
            // Streamer is underfunded relative to its vested amount
            results.push({ contractAddress, status: "skipped" });
          } else {
            // Truly unexpected error — log it
            log.warn({ deploymentId: d.id, contractAddress, error: message }, "Auto-claim failed");
            results.push({ contractAddress, status: "failed", error: message });
          }
        }
      }
    }

    const claimed = results.filter((r) => r.status === "claimed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      data: { claimed, skipped, failed, details: results },
    });
  });
}

export const GET = POST;
