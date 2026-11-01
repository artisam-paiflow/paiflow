import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { runMutationAction } from "@/lib/mutations/http";
export const POST = v1Route(
  { operation: "POST configuration/prepare", rateLimit: V1_RATE_LIMITS.schedulePrepare },
  async (ctx) => runMutationAction("prepare", ctx.req, ctx.deployment, ctx),
);
