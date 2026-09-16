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
      // Only a single leading slash is a path. "//host" and "/\host" are
      // absolute to a browser, so resolving one against baseUrl would let a
      // caller pick the destination host.
      if (/^\/(?![/\\])/.test(url)) return new URL(url, baseUrl).toString();
      try {
        if (new URL(url).origin === baseUrl) return url;
      } catch {
        // Not a URL at all; fall through to the safe default.
      }
      return baseUrl;
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
