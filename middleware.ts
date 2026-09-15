import { NextResponse, type NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { cspHeader, makeNonce } from "@/lib/csp";
import { isSandboxAllowed } from "@/lib/sandbox-paths";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = [
  /^\/$/,
  /^\/login$/,
  /^\/register$/,
  /^\/forgot-password$/,
  /^\/auth\/new-password$/,
  /^\/api\/auth(\/.*)?$/,
  /^\/api\/health$/,
  /^\/api\/cron\/.*/,
  /^\/api\/files\/.*/,
  /^\/api\/webhooks(\/.*)?$/,
  /^\/deployments\/[^/]+\/embed$/,
  /^\/trigger\/[^/]+$/,
  /^\/api\/deployments\/[^/]+\/trigger$/,
  /^\/api\/deployments\/[^/]+\/submit-trigger$/,
  /^\/api\/deployments\/[^/]+\/tx-status$/,
  // Machine-auth endpoints handle their own secret-token auth inside the route.
  /^\/api\/deployments\/dev-payroll$/,
  /^\/api\/deployments\/[^/]+\/dev-.*$/,
  /^\/api\/deployments\/[^/]+\/payroll-allowance$/,
  /^\/api\/deployments\/[^/]+\/payroll-record-run$/,
  /^\/api\/deployments\/[^/]+\/payroll-update-recipients$/,
  /^\/api\/deployments\/[^/]+\/payroll-events$/,
  /^\/api\/deployments\/[^/]+\/payroll-runs\/[^/]+\/events$/,
  /^\/api\/deployments\/[^/]+\/payroll-runs(\/[^/]+)?$/,
  /^\/api\/deployments\/[^/]+\/offramp-.*$/,
  /^\/api\/deployments\/[^/]+\/employees\/bank$/,
  // Unlike the entries above (#248), this line cannot open a deployment on its
  // own: every /api/v1/deployments/:id handler is wrapped in v1Route
  // (lib/api/v1/handler.ts), which authenticates a deployment token itself.
  /^\/api\/v1(\/.*)?$/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname));
}

// Auth-entry screens an already-authenticated user has no reason to see.
// Visiting any of these while logged in bounces to the dashboard (issue #238).
const AUTH_ENTRY_PATHS = [/^\/login$/, /^\/register$/, /^\/forgot-password$/];

function isAuthEntryPage(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.some((re) => re.test(pathname));
}

function applySecurityHeaders(res: NextResponse, req: NextRequest): NextResponse {
  const isDev = process.env.NODE_ENV !== "production";
  const nonce = makeNonce();
  res.headers.set("Content-Security-Policy", cspHeader(nonce, isDev));
  res.headers.set("x-paiflow-nonce", nonce);
  // Surface a request id so logs can be correlated.
  const rid =
    req.headers.get("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  res.headers.set("x-request-id", rid);
  return res;
}

export default auth(
  (req: NextRequest & { auth: { user?: { id?: string; role?: string } } | null }) => {
    const { pathname } = req.nextUrl;
    const isAuthed = Boolean(req.auth?.user?.id);
    const isSandbox = req.auth?.user?.role === "SANDBOX";

    // Already signed in? Don't show the login/register/forgot-password screens —
    // send the user straight to the dashboard.
    if (isAuthed && isAuthEntryPage(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return applySecurityHeaders(NextResponse.redirect(url), req);
    }

    // Checked ahead of isPublic so the machine-auth endpoints listed there stay
    // out of reach of a sandbox session.
    if (isSandbox && !isSandboxAllowed(pathname)) {
      if (pathname.startsWith("/api/")) {
        return applySecurityHeaders(
          NextResponse.json(
            { error: { code: "FORBIDDEN", message: "Not available in the sandbox" } },
            { status: 403 },
          ),
          req,
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return applySecurityHeaders(NextResponse.redirect(url), req);
    }

    if (isPublic(pathname)) {
      return applySecurityHeaders(NextResponse.next(), req);
    }

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
  },
);

export const config = {
  // `ingest` is the PostHog proxy (next.config.ts rewrites). It carries no app
  // data and has to work for logged-out and sandbox visitors alike, so it skips
  // the session and sandbox checks rather than being listed in both allowlists.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|ingest/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)).*)",
  ],
};
