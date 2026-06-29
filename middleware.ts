import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { cspHeader, makeNonce } from "@/lib/csp";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  /^\/$/,
  /^\/login$/,
  /^\/register$/,
  /^\/forgot-password$/,
  /^\/auth\/new-password$/,
  /^\/about$/,
  /^\/privacy$/,
  /^\/terms$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/api\/health$/,
  /^\/api\/cron\/.*/,
  /^\/api\/files\/.*/,
  /^\/api\/webhooks(\/.*)?$/,
  /^\/deployments\/[^/]+\/embed$/,
  /^\/trigger\/[^/]+$/,
  /^\/api\/deployments\/[^/]+\/trigger$/,
  /^\/api\/deployments\/[^/]+\/submit-trigger$/,
  // Machine-auth endpoints handle their own secret-token auth inside the route.
  /^\/api\/deployments\/[^/]+\/dev-.*$/,
  /^\/api\/deployments\/[^/]+\/payroll-record-run$/,
  /^\/api\/deployments\/[^/]+\/offramp-.*$/,
  /^\/api\/deployments\/[^/]+\/employees\/bank$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

function applySecurityHeaders(res: NextResponse, req: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = makeNonce();
  res.headers.set("Content-Security-Policy", cspHeader(nonce, isDev));
  res.headers.set("x-pinkraft-nonce", nonce);
  // Surface a request id so logs can be correlated.
  const rid =
    req.headers.get("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.headers.set("x-request-id", rid);
  return res;
}

export default auth((req: NextRequest & { auth: { user?: { id?: string } } | null }) => {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) {
    return applySecurityHeaders(NextResponse.next(), req);
  }

  const isAuthed = Boolean(req.auth?.user?.id);
  if (!isAuthed) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Authentication required" } },
          { status: 401 },
        ),
        req,
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return applySecurityHeaders(NextResponse.redirect(url), req);
  }
  return applySecurityHeaders(NextResponse.next(), req);
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)"],
};
