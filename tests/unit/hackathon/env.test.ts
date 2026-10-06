import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hackathonOrganiserSecret } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());
describe("local organiser configuration", () => {
  it.each([undefined, "mainnet", "TESTNET", "other"])("refuses network %s", (network) => {
    vi.stubEnv("STELLAR_NETWORK", network);
    vi.stubEnv("HACKATHON_ORGANISER_SECRET", Keypair.random().secret());
    expect(() => hackathonOrganiserSecret()).toThrow(/explicitly be testnet/);
  });
  it.each([undefined, "", "not-a-secret", Keypair.random().publicKey()])(
    "refuses missing or invalid organiser credentials without exposing them",
    (secret) => {
      vi.stubEnv("STELLAR_NETWORK", "testnet");
      vi.stubEnv("HACKATHON_ORGANISER_SECRET", secret);
      expect(() => hackathonOrganiserSecret()).toThrow(
        "HACKATHON_ORGANISER_SECRET must be a valid testnet organiser key",
      );
    },
  );
  it("accepts the event organiser secret on explicit testnet without app config", () => {
    const secret = Keypair.random().secret();
    vi.stubEnv("STELLAR_NETWORK", "testnet");
    vi.stubEnv("HACKATHON_ORGANISER_SECRET", secret);
    vi.stubEnv("DATABASE_URL", undefined);
    vi.stubEnv("AUTH_SECRET", undefined);
    expect(hackathonOrganiserSecret()).toBe(secret);
  });
});
