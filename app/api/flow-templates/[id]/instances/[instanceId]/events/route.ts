import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { requireTemplateManager } from "@/lib/flow-templates/service";
import {
  instanceResponse,
  runInstanceAction,
  type InstanceContext,
} from "@/lib/flow-instances/http";
export async function GET(req: NextRequest, ctx: InstanceContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(false);
    return instanceResponse(await runInstanceAction("events", req, await ctx.params, user));
  });
}
