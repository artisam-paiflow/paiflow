import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/rate-limit";

// Same-origin proxy for posthog-js (lib/analytics/client.ts). A next.config
// rewrite would forward every request header, and the session cookie is
// `Path=/`, so it would ride along to PostHog on every capture. This forwards
// an allowlist instead.
const INGEST_ORIGIN = "https://us.i.posthog.com";
const ASSETS_ORIGIN = "https://us-assets.i.posthog.com";

const FORWARDED_REQUEST_HEADERS = ["content-type", "user-agent", "accept"];
// fetch has already decoded the body, so the upstream encoding and length are wrong.
const DROPPED_RESPONSE_HEADERS = ["set-cookie", "content-encoding", "content-length"];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // Staging and local builds carry no key; don't be an open relay to PostHog there.
  if (!env().NEXT_PUBLIC_POSTHOG_KEY) return new Response(null, { status: 404 });

  const { path } = await ctx.params;
  const origin = path[0] === "static" ? ASSETS_ORIGIN : INGEST_ORIGIN;
  const upstream = new URL(origin);
  upstream.pathname = `/${path.map(encodeURIComponent).join("/")}${
    req.nextUrl.pathname.endsWith("/") ? "/" : ""
  }`;
  upstream.search = req.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("x-forwarded-for", clientIp(req));

  let res: Response;
  try {
    res = await fetch(upstream, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
  } catch {
    return new Response(null, { status: 502 });
  }

  const outHeaders = new Headers(res.headers);
  for (const name of DROPPED_RESPONSE_HEADERS) outHeaders.delete(name);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

export const GET = proxy;
export const POST = proxy;
