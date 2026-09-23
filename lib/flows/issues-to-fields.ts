import type { ValidationIssue } from "./issue";

/**
 * The `error.fields` body for a refused flow: every issue kept (two on one
 * path accumulate rather than the second overwriting the first), each as the
 * sentence the builder shows for the same rule.
 */
export function issuesToFields(issues: readonly ValidationIssue[]): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of issues) {
    (fields[issue.path] ??= []).push(issue.friendlyMessage);
  }
  return fields;
}
