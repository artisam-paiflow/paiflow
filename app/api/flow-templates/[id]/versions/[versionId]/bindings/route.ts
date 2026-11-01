import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { CreationBindingsSchema } from "@/lib/flows/field-policies";
import {
  requireTemplateManager,
  resolveTemplateForPreparation,
} from "@/lib/flow-templates/service";
import {
  templateBody,
  templateResponse,
  templateId,
  type TemplateVersionContext,
} from "@/lib/flow-templates/http";
export async function POST(req: NextRequest, ctx: TemplateVersionContext) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    const { id, versionId } = await ctx.params;
    const resolved = await resolveTemplateForPreparation(
      user.id,
      templateId(id),
      templateId(versionId),
      CreationBindingsSchema.parse(await templateBody(req)),
    );
    return templateResponse({
      templateVersionId: resolved.version.id,
      contentHash: resolved.version.contentHash,
      network: resolved.version.network,
      graph: resolved.graph,
      bindings: resolved.bindings,
      artifacts: resolved.artifacts,
      expiresAt: resolved.version.expiresAt,
    });
  });
}
