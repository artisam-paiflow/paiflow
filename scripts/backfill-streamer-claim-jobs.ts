/**
 * One-off backfill script for issue #201.
 *
 * Creates an initial StreamerClaimJob for every STREAMER node in every
 * CONFIRMED deployment. Run this once after deploying the new schema and the
 * process-streamer-jobs cron.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/backfill-streamer-claim-jobs.ts
 */

import { PrismaClient } from "@prisma/client";
import { scheduleNextStreamerClaimJob } from "@/lib/streamer-jobs";
import type { StreamerParams } from "@/lib/flows/to-params";

const db = new PrismaClient();

type PipelineSnapshotEntry = {
  nodeId: string;
  contractAddress: string;
  templateKind: string;
};

type ParamsSnapshotEntry = {
  nodeId: string;
  templateKind: string;
  params: { kind: string } | StreamerParams;
};

async function main() {
  const deployments = await db.deployment.findMany({
    where: { status: "CONFIRMED" },
  });

  let scheduled = 0;
  let skipped = 0;

  for (const deployment of deployments) {
    const pipeline = (deployment.pipelineSnapshot as PipelineSnapshotEntry[] | null) ?? [];
    const paramsArr = (deployment.paramsSnapshot as ParamsSnapshotEntry[] | null) ?? [];

    for (const node of paramsArr) {
      if (node.templateKind !== "STREAMER" || node.params.kind !== "streamer") {
        continue;
      }

      const pipelineNode = pipeline.find((p) => p.nodeId === node.nodeId);
      if (!pipelineNode?.contractAddress) {
        console.warn(
          `Missing contract address for streamer ${node.nodeId} in deployment ${deployment.id}`,
        );
        skipped++;
        continue;
      }

      const result = await scheduleNextStreamerClaimJob(
        db,
        deployment.id,
        node.nodeId,
        pipelineNode.contractAddress,
        node.params as StreamerParams,
      );

      if (result) {
        console.log(
          `Scheduled job ${result.id} for deployment ${deployment.id} / ${node.nodeId} at ${result.runAt.toISOString()}`,
        );
        scheduled++;
      } else {
        console.log(
          `Skipped scheduling for deployment ${deployment.id} / ${node.nodeId} (stream ended or already scheduled)`,
        );
        skipped++;
      }
    }
  }

  console.log(`\nDone. Scheduled: ${scheduled}, skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
