import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "./db";
import { env } from "./env";
import { log } from "./log";
import { audit } from "./audit";
import { AppError } from "./errors";
import { Role } from "@prisma/client";
import { authConfig as edgeConfig } from "@/auth.config";

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const CredentialsSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

async function authorizeUser(input: unknown): Promise<{
  id: string;
  username: string;
  role: Role;
} | null> {
  const parsed = CredentialsSchema.safeParse(input);
  if (!parsed.success) return null;
  const { username, password } = parsed.data;

  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.isActive) {
    log.info({ username }, "login: unknown or inactive user");
    return null;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    log.warn({ username }, "login: account locked");
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
    return null;
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await audit({ action: "USER_LOGIN", userId: user.id });

  return { id: user.id, username: user.username, role: user.role };
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

export type SessionUser = {
  id: string;
  username: string;
  role: Role;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    username: (session.user as { username?: string }).username ?? "",
    role: ((session.user as { role?: Role }).role ?? Role.USER) as Role,
  };
}

export async function requireSession(opts?: { role?: Role }): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication required");
  if (opts?.role && user.role !== opts.role && user.role !== Role.ADMIN) {
    throw new AppError("FORBIDDEN", "Insufficient permissions");
  }
  return user;
}
