import { z } from "zod";

export const GOOGLE_USERNAME_COOKIE =
  process.env.NODE_ENV === "production"
    ? "__Host-paiflow.google-username"
    : "paiflow.google-username";

export const GoogleUsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, numbers, dots, underscores or hyphens.");

export type GoogleUsername = z.infer<typeof GoogleUsernameSchema>;

/** A display suggestion only; Google identity always uses the verified provider sub. */
export function googleUsernameSuggestion(email: string): string {
  const prefix = email.split("@")[0] ?? "";
  const normalized = prefix
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .slice(0, 32);
  return normalized.length >= 3 && /[a-z0-9]/.test(normalized) ? normalized : "user";
}
