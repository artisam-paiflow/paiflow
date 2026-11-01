import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { UpdateFlowTemplateSchema } from "@/lib/flow-templates/schema";
import {
  requireTemplateManager,
  getFlowTemplate,
  updateFlowTemplate,
} from "@/lib/flow-templates/service";
import {
  templateBody,
  templateResponse,
  templateId,
  type TemplateContext,
} from "@/lib/flow-templates/http";
export async function GET(_req: NextRequest, ctx: TemplateContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager();
    const { id } = await ctx.params;
    return templateResponse(await getFlowTemplate(user.id, templateId(id)));
  });
}
export async function PATCH(req: NextRequest, ctx: TemplateContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    const { id } = await ctx.params;
    return templateResponse(
      await updateFlowTemplate(
        user.id,
        templateId(id),
        UpdateFlowTemplateSchema.parse(await templateBody(req)),
        req,
      ),
    );
  });
}
