/**
 * Edge-compatible Auth.js config: no DB adapter, no argon2, no Node-only deps.
 * Used by middleware to verify the session cookie. The full auth config in
 * lib/auth.ts re-exports this and adds the Credentials provider + Prisma
 * adapter for Node runtimes.
 */
import type { NextAuthConfig } from "next-auth";

type Role = "ADMIN" | "USER";

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
