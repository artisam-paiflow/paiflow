import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { FlowTemplateListQuerySchema } from "./schema";
export function templateResponse(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function templateBody(req: Request): Promise<unknown> {
  return req.json().catch(() => {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  });
}
export function templateListQuery(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length)
    throw new AppError("VALIDATION", "Duplicate query parameters are unsupported");
  return FlowTemplateListQuerySchema.parse(Object.fromEntries(params));
}
export function templateId(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new AppError("NOT_FOUND", "Template or version not found");
  return id;
}
export type TemplateContext = { params: Promise<{ id: string }> };
export type TemplateVersionContext = { params: Promise<{ id: string; versionId: string }> };
