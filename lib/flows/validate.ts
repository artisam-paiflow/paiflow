import { TemplateKind } from "@prisma/client";
import {
  FlowGraphSchema,
  type FlowGraph,
  type FlowNode,
  isAction,
  isLogic,
  isTrigger,
} from "./schema";

export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  | { ok: true; templateKind: TemplateKind; graph: FlowGraph }
  | { ok: false; errors: ValidationIssue[] };

export function validateFlow(rawGraph: unknown): ValidationResult {
  const parsed = FlowGraphSchema.safeParse(rawGraph);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }
  const graph = parsed.data;
  const errors: ValidationIssue[] = [];

  const nodesById = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, n]));

  for (const e of graph.edges) {
    if (!nodesById.has(e.source))
      errors.push({ path: `edges.${e.id}`, message: `Unknown source ${e.source}` });
    if (!nodesById.has(e.target))
      errors.push({ path: `edges.${e.id}`, message: `Unknown target ${e.target}` });
  }
  if (errors.length) return { ok: false, errors };

  const triggers = graph.nodes.filter(isTrigger);
  if (triggers.length !== 1) {
    errors.push({ path: "nodes", message: "Flow must have exactly one trigger node" });
  }
  const actions = graph.nodes.filter(isAction);
  if (actions.length < 1) {
    errors.push({ path: "nodes", message: "Flow must have at least one action node" });
  }

  for (const a of actions) {
    if (a.type === "split") {
      const sum = a.config.recipients.reduce((s, r) => s + r.bps, 0);
      if (sum !== 10_000) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: `Recipient basis points must sum to 10000 (got ${sum})`,
        });
      }
    }
  }

  // Detect cycles via DFS
  const adj = new Map<string, string[]>();
  for (const n of graph.nodes) adj.set(n.id, []);
  for (const e of graph.edges) adj.get(e.source)!.push(e.target);
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  function dfs(id: string): boolean {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      const c = color.get(next);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  }
  for (const n of graph.nodes) {
    if (color.get(n.id) === WHITE && dfs(n.id)) {
      errors.push({ path: "edges", message: "Flow contains a cycle" });
      break;
    }
  }

  // Trigger must be a root (no incoming edges)
  const trigger = triggers[0];
  if (trigger) {
    const hasIncoming = graph.edges.some((e) => e.target === trigger.id);
    if (hasIncoming) {
      errors.push({ path: "nodes", message: "Trigger node must have no incoming edges" });
    }
  }

  // Reachability from trigger
  if (trigger) {
    const seen = new Set<string>([trigger.id]);
    const stack = [trigger.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    for (const a of actions) {
      if (!seen.has(a.id)) {
        errors.push({
          path: `nodes.${a.id}`,
          message: `Action ${a.id} is not reachable from the trigger`,
        });
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  // Infer template kind
  const action = actions[0]!;
  const hasCondition = graph.nodes.some(isLogic);
  let templateKind: TemplateKind;
  if (hasCondition) {
    templateKind = TemplateKind.CONDITIONAL;
  } else if (trigger!.type === "on_schedule" && action.type === "pay") {
    templateKind = TemplateKind.STREAMER;
  } else if (trigger!.type === "on_receive" && action.type === "split") {
    templateKind = TemplateKind.SPLITTER;
  } else if (trigger!.type === "on_receive" && action.type === "pay") {
    templateKind = TemplateKind.SPLITTER; // a 1-recipient split = pay-through
  } else {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message:
            "Unsupported trigger/action combination. Supported: on_receive→split, on_schedule→pay, *+condition→pay/split",
        },
      ],
    };
  }

  return { ok: true, templateKind, graph };
}
