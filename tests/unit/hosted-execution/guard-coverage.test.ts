import { describe, expect, it } from "vitest";
import { isGuardedHostedRoute } from "@/tests/helpers/hosted-route-coverage";

const source =
  'import { hostedPublicRoute } from "@/lib/hosted-execution/routes"; export const POST = hostedPublicRoute("prepare");';
const path = "app/api/deployments/[id]/hosted-execution/prepare/route.ts";
describe("scoped hosted security-wrapper registration", () => {
  it("recognizes only an exact imported handler/action/path/method", () => {
    expect(isGuardedHostedRoute(source, path, "POST")).toBe(true);
    expect(isGuardedHostedRoute(source, path, "PATCH")).toBe(false);
    expect(isGuardedHostedRoute(source, path.replace("prepare/", "other/"), "POST")).toBe(false);
    expect(isGuardedHostedRoute(source.replace('("prepare")', '("submit")'), path, "POST")).toBe(
      false,
    );
    expect(
      isGuardedHostedRoute(
        source.replace("@/lib/hosted-execution/routes", "@/lib/other"),
        path,
        "POST",
      ),
    ).toBe(false);
    expect(
      isGuardedHostedRoute(
        source.replace(
          'export const POST = hostedPublicRoute("prepare")',
          "export const POST = unguarded()",
        ),
        path,
        "POST",
      ),
    ).toBe(false);
  });
  it("does not accept an unimported or shadowed updater", () => {
    const management = "app/api/deployments/[id]/hosted-execution/route.ts";
    expect(
      isGuardedHostedRoute("export const PATCH = updateHostedVisibility;", management, "PATCH"),
    ).toBe(false);
    expect(
      isGuardedHostedRoute(
        'import { updateHostedVisibility } from "@/lib/hosted-execution/routes"; export const PATCH = updateHostedVisibility;',
        management,
        "PATCH",
      ),
    ).toBe(true);
  });
});
