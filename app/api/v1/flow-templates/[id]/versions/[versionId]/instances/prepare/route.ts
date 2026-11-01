import { Role } from "@prisma/client";
import { v1TemplateRoute } from "@/lib/api/v1/handler";
import {
  instanceResponse,
  runInstanceAction,
  type InstanceParams,
} from "@/lib/flow-instances/http";
export const POST = v1TemplateRoute<InstanceParams>(
  {
    operation: "POST flow-templates/:id/versions/:versionId/instances/prepare",
    rateLimit: { limit: 10, windowSeconds: 60 },
  },
  async (ctx) =>
    instanceResponse(
      await runInstanceAction("prepare", ctx.req, ctx.params, {
        id: ctx.ownerId,
        role: Role.USER,
        credential: ctx,
      }),
    ),
);
