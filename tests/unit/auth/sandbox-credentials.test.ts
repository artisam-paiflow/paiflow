/**
 * The sandbox account is created with a sentinel in `passwordHash` instead of
 * an argon2 hash of a random string (app/api/auth/sandbox/route.ts), so that an
 * unauthenticated endpoint does not run a 19 MiB, two-pass KDF per request.
 * That is only safe if the sentinel can never verify, which is a property of
 * argon2.verify rejecting a non-PHC string — asserted here directly.
 *
 * `lib/auth.ts` itself cannot be imported under vitest (it pulls in NextAuth,
 * which fails to resolve `next/server` in this runtime — see CLAUDE.md §19 on
 * the auth helpers being uncovered), so this tests the guarantee its
 * verifyPassword() wrapper depends on rather than the wrapper.
 */
import { describe, expect, it } from "vitest";
import argon2 from "argon2";
import { SANDBOX_PASSWORD_SENTINEL as SENTINEL } from "@/lib/sandbox";

describe("the sandbox account's stored password can never open it", () => {
  it("argon2 refuses the sentinel as a hash, for every candidate password", async () => {
    for (const candidate of [SENTINEL, "", "password", "sandbox"]) {
      // verifyPassword() catches this throw and returns false.
      await expect(argon2.verify(SENTINEL, candidate)).rejects.toThrow();
    }
  });

  it("a real argon2 hash still verifies, so the wrapper is not simply broken", async () => {
    const hash = await argon2.hash("correct horse", {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    expect(await argon2.verify(hash, "correct horse")).toBe(true);
    expect(await argon2.verify(hash, "wrong")).toBe(false);
  });
});
