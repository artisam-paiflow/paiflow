import { NextResponse } from "next/server";
import { linkApiTransaction } from "@/lib/api/request-history/context";
import { audit } from "@/lib/audit";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import type { Released } from "@/lib/api/v1/schema";
import { clientIp } from "@/lib/rate-limit";
import { parseReleaseBody, releaseTimelockBranchBefore } from "@/lib/timelock-early-release";

/**
 * "Work delivered": release a timelock branch's before side now, signed by the
 * relayer. The deployment token (bound to this one deployment) is the
 * authorisation; the token's deployment is the only one it can reach.
 */
export const POST = v1Route(
  { operation: "POST release-early", rateLimit: V1_RATE_LIMITS.releaseBefore },
  async ({ req, params, token, tokenType, deployment }) => {
    const input = await parseReleaseBody(req);
    const released = await releaseTimelockBranchBefore(deployment, input.nodeId);

    linkApiTransaction(released.txHash);
    await audit({
      action: "API_TIMELOCK_RELEASE_BEFORE",
      userId: deployment.ownerId,
      ip: clientIp(req),
      metadata: {
        deploymentId: params.id,
        tokenId: token.id,
        tokenType,
        nodeId: released.nodeId,
        txHash: released.txHash,
      },
    });

    const data: Released = {
      nodeId: released.nodeId,
      txHash: released.txHash,
      ledger: released.ledger,
    };
    return NextResponse.json({ data });
  },
);
