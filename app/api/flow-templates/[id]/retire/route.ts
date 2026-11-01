import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { RetireFlowTemplateSchema } from "@/lib/flow-templates/schema";
import { requireTemplateManager, retireFlowTemplate } from "@/lib/flow-templates/service";
import {
  templateBody,
  templateResponse,
  templateId,
  type TemplateContext,
} from "@/lib/flow-templates/http";
export async function POST(req: NextRequest, ctx: TemplateContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    const { id } = await ctx.params;
    RetireFlowTemplateSchema.parse(await templateBody(req));
    return templateResponse(await retireFlowTemplate(user.id, templateId(id), req));
  });
}
