import { Role } from "@prisma/client";
import { v1TemplateRoute } from "@/lib/api/v1/handler";
import {
  instanceResponse,
  runInstanceAction,
  type InstanceParams,
} from "@/lib/flow-instances/http";
export const GET = v1TemplateRoute<InstanceParams>(
  {
    operation: "GET flow-templates/:id/instances/:instanceId/events",
    rateLimit: { limit: 60, windowSeconds: 60 },
  },
  async (ctx) =>
    instanceResponse(
      await runInstanceAction("events", ctx.req, ctx.params, {
        id: ctx.ownerId,
        role: Role.USER,
        credential: ctx,
      }),
    ),
);
