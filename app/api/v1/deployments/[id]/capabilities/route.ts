import { NextResponse } from "next/server";
import { deploymentCapabilities } from "@/lib/api/v1/capabilities";
import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { operation: "GET capabilities", rateLimit: V1_RATE_LIMITS.capabilities },
  async ({ deployment }) => {
    return NextResponse.json(
      { data: deploymentCapabilities(deployment) },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  },
);
