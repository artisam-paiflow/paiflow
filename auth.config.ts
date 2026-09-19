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
    // Guards the one value a caller supplies that decides where the browser
    // goes. It must stay an absolute URL: signIn() is always called with
    // `redirect: false` here, and next-auth then does `new URL(data.url)` to
    // read the error param — a path throws TypeError there and takes the login
    // form down with it.
    //
    // The origin it builds is whatever Auth.js derived from the request, which
    // behind Railway's proxy is the container's own address rather than the host
    // the visitor used (their gateway rewrites Host and passes no usable
    // x-forwarded-host). Nothing navigates to it: components/app/topbar.tsx signs
    // out with `redirect: false` and sets the location itself, for exactly that
    // reason. Don't "fix" the origin by returning a path — that is the throw
    // above.
    redirect({ url, baseUrl }) {
      // Resolve first, judge second. The guard this replaced tested the
      // character after the leading slash to rule out "//host" and "/\host",
      // but the URL parser strips TAB/LF/CR *before* it parses: to that regex
      // "/\t/evil.com" was a path, and it then resolved to https://evil.com/
      // (#515). Only the origin of the parsed result says anything, so let the
      // parser normalise and compare that — it subsumes every shape the regex
      // enumerated, with no pre-parse inspection to get wrong.
      let resolved: URL;
      try {
        resolved = new URL(url, baseUrl);
      } catch {
        return baseUrl;
      }
      if (resolved.origin !== baseUrl) return baseUrl;
      // .origin ignores userinfo, so a same-host URL can still smuggle
      // credentials into the callback-url cookie. lib/env.ts's originList
      // refuses them for the same reason.
      if (resolved.username || resolved.password) return baseUrl;
      return resolved.toString();
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.username = (user as { username: string }).username;
        // Frozen at sign-in on purpose. The rolling refresh calls this with no
        // `user` and keeps the value; that is what lets getSessionUser() tell a
        // token issued before a bump from one issued after it.
        token.sessionVersion = (user as { sessionVersion: number }).sessionVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = (token.id as string) ?? "";
        (session.user as { role?: Role }).role = (token.role as Role) ?? "USER";
        (session.user as { username?: string }).username = (token.username as string) ?? "";
        // Passed through as is, absent included: lib/auth/session-version.ts
        // owns what a missing version means.
        (session.user as { sessionVersion?: unknown }).sessionVersion = token.sessionVersion;
      }
      return session;
    },
    authorized({ auth }) {
      return Boolean(auth?.user?.id);
    },
  },
};
