import { NextResponse } from "next/server";
import { v1DiscoveryRoute } from "@/lib/api/v1/handler";
import { discoverDeployments } from "@/lib/api/v1/discovery";

export const GET = v1DiscoveryRoute(async (auth) =>
  NextResponse.json(
    { data: await discoverDeployments(auth, new URL(auth.req.url).searchParams) },
    { headers: { "Cache-Control": "no-store" } },
  ),
);
