import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { CreateDeveloperTokenSchema } from "@/lib/developer-tokens/schema";
import {
  createDeveloperToken,
  listDeveloperTokens,
  requireDeveloperTokenManager,
} from "@/lib/developer-tokens/service";
import { tokenBody, tokenListQuery, tokenResponse } from "@/lib/developer-tokens/http";

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager();
    return tokenResponse(await listDeveloperTokens(user.id, tokenListQuery(req)));
  });
}
export async function POST(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager(true);
    const input = CreateDeveloperTokenSchema.parse(await tokenBody(req));
    return tokenResponse(await createDeveloperToken(user.id, input, req), 201);
  });
}
