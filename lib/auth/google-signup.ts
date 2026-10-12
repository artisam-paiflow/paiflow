import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { GoogleUsernameSchema } from "@/lib/auth/google-username";

export const GOOGLE_SIGNUP_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-paiflow.google-signup" : "paiflow.google-signup";
export const GOOGLE_SIGNUP_INTENT_MS = 10 * 60_000;
export const CreateGoogleSignupCodeSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  })
  .strict();
export const GoogleSignupSchema = z
  .object({ code: z.string().trim().min(1).max(128), username: GoogleUsernameSchema.optional() })
  .strict();
export function signupHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export function signupCodeStatus(
  code: { disabledAt: Date | null; expiresAt: Date },
  now = new Date(),
) {
  return code.disabledAt ? "Disabled" : code.expiresAt <= now ? "Expired" : "Active";
}
export const signupCodeSelect = {
  id: true,
  label: true,
  createdAt: true,
  expiresAt: true,
  disabledAt: true,
} as const;

export async function listGoogleSignupCodes(cursor?: string) {
  const rows = await db.googleSignupCode.findMany({
    select: signupCodeSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 101,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const data = rows.slice(0, 100);
  return { data, nextCursor: rows.length > 100 ? data[data.length - 1]!.id : null };
}

export async function createGoogleSignupCode(input: unknown) {
  const { label, days } = CreateGoogleSignupCodeSchema.parse(input);
  const code = randomBytes(16).toString("hex");
  const row = await db.googleSignupCode.create({
    data: {
      label,
      codeHash: signupHash(code),
      expiresAt: new Date(Date.now() + days * 86_400_000),
    },
    select: signupCodeSelect,
  });
  return { ...row, code };
}

export async function createGoogleSignupIntent(codeInput: unknown, previousToken?: string) {
  if (!env().GOOGLE_AUTH_ENABLED || !env().ALLOW_GOOGLE_REGISTRATION)
    throw new AppError("FORBIDDEN", "New Google registrations are currently closed.");
  const parsed = GoogleSignupSchema.parse(codeInput);
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    // Retrying replaces this browser's grant. Old and cancelled grants are pruned.
    await tx.googleSignupIntent.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: new Date() } },
          ...(previousToken ? [{ tokenHash: signupHash(previousToken) }] : []),
        ],
      },
    });
    const code = await tx.googleSignupCode.findUnique({
      where: { codeHash: signupHash(parsed.code) },
    });
    if (!code)
      throw new AppError(
        "VALIDATION",
        "This code is not valid. Check it or ask your organizer for a code.",
      );
    const status = signupCodeStatus(code);
    if (status !== "Active")
      throw new AppError(
        "VALIDATION",
        `This code is ${status.toLowerCase()}. Ask your organizer for a new code.`,
      );
    await tx.googleSignupIntent.create({
      data: {
        tokenHash: signupHash(raw),
        codeId: code.id,
        username: parsed.username,
        expiresAt: new Date(
          Math.min(Date.now() + GOOGLE_SIGNUP_INTENT_MS, code.expiresAt.getTime()),
        ),
      },
    });
  });
  return raw;
}
