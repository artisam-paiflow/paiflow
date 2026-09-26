import type { ValidationIssue } from "./issue";

/**
 * One node's issues, split into per-field messages (keyed by config path, e.g.
 * "recipient" or "recipients.0.address") and node-level messages with no single
 * field to attach to. Paths come in two dialects: Zod's positional
 * `nodes.<index>.config…` (reached only when the shape fails to parse, hence
 * `nodeIndex`) and the semantic `nodes.<id>.config…`. The first issue on a
 * field wins.
 */
export function nodeIssues(
  issues: readonly ValidationIssue[],
  nodeId: string,
  nodeIndex: number,
): { field: Map<string, string>; general: string[] } {
  const field = new Map<string, string>();
  const general: string[] = [];
  for (const issue of issues) {
    const seg = issue.path.split(".");
    const key = seg[0] === "nodes" ? seg[1] : undefined;
    const isThisNode =
      key === nodeId || (key !== undefined && /^\d+$/.test(key) && Number(key) === nodeIndex);
    if (!isThisNode) continue;
    if (seg[2] === "config" && seg.length > 3) {
      const fieldPath = seg.slice(3).join(".");
      if (!field.has(fieldPath)) field.set(fieldPath, issue.friendlyMessage);
    } else {
      general.push(issue.friendlyMessage);
    }
  }
  return { field, general };
}
