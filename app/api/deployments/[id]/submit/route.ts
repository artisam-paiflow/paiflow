import { NextRequest } from "next/server";
import { deploymentServiceRoute } from "@/lib/deployments/service-route";
import { requireSession } from "@/lib/auth";
import { withErrorHandler } from "@/lib/errors";
import { enforceWriteRateLimit } from "@/lib/api/write-rate-limit";
import { submitOwnedDeployment } from "@/lib/deployments/submit";
async function POSTHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withErrorHandler(async () => {
    const user = await requireSession();
    await enforceWriteRateLimit("deploymentSubmit", user.id);
    return submitOwnedDeployment(req, (await ctx.params).id, user);
  });
}
export const POST = deploymentServiceRoute(POSTHandler, "owner");
