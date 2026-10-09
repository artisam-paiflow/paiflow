import { describe, expect, it } from "vitest";
import { assertTtlCapacityEnvironment } from "@/scripts/ttl-capacity-guard";

const local = {
  NODE_ENV: "test" as const,
  STELLAR_NETWORK: "testnet" as const,
  DATABASE_URL: "postgresql://capacity:local-only@127.0.0.1:55484/ttl_capacity",
  REDIS_URL: "redis://127.0.0.1:56384/0",
};

describe("local capacity rehearsal boundary", () => {
  it("accepts only the dedicated loopback service locations", () => {
    expect(() => assertTtlCapacityEnvironment(local)).not.toThrow();
    expect(() =>
      assertTtlCapacityEnvironment({
        ...local,
        DATABASE_URL: "postgresql://localhost:55484/ttl_capacity",
        REDIS_URL: "redis://localhost:56384",
      }),
    ).not.toThrow();
  });
  it.each(["development", "production"] as const)("rejects %s mode", (NODE_ENV) => {
    expect(() => assertTtlCapacityEnvironment({ ...local, NODE_ENV })).toThrow();
  });
  it("rejects mainnet", () => {
    expect(() => assertTtlCapacityEnvironment({ ...local, STELLAR_NETWORK: "mainnet" })).toThrow();
  });
  it.each([
    "postgresql://example.com:55484/ttl_capacity",
    "postgresql://localhost:5432/ttl_capacity",
    "postgresql://localhost:55484/paiflow",
    "postgresql://localhost:55484/ttl_capacity?schema=other",
    "postgresql://localhost:55484/ttl_capacity#fragment",
    "https://localhost:55484/ttl_capacity",
    "not-a-url",
  ])("rejects database destination %s", (DATABASE_URL) => {
    expect(() => assertTtlCapacityEnvironment({ ...local, DATABASE_URL })).toThrow();
  });
  it.each([
    undefined,
    "redis://example.com:56384/0",
    "redis://localhost:6379/0",
    "redis://localhost:56384/1",
    "redis://localhost:56384/0?db=1",
    "redis://localhost:56384/0#fragment",
    "https://localhost:56384/0",
    "not-a-url",
  ])("rejects Redis destination %s", (REDIS_URL) => {
    expect(() => assertTtlCapacityEnvironment({ ...local, REDIS_URL })).toThrow();
  });
});
