import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { WalletConnectionSchema } from "@/lib/analytics/schema";
import {
  CreateAnalyticsAccountSchema,
  PatchAnalyticsAccountSchema,
} from "@/lib/analytics/account-schema";
import { UsageReportSchema } from "@/lib/analytics/report-schema";
const input = {
  connectionId: "00000000-0000-0000-0000-000000000001",
  address: Keypair.random().publicKey(),
  network: "testnet",
  walletId: "freighter",
  surface: "trigger",
  sessionUserId: null,
};
describe("analytics boundaries", () => {
  it("parses acknowledged anonymous wallet connections", () =>
    expect(WalletConnectionSchema.parse(input)).toEqual(input));
  it.each([
    { connectionId: "bad" },
    { address: Keypair.random().secret() },
    { network: "other" },
    { surface: "account" },
    { walletId: "" },
    { sessionUserId: "bad" },
    { audience: "EXTERNAL" },
  ])("rejects invalid or self-classified input %j", (override) =>
    expect(WalletConnectionSchema.safeParse({ ...input, ...override }).success).toBe(false),
  );
  it("requires deliberate admin classification without granting roles", () => {
    const user = { username: "new-user", password: "a-strong-local-password" };
    expect(CreateAnalyticsAccountSchema.safeParse(user).success).toBe(false);
    expect(
      CreateAnalyticsAccountSchema.parse({ ...user, analyticsAudience: "EXTERNAL" }).role,
    ).toBe("USER");
    expect(PatchAnalyticsAccountSchema.safeParse({ analyticsAudience: "SANDBOX" }).success).toBe(
      false,
    );
    expect(PatchAnalyticsAccountSchema.parse({ analyticsAudience: "INTERNAL" })).toEqual({
      analyticsAudience: "INTERNAL",
    });
  });
  it("requires explicit bounded report dates, network and audience", () => {
    const report = {
      start: "2026-10-05T00:00:00Z",
      end: "2026-10-06T00:00:00Z",
      network: "testnet",
      audience: "UNCLASSIFIED",
    };
    expect(UsageReportSchema.safeParse(report).success).toBe(true);
    for (const override of [
      { end: report.start },
      { start: "yesterday" },
      { network: "any" },
      { audience: "all" },
      { extra: "secret" },
    ])
      expect(UsageReportSchema.safeParse({ ...report, ...override }).success).toBe(false);
  });
});
