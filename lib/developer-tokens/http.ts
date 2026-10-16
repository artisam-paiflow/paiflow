import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { DeveloperTokenListQuerySchema } from "./schema";

export function tokenResponse(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status, headers: { "Cache-Control": "no-store" } });
}
export async function tokenBody(req: NextRequest): Promise<unknown> {
  return req.json().catch(() => {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  });
}
export function tokenListQuery(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  if (new Set(params.keys()).size !== [...params.keys()].length)
    throw new AppError("VALIDATION", "Duplicate query parameters are not supported");
  return DeveloperTokenListQuerySchema.parse(Object.fromEntries(params));
}
export function tokenId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError("NOT_FOUND", "Token not found");
  return id;
}
