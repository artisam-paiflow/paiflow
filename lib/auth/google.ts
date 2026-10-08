import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

export const GOOGLE_LINK_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-paiflow.google-link" : "paiflow.google-link";
export const GOOGLE_RECENT_AUTH_MS = 5 * 60_000;
export const GoogleLinkSchema = z.object({}).strict();
export const GoogleProfileSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().trim().toLowerCase().email().max(254),
  email_verified: z.literal(true),
});
export type GoogleProfile = z.infer<typeof GoogleProfileSchema>;
export type GoogleSession = { id: string; sessionVersion: number; authenticatedAt?: unknown };
export class GoogleAuthError extends Error {
  constructor(
    public readonly reason:
      | "registration-closed"
      | "email-conflict"
      | "link-required"
      | "link-expired"
      | "provider-conflict"
      | "account-disabled"
      | "unavailable"
      | "rate-limited",
  ) {
    super(reason);
  }
}
export function recentGoogleAuthentication(value: unknown, now = Date.now()): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value <= now &&
    now - value < GOOGLE_RECENT_AUTH_MS
  );
}
export function googleLinkHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
function adapterUser(user: User): AdapterUser & Pick<User, "username" | "role" | "sessionVersion"> {
  // Auth.js requires a nonnullable email type. Existing credentials users may
  // have none; this placeholder is never a lookup key or persisted profile.
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    sessionVersion: user.sessionVersion,
    name: user.username,
    image: null,
    email: user.email ?? "",
    emailVerified: null,
  };
}
async function identityUser(provider: string, providerAccountId: string) {
  if (provider !== "google") return null;
  const identity = await db.googleIdentity.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (!identity) return null;
  if (!identity.user.isActive || identity.user.role === "SANDBOX")
    throw new GoogleAuthError("account-disabled");
  return adapterUser(identity.user);
}
/** OAuth writes only occur atomically in resolveGoogleUser. Auth.js's default
 * createUser/linkAccount sequence and implicit session linking are forbidden. */
export const googleAdapter: Adapter = {
  getUser: async (id) => {
    const user = await db.user.findUnique({ where: { id } });
    return user?.isActive && user.role !== "SANDBOX" ? adapterUser(user) : null;
  },
  getUserByAccount: ({ provider, providerAccountId }) => identityUser(provider, providerAccountId),
  getUserByEmail: async (email) => {
    const user = await db.user.findUnique({ where: { email } });
    return user ? adapterUser(user) : null;
  },
  createUser: async () => {
    throw new GoogleAuthError("link-required");
  },
  linkAccount: async () => {
    throw new GoogleAuthError("link-required");
  },
};

export async function createGoogleLinkIntent(session: GoogleSession): Promise<string> {
  if (!env().GOOGLE_AUTH_ENABLED) throw new GoogleAuthError("unavailable");
  if (!recentGoogleAuthentication(session.authenticatedAt))
    throw new GoogleAuthError("link-expired");
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: session.id } });
    if (
      !user?.isActive ||
      user.role === "SANDBOX" ||
      user.sessionVersion !== session.sessionVersion
    )
      throw new GoogleAuthError("account-disabled");
    if (
      await tx.googleIdentity.findUnique({
        where: { userId_provider: { userId: user.id, provider: "google" } },
      })
    )
      throw new GoogleAuthError("provider-conflict");
    await tx.googleLinkIntent.deleteMany({
      where: { OR: [{ userId: user.id }, { expiresAt: { lte: new Date() } }] },
    });
    await tx.googleLinkIntent.create({
      data: {
        userId: user.id,
        sessionVersion: user.sessionVersion,
        tokenHash: googleLinkHash(raw),
        expiresAt: new Date(Date.now() + GOOGLE_RECENT_AUTH_MS),
      },
    });
  });
  return raw;
}

/** Called only after Auth.js has validated Google's OIDC response. Provider sub
 * is the identity; email only prevents accidental duplicate accounts. */
export async function resolveGoogleUser(
  profileInput: unknown,
  providerAccountId: string,
  session: GoogleSession | null,
  linkToken?: string,
): Promise<User> {
  if (!env().GOOGLE_AUTH_ENABLED) throw new GoogleAuthError("unavailable");
  const profile = GoogleProfileSchema.parse(profileInput);
  if (profile.sub !== providerAccountId) throw new GoogleAuthError("provider-conflict");
  // Key the valid identity, not the shared network used by event participants.
  // This covers registration, returning login and callback linking writes.
  const limit = await rateLimit(`google-callback:${googleLinkHash(profile.sub)}`, 20, 600);
  if (!limit.ok) throw new GoogleAuthError("rate-limited");
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const identity = await tx.googleIdentity.findUnique({
            where: {
              provider_providerAccountId: { provider: "google", providerAccountId: profile.sub },
            },
            include: { user: true },
          });
          if (linkToken) {
            const intent = await tx.googleLinkIntent.findUnique({
              where: { tokenHash: googleLinkHash(linkToken) },
            });
            if (
              !intent ||
              !session ||
              intent.userId !== session.id ||
              intent.sessionVersion !== session.sessionVersion ||
              intent.expiresAt <= new Date() ||
              !recentGoogleAuthentication(session.authenticatedAt)
            )
              throw new GoogleAuthError("link-expired");
            const user = await tx.user.findUnique({ where: { id: session.id } });
            if (
              !user?.isActive ||
              user.role === "SANDBOX" ||
              user.sessionVersion !== intent.sessionVersion
            )
              throw new GoogleAuthError("account-disabled");
            if (identity && identity.userId !== user.id)
              throw new GoogleAuthError("provider-conflict");
            const emailOwner = await tx.user.findFirst({
              where: {
                email: { equals: profile.email, mode: "insensitive" },
                id: { not: user.id },
              },
            });
            if (emailOwner) throw new GoogleAuthError("email-conflict");
            // Never update an existing account's email, role or audience on linking.
            await tx.googleIdentity.create({
              data: { provider: "google", providerAccountId: profile.sub, userId: user.id },
            });
            const consumed = await tx.googleLinkIntent.deleteMany({
              where: { id: intent.id, expiresAt: { gt: new Date() } },
            });
            if (consumed.count !== 1) throw new GoogleAuthError("link-expired");
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: "USER_GOOGLE_LINK",
                metadata: { provider: "google" },
              },
            });
            return user;
          }
          if (identity) {
            if (!identity.user.isActive || identity.user.role === "SANDBOX")
              throw new GoogleAuthError("account-disabled");
            if (session && session.id !== identity.userId)
              throw new GoogleAuthError("provider-conflict");
            // A stale authenticated cookie must not revive a revoked session.
            if (session && session.sessionVersion !== identity.user.sessionVersion)
              throw new GoogleAuthError("account-disabled");
            return identity.user;
          }
          if (session) throw new GoogleAuthError("link-required");
          if (!env().ALLOW_GOOGLE_REGISTRATION) throw new GoogleAuthError("registration-closed");
          if (
            await tx.user.findFirst({
              where: { email: { equals: profile.email, mode: "insensitive" } },
            })
          )
            throw new GoogleAuthError("email-conflict");
          const user = await tx.user.create({
            data: {
              username: `google_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
              email: profile.email,
              passwordHash: null,
              role: "USER",
              analyticsAudience: "EXTERNAL",
              googleIdentities: { create: { provider: "google", providerAccountId: profile.sub } },
            },
          });
          await tx.auditLog.create({
            data: { userId: user.id, action: "USER_REGISTER", metadata: { method: "google" } },
          });
          return user;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      // All writes roll back before retry: competing sub/email/username requests
      // can never leave a user without its identity or reassign the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code) &&
        attempt < 3
      )
        continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new GoogleAuthError("provider-conflict");
      throw error;
    }
  }
  throw new GoogleAuthError("provider-conflict");
}
