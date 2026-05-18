import { TemplateKind } from "@prisma/client";
import {
  FlowGraphSchema,
  type FlowGraph,
  type FlowNode,
  isAction,
  isLogic,
  isTrigger,
  isPendingAddress,
} from "./schema";

export type ValidationIssue = { path: string; message: string; friendlyMessage: string };

export type ValidationResult =
  | { ok: true; templateKind: TemplateKind; graph: FlowGraph; pendingLabels: string[] }
  | { ok: false; errors: ValidationIssue[] };

const FRIENDLY = {
  EXACTLY_ONE_TRIGGER:
    "A flow can only have one trigger — either 'when I receive' or 'on a schedule', not both. Try splitting this into two separate flows.",
  NO_INCOMING_EDGES_TO_TRIGGER:
    "The trigger (start of your flow) can't have anything feeding into it. Remove any connections going into the trigger.",
  AT_LEAST_ONE_ACTION:
    "Your flow needs at least one action (a payment or split) after the trigger. Add a pay or split step.",
  CYCLE:
    "Your flow loops back on itself — steps can't feed into earlier steps. Remove the connection that creates the loop.",
  BPS_SUM: (got: number) =>
    `The percentages for your split don't add up to 100% (currently ${got / 100}%). Adjust them to total 100%.`,
  DUPLICATE_ADDRESS: (addr: string) =>
    `The address ${addr} appears more than once in your split recipients. Each recipient should only appear once.`,
  ACTION_UNREACHABLE: (id: string) =>
    `"${id}" isn't connected to anything. Connect it to the trigger or another step.`,
  UNSUPPORTED_COMBO:
    "This trigger/action combination isn't supported. You can use: receive→pay, receive→split, schedule→pay, schedule→split, or add a condition to any of these.",
  MISSING_EDGE_SOURCE: (eid: string, src: string) =>
    `The connection "${eid}" references a node "${src}" that doesn't exist.`,
  MISSING_EDGE_TARGET: (eid: string, tgt: string) =>
    `The connection "${eid}" references a node "${tgt}" that doesn't exist.`,
} as const;

export function validateFlow(rawGraph: unknown): ValidationResult {
  const parsed = FlowGraphSchema.safeParse(rawGraph);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        friendlyMessage: "The flow structure is invalid. Check your node types and configuration.",
      })),
    };
  }
  const graph = parsed.data;
  const errors: ValidationIssue[] = [];
  const pendingLabels = new Set<string>();

  const nodesById = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, n]));

  for (const e of graph.edges) {
    if (!nodesById.has(e.source)) {
      errors.push({
        path: `edges.${e.id}`,
        message: `Unknown source ${e.source}`,
        friendlyMessage: FRIENDLY.MISSING_EDGE_SOURCE(e.id, e.source),
      });
    }
    if (!nodesById.has(e.target)) {
      errors.push({
        path: `edges.${e.id}`,
        message: `Unknown target ${e.target}`,
        friendlyMessage: FRIENDLY.MISSING_EDGE_TARGET(e.id, e.target),
      });
    }
  }
  if (errors.length) return { ok: false, errors };

  const triggers = graph.nodes.filter(isTrigger);
  if (triggers.length !== 1) {
    errors.push({
      path: "nodes",
      message: "Flow must have exactly one trigger node",
      friendlyMessage: FRIENDLY.EXACTLY_ONE_TRIGGER,
    });
  }
  const actions = graph.nodes.filter(isAction);
  if (actions.length < 1) {
    errors.push({
      path: "nodes",
      message: "Flow must have at least one action node",
      friendlyMessage: FRIENDLY.AT_LEAST_ONE_ACTION,
    });
  }

  for (const a of actions) {
    if (a.type === "split") {
      const sum = a.config.recipients.reduce((s, r) => s + r.bps, 0);
      if (sum !== 10_000) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: `Recipient basis points must sum to 10000 (got ${sum})`,
          friendlyMessage: FRIENDLY.BPS_SUM(sum),
        });
      }
      const seen = new Set<string>();
      for (const r of a.config.recipients) {
        if (isPendingAddress(r.address)) {
          pendingLabels.add(r.label ?? "unnamed");
        } else {
          if (seen.has(r.address)) {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: `Duplicate address ${r.address} in split recipients`,
              friendlyMessage: FRIENDLY.DUPLICATE_ADDRESS(r.address),
            });
          }
          seen.add(r.address);
        }
      }
    }
    if (a.type === "pay" && isPendingAddress(a.config.recipient)) {
      pendingLabels.add("unnamed");
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
      errors.push({
        path: "edges",
        message: "Flow contains a cycle",
        friendlyMessage: FRIENDLY.CYCLE,
      });
      break;
    }
  }

  // Trigger must be a root (no incoming edges)
  const trigger = triggers[0];
  if (trigger) {
    const hasIncoming = graph.edges.some((e) => e.target === trigger.id);
    if (hasIncoming) {
      errors.push({
        path: "nodes",
        message: "Trigger node must have no incoming edges",
        friendlyMessage: FRIENDLY.NO_INCOMING_EDGES_TO_TRIGGER,
      });
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
          friendlyMessage: FRIENDLY.ACTION_UNREACHABLE(a.id),
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
  } else if (
    trigger!.type === "on_schedule" &&
    (action.type === "pay" || action.type === "split")
  ) {
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
            "Unsupported trigger/action combination. Supported: on_receive→split, on_receive→pay, on_schedule→pay, on_schedule→split, any trigger+condition→pay, any trigger+condition→split",
          friendlyMessage: FRIENDLY.UNSUPPORTED_COMBO,
        },
      ],
    };
  }

  return { ok: true, templateKind, graph, pendingLabels: [...pendingLabels] };
}
