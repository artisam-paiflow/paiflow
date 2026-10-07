import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
import middleware from "@/middleware";
import { isSandboxAllowed } from "@/lib/sandbox-paths";
const ID = "11111111-1111-4111-8111-111111111111";
const run = middleware as unknown as (
  req: NextRequest & { auth: { user: { id: string; role: string } } | null },
) => Response;
describe("public embed middleware boundary", () => {
  it.each([null, "USER", "SANDBOX"])("permits only the enumerated public reads for %s", (role) => {
    for (const endpoint of ["events", "activity", "qr"]) {
      const path = `/api/deployments/${ID}/embed/${endpoint}`;
      const request = Object.assign(new NextRequest(`https://paiflow.test${path}`), {
        auth: role ? { user: { id: "viewer", role } } : null,
      });
      expect(run(request).status).toBe(200);
      expect(isSandboxAllowed(path)).toBe(true);
    }
  });
  it.each(["events", "poll-events", "qr", "sep7", "balances", "invoke", "submit-invoke"])(
    "keeps owner %s closed to anonymous visitors",
    (endpoint) => {
      const request = Object.assign(
        new NextRequest(`https://paiflow.test/api/deployments/${ID}/${endpoint}`),
        { auth: null },
      );
      expect(run(request).status).toBe(401);
    },
  );
  it.each(["execute", "dev-pay", "invoke", "allowance"])(
    "does not open public embed sibling %s",
    (endpoint) => {
      const path = `/api/deployments/${ID}/embed/${endpoint}`;
      expect(
        run(Object.assign(new NextRequest(`https://paiflow.test${path}`), { auth: null })).status,
      ).toBe(401);
      expect(isSandboxAllowed(path)).toBe(false);
    },
  );
});
