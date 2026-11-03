import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { requireTemplateManager } from "@/lib/flow-templates/service";
import {
  instanceResponse,
  runInstanceAction,
  type InstanceContext,
} from "@/lib/flow-instances/http";
export async function POST(req: NextRequest, ctx: InstanceContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    return instanceResponse(await runInstanceAction("submit", req, await ctx.params, user));
  });
}
