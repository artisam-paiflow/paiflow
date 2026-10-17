import type { NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import {
  listEligibleDeployments,
  requireDeveloperTokenManager,
} from "@/lib/developer-tokens/service";
import { tokenListQuery, tokenResponse } from "@/lib/developer-tokens/http";

export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    const user = await requireDeveloperTokenManager();
    return tokenResponse(await listEligibleDeployments(user.id, tokenListQuery(req)));
  });
}
