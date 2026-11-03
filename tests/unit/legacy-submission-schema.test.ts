import { describe, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import {
  LegacyInvokePrepareSchema,
  LegacySubmitSchema,
  LegacyTriggerPrepareSchema,
  LegacyWalletPrepareSchema,
} from "@/lib/legacy-submission/schema";

const account = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 5));

describe("legacy wallet request schemas", () => {
  it("retains large stroop amounts exactly as decimal strings", () => {
    const input = { amount: "9007199254740993", userAddress: account };
    expect(LegacyTriggerPrepareSchema.parse(input)).toEqual(input);
  });

  it.each([0, 1.5, "0", "-1", "1.5", "1e7", "", null])(
    "refuses unsafe or nonpositive payment amount %s",
    (amount) => {
      expect(LegacyTriggerPrepareSchema.safeParse({ amount, userAddress: account }).success).toBe(
        false,
      );
    },
  );

  it.each(["invalid", contract, "", null])("refuses a non-account payer %s", (userAddress) => {
    expect(LegacyTriggerPrepareSchema.safeParse({ amount: "1", userAddress }).success).toBe(false);
    expect(LegacyWalletPrepareSchema.safeParse({ userAddress }).success).toBe(false);
  });

  it.each(["pause", "unpause", "retrieve_unvested"])(
    "accepts the named streamer preparation %s",
    (method) => {
      expect(
        LegacyInvokePrepareSchema.parse({
          method,
          contractAddress: contract,
          userAddress: account,
        }),
      ).toEqual({ method, contractAddress: contract, userAddress: account });
    },
  );

  it.each(["approve", "charge_by_relayer", "deposit", "execute_v1", "set_relayer"])(
    "refuses arbitrary control preparation %s",
    (method) => {
      expect(
        LegacyInvokePrepareSchema.safeParse({
          method,
          contractAddress: contract,
          userAddress: account,
        }).success,
      ).toBe(false);
    },
  );

  it("refuses account addresses as contract targets", () => {
    expect(
      LegacyInvokePrepareSchema.safeParse({
        method: "pause",
        contractAddress: account,
        userAddress: account,
      }).success,
    ).toBe(false);
  });

  it("refuses extra authority fields at every request boundary", () => {
    expect(
      LegacyTriggerPrepareSchema.safeParse({
        amount: "1",
        userAddress: account,
        deploymentId: "other",
      }).success,
    ).toBe(false);
    expect(
      LegacyInvokePrepareSchema.safeParse({
        method: "pause",
        contractAddress: contract,
        userAddress: account,
        sourceAccount: account,
      }).success,
    ).toBe(false);
    expect(
      LegacyWalletPrepareSchema.safeParse({ userAddress: account, method: "charge" }).success,
    ).toBe(false);
    expect(
      LegacySubmitSchema.safeParse({ signedXdr: "envelope-value", intent: "untrusted" }).success,
    ).toBe(false);
  });

  it("bounds envelope input without accepting missing or oversized bodies", () => {
    expect(LegacySubmitSchema.parse({ signedXdr: "envelope-value" })).toEqual({
      signedXdr: "envelope-value",
    });
    for (const signedXdr of [undefined, null, 1, "short", "x".repeat(200_001)]) {
      expect(LegacySubmitSchema.safeParse({ signedXdr }).success).toBe(false);
    }
  });
});
