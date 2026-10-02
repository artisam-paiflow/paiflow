import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { $queryRaw: vi.fn(async () => [{ "?column?": 1 }]) } }));
vi.mock("@/lib/redis", () => ({ redis: () => null }));
vi.mock("@/lib/stellar/client", () => ({ sorobanRpc: () => ({ getNetwork: async () => ({}) }) }));

import { GET } from "@/app/api/health/route";

// #553: QA recorded "candidate commit: not exposed". The build's short commit
// is what a tester quotes to name the candidate.
describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports the build's short commit", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "0731df8");
    expect(await (await GET()).json()).toEqual({
      status: "ok",
      version: "0731df8",
      db: "ok",
      redis: "disabled",
      rpc: "ok",
    });
  });

  it("says dev when the build has no commit", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", undefined);
    expect((await (await GET()).json()).version).toBe("dev");
  });
});
