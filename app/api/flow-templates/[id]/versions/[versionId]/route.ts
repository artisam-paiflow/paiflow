import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { requireTemplateManager, getFlowTemplateVersion } from "@/lib/flow-templates/service";
import {
  templateResponse,
  templateId,
  type TemplateVersionContext,
} from "@/lib/flow-templates/http";
export async function GET(_req: NextRequest, ctx: TemplateVersionContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager();
    const { id, versionId } = await ctx.params;
    return templateResponse(
      await getFlowTemplateVersion(user.id, templateId(id), templateId(versionId)),
    );
  });
}
