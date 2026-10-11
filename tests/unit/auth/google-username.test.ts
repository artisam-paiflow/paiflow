import { describe, expect, it } from "vitest";
import { GoogleUsernameSchema, googleUsernameSuggestion } from "@/lib/auth/google-username";

describe("Google username suggestions", () => {
  it.each([
    ["Maria.Santos@gmail.com", "maria.santos"],
    ["maria+event@example.com", "maria-event"],
    ["a@example.com", "user"],
    ["+++@example.com", "user"],
    ["a".repeat(80) + "@example.com", "a".repeat(32)],
  ])("normalizes %s to %s", (email, expected) => {
    expect(googleUsernameSuggestion(email)).toBe(expected);
    expect(GoogleUsernameSchema.safeParse(expected).success).toBe(true);
  });
});
