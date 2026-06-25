import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { OffRampPayoutJobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { withErrorHandler } from "@/lib/errors";
import { getOffRampProvider } from "@/lib/offramp/provider";
import { enforceRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const ip = clientIp(req);
    await enforceRateLimit({ key: `webhook:offramp:${ip}`, limit: 60, windowSeconds: 60 });

    // PDAX does not sign webhooks, so authenticity is enforced with a shared
    // token in the registered URL (?token=...). When OFFRAMP_WEBHOOK_SECRET is
    // set, a request without a matching token is rejected.
    const expectedToken = env().OFFRAMP_WEBHOOK_SECRET;
    if (expectedToken) {
      const provided = req.nextUrl.searchParams.get("token") ?? "";
      if (!constantTimeEquals(provided, expectedToken)) {
        log.warn({ ip }, "Off-ramp webhook rejected: invalid token");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

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

// Constant-time string comparison that does not leak length via early return.
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
