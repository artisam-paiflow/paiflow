import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next-auth", () => ({ default: () => ({ auth: (fn: unknown) => fn }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
import middleware from "@/middleware";
const id = "11111111-1111-4111-8111-111111111111";
const run = middleware as unknown as (
  req: NextRequest & { auth: { user: { id: string; role: string } } | null },
) => Response;
function request(path: string, role: string | null = null) {
  return Object.assign(new NextRequest(`https://paiflow.test${path}`), {
    auth: role ? { user: { id: "viewer", role } } : null,
  });
}
describe("public subscription approval boundary", () => {
  it.each([
    `/allowance/${id}`,
    `/api/deployments/${id}/subscription-allowance`,
    `/api/deployments/${id}/subscription-allowance/submit`,
    `/api/deployments/${id}/subscription-allowance/status`,
  ])("opens only the scoped customer path %s and retains sandbox exclusion", (path) => {
    expect(run(request(path)).status).toBe(200);
    const sandbox = run(request(path, "SANDBOX"));
    expect(sandbox.status).toBe(path.startsWith("/api/") ? 403 : 307);
  });
  it.each([
    "invoke",
    "submit-invoke",
    "subscription-charge",
    "subscription-subscribe",
    "subscription-unsubscribe",
    "subscription-allowance/charge",
    "subscription-allowance/submit/extra",
  ])("keeps sibling %s session protected", (endpoint) => {
    expect(run(request(`/api/deployments/${id}/${endpoint}`)).status).toBe(401);
  });
});
