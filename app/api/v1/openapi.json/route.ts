import { NextResponse, type NextRequest } from "next/server";
import { withErrorHandler } from "@/lib/errors";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { V1_RATE_LIMITS } from "@/lib/api/v1/limits";
import { openApiDocument } from "@/lib/api/v1/openapi";

/**
 * The OpenAPI document, public and unauthenticated so a partner or reviewer can import it before
 * holding a token. Not wrapped in `v1Route`: there is no deployment and no token, so the limit is
 * keyed on the IP, which is advisory (#433) but enough for a static document. Returned bare, not in
 * `{ data }`, because tools import it directly.
 */
export async function GET(req: NextRequest) {
  return withErrorHandler(async () => {
    await enforceRateLimit({ key: `v1:openapi:${clientIp(req)}`, ...V1_RATE_LIMITS.openapi });
    return NextResponse.json(openApiDocument);
  });
}
