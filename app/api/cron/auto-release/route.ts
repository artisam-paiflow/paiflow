import { NextRequest, NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { requireCronSecret } from "@/lib/auth/cron-secret";
import { runAutoRelease } from "@/lib/timelock-release";

export const dynamic = "force-dynamic";

// Sandbox-owned deployments are never loaded: a sandbox session cannot deploy
// a TIMELOCK (SANDBOX_TEMPLATE_KINDS), and this job signs with the relayer,
// which must never act on a sandbox pipeline. lib/timelock-release.ts filters
// them out of both discovery and selection.
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    requireCronSecret(req);
    return NextResponse.json({ data: await runAutoRelease() });
  });
}

export const GET = POST;
