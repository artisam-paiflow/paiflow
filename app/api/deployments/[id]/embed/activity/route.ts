import { NextRequest, NextResponse } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { withErrorHandler } from "@/lib/errors";
import { publicEmbedDeployment, publicEmbedEvents } from "@/lib/deployments/public-embed-reads";

export const dynamic = "force-dynamic";
async function GETHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const { id } = await ctx.params;
    await publicEmbedDeployment(req, id);
    return NextResponse.json(
      { data: { events: await publicEmbedEvents(id) } },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export const GET = deploymentServiceRoute(GETHandler, "public");
