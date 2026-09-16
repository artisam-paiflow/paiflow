/**
 * Edge-compatible Auth.js config: no DB adapter, no argon2, no Node-only deps.
 * Used by middleware to verify the session cookie. The full auth config in
 * lib/auth.ts re-exports this and adds the Credentials provider + Prisma
 * adapter for Node runtimes.
 */
import type { NextAuthConfig } from "next-auth";

type Role = "ADMIN" | "USER" | "SANDBOX";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Host-paiflow.session" : "paiflow.session",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [],
  callbacks: {
    // Auth.js resolves a relative callbackUrl against an origin it derives per
    // request: AUTH_URL when set, otherwise `x-forwarded-host ?? host`
    // (@auth/core/lib/utils/env.ts, createActionURL). AUTH_URL is deliberately
    // unset — it pinned every redirect to one hostname while this service
    // answers on two — and behind Railway's proxy the fallback resolves to the
    // container's own address, so the default callback returned
    // `http://localhost:8080/` and signing out left the site entirely, on both
    // hostnames.
    //
    // There is no absolute origin that would be right for both, so return a path
    // and let the browser resolve it against wherever the visitor already is.
    // signOut() puts this value in a JSON body it assigns to window.location,
    // and the no-JS path sets it as a bare Location header
    // (@auth/core/lib/utils/web.ts uses headers.set, not Response.redirect,
    // which would reject a relative URL) — both handle a path.
    redirect({ url, baseUrl }) {
      // Only a single leading slash is a path. "//host" and "/\host" are
      // absolute to a browser, so returning one unchanged would be an open
      // redirect.
      if (/^\/(?![/\\])/.test(url)) return url;
      try {
        const target = new URL(url);
        if (target.origin === baseUrl) {
          return `${target.pathname}${target.search}${target.hash}`;
        }
      } catch {
        // Not a URL at all; fall through to the safe default.
      }
      return "/";
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.username = (user as { username: string }).username;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = (token.id as string) ?? "";
        (session.user as { role?: Role }).role = (token.role as Role) ?? "USER";
        (session.user as { username?: string }).username = (token.username as string) ?? "";
      }
      return session;
    },
    authorized({ auth }) {
      return Boolean(auth?.user?.id);
    },
  },
};
