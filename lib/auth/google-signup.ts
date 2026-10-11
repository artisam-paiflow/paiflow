import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const GOOGLE_SIGNUP_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-paiflow.google-signup" : "paiflow.google-signup";
export const GOOGLE_SIGNUP_INTENT_MS = 10 * 60_000;
export const CreateGoogleSignupCodeSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    days: z.union([z.literal(1), z.literal(7), z.literal(30)]),
  })
  .strict();
export const GoogleSignupSchema = z.object({ code: z.string().trim().min(1).max(128) }).strict();
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
  const parsed = GoogleSignupSchema.safeParse(codeInput);
  if (!parsed.success) throw new AppError("VALIDATION", "Enter an access code to continue.");
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
      where: { codeHash: signupHash(parsed.data.code) },
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
        expiresAt: new Date(
          Math.min(Date.now() + GOOGLE_SIGNUP_INTENT_MS, code.expiresAt.getTime()),
        ),
      },
    });
  });
  return raw;
}
