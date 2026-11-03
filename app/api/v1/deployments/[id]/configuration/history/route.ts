import { v1Route } from "@/lib/api/v1/handler";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { runMutationAction } from "@/lib/mutations/http";
export const GET = v1Route(
  { operation: "GET configuration/history", rateLimit: V1_RATE_LIMITS.capabilities },
  async (ctx) => runMutationAction("history", ctx.req, ctx.deployment, ctx),
);
