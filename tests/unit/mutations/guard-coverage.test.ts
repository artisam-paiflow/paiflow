import { describe, expect, it } from "vitest";
import { isGuardedMutationRoute } from "@/tests/helpers/mutation-route-coverage";

const source =
  'import { ownerMutationRoute } from "@/lib/mutations/http"; export const POST = ownerMutationRoute("prepare");';
const route = "app/api/deployments/[id]/configuration/prepare/route.ts";
describe("scoped owner mutation security wrapper recognition", () => {
  it.each([
    ["", "GET", "state"],
    ["history/", "GET", "history"],
    ["prepare/", "POST", "prepare"],
    ["submit/", "POST", "submit"],
    ["reconcile/", "POST", "reconcile"],
  ])("recognizes the exact %s handler", (suffix, method, action) => {
    expect(
      isGuardedMutationRoute(
        `import { ownerMutationRoute } from "@/lib/mutations/http"; export const ${method} = ownerMutationRoute("${action}");`,
        `app/api/deployments/[id]/configuration/${suffix}route.ts`,
        method!,
      ),
    ).toBe(true);
  });
  it.each([
    [source, route, "PATCH"],
    [source, route.replace("prepare/", "other/"), "POST"],
    [source, route.replace("configuration/", "another/"), "POST"],
    [source.replace('("prepare")', '("submit")'), route, "POST"],
    [source.replace("@/lib/mutations/http", "@/lib/other"), route, "POST"],
    ['export const POST = ownerMutationRoute("prepare");', route, "POST"],
    [source.replace("{ ownerMutationRoute }", "{ other as ownerMutationRoute }"), route, "POST"],
    [
      source
        .replace("{ ownerMutationRoute }", "{ ownerMutationRoute as alias }")
        .replace("= ownerMutationRoute(", "= alias("),
      route,
      "POST",
    ],
    [source.replace("import {", "import type {"), route, "POST"],
    [source.replace("{ ownerMutationRoute }", "{ type ownerMutationRoute }"), route, "POST"],
    [source.replace('ownerMutationRoute("prepare")', 'unrelated("prepare")'), route, "POST"],
    [
      source.replace('ownerMutationRoute("prepare")', 'ownerMutationRoute("prepare", unguarded)'),
      route,
      "POST",
    ],
    [source.replace('ownerMutationRoute("prepare")', "ownerMutationRoute(action)"), route, "POST"],
    [
      source.replace('ownerMutationRoute("prepare")', '(() => ownerMutationRoute("prepare"))'),
      route,
      "POST",
    ],
    [source.replace("export const POST", "const POST"), route, "POST"],
    [source.replace("export const POST", "export const GET"), route, "POST"],
    [source.replace("export const POST", "export let POST"), route, "POST"],
  ])("refuses unrelated/import-alias/wrong action or method variants %#", (text, path, method) => {
    expect(isGuardedMutationRoute(text!, path!, method!)).toBe(false);
  });
});
