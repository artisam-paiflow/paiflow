import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { UpdateDeveloperTokenSchema } from "@/lib/developer-tokens/schema";
import {
  inspectDeveloperToken,
  requireDeveloperTokenManager,
  revokeDeveloperToken,
  updateDeveloperToken,
} from "@/lib/developer-tokens/service";
import { tokenBody, tokenId, tokenResponse } from "@/lib/developer-tokens/http";

type Ctx = { params: Promise<{ tokenId: string }> };
export async function GET(_req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager();
    return tokenResponse(await inspectDeveloperToken(user.id, tokenId((await ctx.params).tokenId)));
  });
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager(true);
    const id = tokenId((await ctx.params).tokenId);
    const input = UpdateDeveloperTokenSchema.parse(await tokenBody(req));
    return tokenResponse(await updateDeveloperToken(user.id, id, input.deploymentIds, req));
  });
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager(true);
    return tokenResponse(
      await revokeDeveloperToken(user.id, tokenId((await ctx.params).tokenId), req),
    );
  });
}
