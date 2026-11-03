import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
import middleware from "@/middleware";
const run = middleware as unknown as (req: NextRequest & { auth: null }) => Response;
const base = "/api/deployments/11111111-1111-4111-8111-111111111111/hosted-execution";
describe("hosted payment public allowlist", () => {
  it.each(["state", "ownership", "prepare", "submit", "receipt"])(
    "allows wallet-only %s to its explicit route guard",
    (endpoint) => {
      expect(
        run(
          Object.assign(new NextRequest(`https://paiflow.test${base}/${endpoint}`), { auth: null }),
        ).status,
      ).toBe(200);
    },
  );
  it.each(["", "/settings", "/invoke", "/prepare/more", "/receipts"])(
    "does not open management/sibling path %s",
    (suffix) => {
      expect(
        run(Object.assign(new NextRequest(`https://paiflow.test${base}${suffix}`), { auth: null }))
          .status,
      ).toBe(401);
    },
  );
});
