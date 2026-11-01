import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { PublishFlowTemplateSchema } from "@/lib/flow-templates/schema";
import {
  requireTemplateManager,
  publishFlowTemplate,
  listFlowTemplateVersions,
} from "@/lib/flow-templates/service";
import {
  templateBody,
  templateResponse,
  templateId,
  templateListQuery,
  type TemplateContext,
} from "@/lib/flow-templates/http";
export async function GET(req: NextRequest, ctx: TemplateContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager();
    const { id } = await ctx.params;
    return templateResponse(
      await listFlowTemplateVersions(user.id, templateId(id), templateListQuery(req)),
    );
  });
}
export async function POST(req: NextRequest, ctx: TemplateContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    const { id } = await ctx.params;
    return templateResponse(
      await publishFlowTemplate(
        user.id,
        templateId(id),
        PublishFlowTemplateSchema.parse(await templateBody(req)),
        req,
      ),
      201,
    );
  });
}
