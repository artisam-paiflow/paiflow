import "server-only";
import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { log } from "./log";
import { audit } from "./audit";
import { AppError } from "./errors";
import { hashApiToken } from "./auth/api-token";
import { isSessionCurrent } from "./auth/session-version";
import { timingSafeEqualString } from "./auth/timing-safe";
import { captureServer } from "./analytics/server";
import { Role } from "@prisma/client";
import { authConfig as edgeConfig } from "@/auth.config";

// Lazy-load argon2 so it isn't statically reachable from non-auth route
// graphs; argon2 is a native addon and pulling it into static prerender
// chunks breaks the build.
async function argon2Mod(): Promise<typeof import("argon2")> {
  const mod = await import("argon2");
  return (mod as unknown as { default?: typeof import("argon2") }).default ?? mod;
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

function argonOpts(argon2: typeof import("argon2")) {
  return {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;
}

const CredentialsSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(256).optional(),
  passkeyTicket: z.string().min(1).max(256).optional(),
});

export async function hashPassword(password: string): Promise<string> {
  const argon2 = await argon2Mod();
  return argon2.hash(password, argonOpts(argon2));
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    const argon2 = await argon2Mod();
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function authorizeUser(input: unknown): Promise<{
  id: string;
  username: string;
  role: Role;
  sessionVersion: number;
} | null> {
  const parsed = CredentialsSchema.safeParse(input);
  if (!parsed.success) return null;
  const { username, password, passkeyTicket } = parsed.data;

  // Passkey login: ticket was issued by /api/auth/passkey/login/verify after a
  // successful WebAuthn assertion. Also the handshake /api/auth/sandbox uses.
  // Single-use (popChallenge deletes it), ≤5 min — challenges.ts stores EX 300.
  if (passkeyTicket) {
    const { popChallenge } = await import("./passkey/challenges");
    const userId = await popChallenge("ticket", passkeyTicket);
    if (!userId) return null;
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || !u.isActive) return null;
    await db.user.update({
      where: { id: u.id },
      data: { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null },
    });
    void captureServer(u.id, "login_succeeded", { method: "ticket" });
    return { id: u.id, username: u.username, role: u.role, sessionVersion: u.sessionVersion };
  }

  if (!username || !password) return null;

  const { rateLimit } = await import("./rate-limit");
  const rl = await rateLimit(`login:${username.toLowerCase()}`, 10, 60 * 10);
  if (!rl.ok) {
    log.warn({ username }, "login: rate limited");
    return null;
  }

  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    log.info({ username }, "login: unknown or inactive user");
    return null;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    log.warn({ username }, "login: account locked");
    void captureServer(user.id, "login_failed", { reason: "locked" });
    return null;
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock =
      failed >= LOCKOUT_THRESHOLD ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: failed, lockedUntil: lock },
    });
    await audit({ action: "USER_LOGIN_FAILED", userId: user.id, metadata: { username } });
    void captureServer(user.id, "login_failed", { reason: "bad_password" });
    return null;
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit({ action: "USER_LOGIN", userId: user.id });
  void captureServer(user.id, "login_succeeded", { method: "password" });

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

export const fullAuthConfig = {
  ...edgeConfig,
  adapter: PrismaAdapter(db),
  secret: env().AUTH_SECRET,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: authorizeUser,
    }),
  ],
};

export const { handlers, auth, signIn, signOut } = NextAuth(fullAuthConfig);

// Implemented in its own module so /api/cron/* can import it without
// pulling next-auth into every cron route; re-exported here so it sits
// beside the other require* guards.
export { requireCronSecret } from "./auth/cron-secret";

export type SessionUser = {
  id: string;
  username: string;
  role: Role;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  // The cookie only proves who signed in, up to seven days ago. Whether that
  // still counts is the row's call: one primary-key read per request is the
  // price of being able to end a stateless session at all.
  const row = await db.user.findUnique({
    where: { id: session.user.id },
    select: { isActive: true, role: true, sessionVersion: true },
  });
  if (!row || !isSessionCurrent(session.user as { sessionVersion?: unknown }, row)) return null;
  return {
    id: session.user.id,
    username: (session.user as { username?: string }).username ?? "",
    // From the row, not the token: a role change bumps the version, but a guard
    // that trusted the token's copy would be one missed bump away from letting
    // a demoted admin through.
    role: row.role,
  };
}

export async function requireDevAuth(req: NextRequest): Promise<{ user: SessionUser | null }> {
  const secret = env().DEV_API_SECRET;
  const presented = req.headers.get("x-dev-api-secret");
  if (secret && presented && timingSafeEqualString(presented, secret)) {
    return { user: null };
  }

  // Per-developer machine tokens also grant access to dev endpoints; they carry
  // an owner, unlike the shared secret above. requireDevApiToken() rejects a
  // SANDBOX owner itself, so both user-bearing paths here are covered.
  try {
    return { user: await requireDevApiToken(req) };
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      const user = await requireSession();
      // These endpoints mutate deployed contracts and several sign with the
      // relayer key. A SANDBOX session is a throwaway identity anyone can mint
      // without an account, so it never reaches them — middleware blocks these
      // paths too, but this must not be the only thing standing in the way.
      if (user.role === Role.SANDBOX) {
        throw new AppError("FORBIDDEN", "Not available in the sandbox");
      }
      return { user };
    }
    throw err;
  }
}

/**
 * Resolve a per-developer API token to the Paiflow user that owns it. Machine
 * endpoints that CREATE owned rows (e.g. the dev-payroll deploy) cannot use the
 * shared `x-dev-api-secret` because it carries no owner. The caller presents the
 * token in the `x-dev-api-secret` header (or `Authorization: Bearer <token>`);
 * we match its SHA-256 hash against an active `DevApiToken` row and return the
 * mapped user.
 *
 * This is token-only auth: there is no interactive-session fallback. The route
 * it guards signs and submits a relayer-funded on-chain deploy, so it must not
 * be reachable by an arbitrary logged-in user — only by a caller holding a
 * minted `DevApiToken` (see scripts/create-dev-api-token.ts).
 */
export async function requireDevApiToken(req: NextRequest): Promise<SessionUser> {
  const raw =
    req.headers.get("x-dev-api-secret") ??
    req.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim() ??
    null;

  if (raw) {
    const tokenHash = hashApiToken(raw);
    const token = await db.devApiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (token && !token.revokedAt && token.user.isActive) {
      // scripts/create-dev-api-token.ts will mint a token for any existing user,
      // SANDBOX included. The endpoints behind this helper mutate deployed
      // contracts and sign with the relayer key, so the role is refused here
      // rather than only on the session fallback in requireDevAuth().
      if (token.user.role === Role.SANDBOX) {
        throw new AppError("FORBIDDEN", "Not available in the sandbox");
      }
      // Best-effort last-used stamp; never block the request on it.
      db.devApiToken
        .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
      return { id: token.user.id, username: token.user.username, role: token.user.role };
    }
  }

  throw new AppError("UNAUTHENTICATED", "A valid developer API token is required");
}

export async function requireSession(opts?: { role?: Role }): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication required");
  if (opts?.role && user.role !== opts.role && user.role !== Role.ADMIN) {
    throw new AppError("FORBIDDEN", "Insufficient permissions");
  }
  return user;
}

/** Where a server page sends a cookie that getSessionUser() no longer accepts. */
export const STALE_SESSION_PATH = "/api/auth/stale-session";

/**
 * requireSession() for `page.tsx`. Middleware verifies the JWT's signature and
 * nothing else (it runs on the edge, without a database), so a session ended
 * by a version bump still gets past it and reaches the page. Throwing there
 * renders app/error.tsx on every page for the rest of the cookie's seven days,
 * and /login is no way out because middleware bounces a signed-in visitor off
 * it. A server component cannot clear a cookie, so hand the browser to a route
 * handler that can.
 */
export async function requirePageSession(opts?: { role?: Role }): Promise<SessionUser> {
  try {
    return await requireSession(opts);
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") redirect(STALE_SESSION_PATH);
    throw err;
  }
}
