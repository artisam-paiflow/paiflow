import { NextRequest, NextResponse } from "next/server";
import { OffRampPayoutJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { withErrorHandler } from "@/lib/errors";
import { getOffRampProvider } from "@/lib/offramp/provider";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const ip = clientIp(req);
    await enforceRateLimit({ key: `webhook:offramp:${ip}`, limit: 60, windowSeconds: 60 });

    const signature = req.headers.get("x-signature") ?? undefined;
    const payload = await req.json();
    const provider = getOffRampProvider();

    const webhook = await provider.validateWebhook(payload, signature);

    const job = await db.offRampPayoutJob.findFirst({
      where: { providerRef: webhook.providerRef },
    });

    if (!job) {
      log.warn(
        { providerRef: webhook.providerRef, provider: provider.name },
        "Off-ramp webhook received for unknown providerRef",
      );
      // Return 200 so the provider does not retry for a missing job.
      return NextResponse.json({ data: { acknowledged: false, reason: "unknown" } });
    }

    if (TERMINAL_OFFRAMP_STATUSES.includes(job.status)) {
      return NextResponse.json({ data: { acknowledged: true, alreadyTerminal: true } });
    }

    const status =
      webhook.status === "COMPLETED"
        ? OffRampPayoutJobStatus.COMPLETED
        : webhook.status === "FAILED"
          ? OffRampPayoutJobStatus.FAILED
          : OffRampPayoutJobStatus.INITIATED;

    await db.offRampPayoutJob.update({
      where: { id: job.id },
      data: {
        status,
        completedAt: status === OffRampPayoutJobStatus.COMPLETED ? new Date() : undefined,
      },
    });

    log.info(
      {
        jobId: job.id,
        providerRef: webhook.providerRef,
        provider: provider.name,
        status,
      },
      "Off-ramp webhook processed",
    );

    return NextResponse.json({ data: { acknowledged: true } });
  });
}

const TERMINAL_OFFRAMP_STATUSES: OffRampPayoutJobStatus[] = [
  OffRampPayoutJobStatus.COMPLETED,
  OffRampPayoutJobStatus.FAILED,
  OffRampPayoutJobStatus.CANCELLED,
];
