import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { subscriptionAllowanceState } from "@/lib/subscription/state";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { operation: "GET subscription/state", rateLimit: V1_RATE_LIMITS.subscriptionState },
  async ({ deployment }) => {
    if (deploymentCapabilities(deployment).operations.subscriptionState.status === "unsupported")
      throw new AppError("VALIDATION", "Deployment is not a supported subscription");
    return NextResponse.json(
      { data: await subscriptionAllowanceState(deployment.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
);
