import { useEffect, useRef } from "react";
import type { FlowNode } from "@/lib/flows/schema";
import type { ValidationIssue } from "@/lib/flows/validate";
import { track } from "./client";
import { messageKey } from "./sanitize";

/**
 * A stable grouping key for a validation issue path. Node ids are random per
 * flow, so `nodes.<uuid>.config.recipients.2.amountStroops` becomes
 * `split.config.recipients.#.amountStroops`: the same mistake on any tester's
 * flow is one PostHog breakdown row.
 */
export function validationErrorKey(
  path: string,
  typeById: ReadonlyMap<string, string>,
): { key: string; nodeType: string | null } {
  const [head, id, ...rest] = path.split(".");
  if (head === "nodes" && id !== undefined) {
    const nodeType = typeById.get(id) ?? null;
    const tail = rest.map((seg) => (/^\d+$/.test(seg) ? "#" : seg));
    return { key: [nodeType ?? "node", ...tail].join("."), nodeType };
  }
  if (head === "edges") return { key: "edges", nodeType: null };
  return { key: path.replace(/\.\d+(?=\.|$)/g, ".#"), nodeType: null };
}

// Issues flicker while someone types an address or an amount; only an issue
// that survives this long counts as one the tester actually saw.
const SETTLE_MS = 1_500;

/**
 * Emits `validation_error_appeared` / `_resolved` as the builder's issue list
 * changes, with how long each issue stayed open. The resolve time for swap
 * fields is the before/after measure for the D3 swap-panel rebuild.
 */
export function useValidationTracking(issues: ValidationIssue[], nodes: FlowNode[]): void {
  const open = useRef(new Map<string, { since: number; nodeType: string | null }>());

  useEffect(() => {
    const timer = setTimeout(() => {
      const typeById = new Map(nodes.map((n) => [n.id, n.type]));
      const current = new Map<string, { nodeType: string | null; message: string }>();
      for (const issue of issues) {
        const { key, nodeType } = validationErrorKey(issue.path, typeById);
        if (!current.has(key)) current.set(key, { nodeType, message: issue.friendlyMessage });
      }

      const now = Date.now();
      for (const [key, { nodeType, message }] of current) {
        if (open.current.has(key)) continue;
        open.current.set(key, { since: now, nodeType });
        track("validation_error_appeared", {
          error_key: key,
          node_type: nodeType,
          message_key: messageKey(message),
        });
      }
      for (const [key, { since, nodeType }] of open.current) {
        if (current.has(key)) continue;
        open.current.delete(key);
        track("validation_error_resolved", {
          error_key: key,
          node_type: nodeType,
          time_to_resolve_ms: now - since,
        });
      }
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [issues, nodes]);
}
