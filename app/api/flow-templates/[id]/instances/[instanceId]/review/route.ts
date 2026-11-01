import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { requireTemplateManager } from "@/lib/flow-templates/service";
import { templateId } from "@/lib/flow-templates/http";
import { instanceResponse, type InstanceContext } from "@/lib/flow-instances/http";
import { instanceInitialReview } from "@/lib/flow-instances/review";

export async function GET(_req: NextRequest, ctx: InstanceContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager();
    const params = await ctx.params;
    return instanceResponse(
      await instanceInitialReview(
        user.id,
        templateId(params.id).toLowerCase(),
        templateId(params.instanceId ?? "").toLowerCase(),
      ),
    );
  });
}
