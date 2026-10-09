/** Versioned future-only policy. The DB records the actual activation timestamp. */
export const TRACKING_VERSION = "usage-v2";
export const AUDIENCES = ["INTERNAL", "EXTERNAL", "SANDBOX", "UNCLASSIFIED"] as const;
export type Audience = (typeof AUDIENCES)[number];
export function audienceFor(
  user: { role: string; analyticsAudience?: string | null } | null,
): Audience {
  if (user?.role === "SANDBOX") return "SANDBOX";
  return user?.analyticsAudience === "INTERNAL" || user?.analyticsAudience === "EXTERNAL"
    ? user.analyticsAudience
    : "UNCLASSIFIED";
}
export const APPROVED_CONTROLS = [
  "nav-flows",
  "new-flow",
  "create-flow",
  "template-select",
  "help-guide",
  "builder-validate",
  "builder-zoom-in",
  "builder-zoom-out",
  "builder-fit-view",
] as const;
export const CONTROL_SELECTORS = APPROVED_CONTROLS.map(
  (id) => `button[data-analytics-control="${id}"],a[data-analytics-control="${id}"]`,
);
const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ROUTES = ["/", "/dashboard", "/login", "/guide", "/templates"];
/** No query, fragment, free-form route segment or account/admin/credential page. */
export function analyticsRoute(path: string): string | null {
  if (ROUTES.includes(path)) return path;
  for (const prefix of ["flows", "deployments", "trigger", "allowance"]) {
    const match = path.match(new RegExp(`^/${prefix}/${UUID}(/deploy|/embed)?$`));
    if (match) return `/${prefix}/:id${match[1] ?? ""}`;
  }
  return null;
}
