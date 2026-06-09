import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { AppError, withErrorHandler } from "@/lib/errors";
import { prepareReleaseByRelayerTx, submitReleaseByRelayerTx } from "@/lib/stellar/relayer";

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
      status: "released" | "skipped" | "failed";
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
        if (node.templateKind !== "TIMELOCK") continue;

        const contractAddress = node.contractAddress;
        try {
          const { xdr, txHash } = await prepareReleaseByRelayerTx(contractAddress);
          const submit = await submitReleaseByRelayerTx(xdr);

          if (submit.status === "SUCCESS") {
            log.info(
              { deploymentId: d.id, contractAddress, txHash },
              "Auto-released timelock contract",
            );
            results.push({ contractAddress, status: "released" });
          } else {
            log.warn(
              { deploymentId: d.id, contractAddress, error: submit.errorMessage },
              "Auto-release simulation succeeded but submission failed",
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
          if (message.includes("ConditionNotMet") || message.includes("NothingToRelease")) {
            // Time hasn't passed yet or no funds to release
            results.push({ contractAddress, status: "skipped" });
          } else if (
            message.includes("non-existent contract function") ||
            message.includes("MissingValue")
          ) {
            // Old WASM that doesn't have release_by_relayer
            results.push({ contractAddress, status: "skipped" });
          } else if (message.includes("Unauthorized")) {
            // Contract deployed without a dedicated relayer (relayer == admin)
            results.push({ contractAddress, status: "skipped" });
          } else {
            // Truly unexpected error — log it
            log.warn(
              { deploymentId: d.id, contractAddress, error: message },
              "Auto-release simulation failed",
            );
            results.push({ contractAddress, status: "failed", error: message });
          }
        }
      }
    }

    const released = results.filter((r) => r.status === "released").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      data: { released, skipped, failed, details: results },
    });
  });
}

export const GET = POST;
