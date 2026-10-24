import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeveloperTokenDeploymentQuerySchema,
  DeveloperTokenListQuerySchema,
} from "@/lib/developer-tokens/schema";
import { listEligibleDeployments } from "@/lib/developer-tokens/service";
import { GET } from "@/app/api/developer-tokens/deployments/route";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { deployment: { findMany: mocks.findMany } } }));
vi.mock("@/lib/auth", () => ({ requireSession: mocks.session }));
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.session.mockResolvedValue({ id: "owner", role: "USER" });
});
describe("developer deployment search", () => {
  it("bounds and trims search without accepting it on the token list", () => {
    expect(DeveloperTokenDeploymentQuerySchema.parse({ search: "  Donations " })).toEqual({
      limit: 20,
      search: "Donations",
    });
    expect(DeveloperTokenDeploymentQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const search of [null, 5, ["name"], "a".repeat(101)])
      expect(DeveloperTokenDeploymentQuerySchema.safeParse({ search }).success).toBe(false);
    for (const query of [{ cursor: "bad" }, { limit: 101 }, { limit: 0 }, { unknown: "name" }])
      expect(DeveloperTokenDeploymentQuerySchema.safeParse(query).success).toBe(false);
    expect(DeveloperTokenListQuerySchema.safeParse({ search: "Donations" }).success).toBe(false);
  });
  it("keeps owner, eligibility, cursor and page bounds on name searches", async () => {
    mocks.findMany.mockResolvedValue([
      { id: A, network: "testnet", flow: { name: "Donations" } },
      { id: B, network: "testnet", flow: { name: "Donations 2" } },
    ]);
    const result = await listEligibleDeployments("owner", {
      search: "Donations",
      cursor: A,
      limit: 1,
    });
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        ownerId: "owner",
        status: "CONFIRMED",
        serviceState: "ACTIVE",
        id: { gt: A },
        OR: [{ flow: { name: { contains: "Donations", mode: "insensitive" } } }],
      },
      orderBy: { id: "asc" },
      take: 2,
      select: { id: true, network: true, flow: { select: { name: true } } },
    });
    expect(result).toEqual({
      items: [{ id: A, network: "testnet", flowName: "Donations" }],
      nextCursor: A,
    });
  });
  it("uses exact valid UUID matches while treating arbitrary text as a name", async () => {
    await listEligibleDeployments("owner", { search: A.toUpperCase(), limit: 20 });
    expect(mocks.findMany.mock.calls[0]?.[0].where.OR).toContainEqual({ id: A });
    await listEligibleDeployments("owner", { search: "not-a-uuid%_", limit: 20 });
    expect(mocks.findMany.mock.calls[1]?.[0].where.OR).toHaveLength(1);
    const escape = String.fromCharCode(92);
    expect(mocks.findMany.mock.calls[1]?.[0].where.OR[0].flow.name.contains).toBe(
      `not-a-uuid${escape}%${escape}_`,
    );
  });
  it("authenticates and validates search at the route; rejects duplicate or oversized input", async () => {
    const request = (query: string) =>
      new NextRequest(`http://localhost/api/developer-tokens/deployments?${query}`);
    const result = await GET(request("search=Donations&limit=1"));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.findMany.mock.calls[0]?.[0].where.ownerId).toBe("owner");
    for (const query of [
      "search=one&search=two",
      `search=${"a".repeat(101)}`,
      "search=name&cursor=bad",
    ])
      expect((await GET(request(query))).status).toBe(422);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    mocks.session.mockResolvedValue({ id: "sandbox", role: "SANDBOX" });
    expect((await GET(request("search=Donations"))).status).toBe(403);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });
});
