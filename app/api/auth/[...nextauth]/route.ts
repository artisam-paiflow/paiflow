import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { env } from "@/lib/env";

/** Railway can rewrite Host to its internal container. Use the operator's
 * canonical origin for OAuth redirect_uri, cookie callbacks and return URLs. */
function canonicalRequest(req: NextRequest) {
  if (!env().GOOGLE_AUTH_ENABLED) return req;
  const target = new URL(req.nextUrl.pathname + req.nextUrl.search, env().AUTH_URL);
  const headers = new Headers(req.headers);
  headers.set("host", target.host);
  headers.set("x-forwarded-host", target.host);
  headers.set("x-forwarded-proto", target.protocol.slice(0, -1));
  return new NextRequest(target, {
    method: req.method,
    headers,
    body: req.method === "POST" ? req.body : undefined,
    duplex: "half",
  });
}
export async function GET(req: NextRequest) {
  return handlers.GET(canonicalRequest(req));
}
export async function POST(req: NextRequest) {
  return handlers.POST(canonicalRequest(req));
}
