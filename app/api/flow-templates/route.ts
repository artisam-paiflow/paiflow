import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { CreateFlowTemplateSchema } from "@/lib/flow-templates/schema";
import {
  requireTemplateManager,
  createFlowTemplate,
  listFlowTemplates,
} from "@/lib/flow-templates/service";
import { templateBody, templateResponse, templateListQuery } from "@/lib/flow-templates/http";
export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager();
    return templateResponse(await listFlowTemplates(user.id, templateListQuery(req)));
  });
}
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireTemplateManager(true);
    return templateResponse(
      await createFlowTemplate(
        user.id,
        CreateFlowTemplateSchema.parse(await templateBody(req)),
        req,
      ),
      201,
    );
  });
}
