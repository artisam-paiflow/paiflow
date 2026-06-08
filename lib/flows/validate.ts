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
import { flowToPipeline } from "./to-params";

export type ValidationIssue = { path: string; message: string; friendlyMessage: string };

export type ValidationResult =
  | {
      ok: true;
      templateKind: TemplateKind;
      pipeline: TemplateKind[];
      graph: FlowGraph;
      pendingLabels: string[];
    }
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
    if (a.type === "pay") {
      if (isPendingAddress(a.config.recipient)) {
        pendingLabels.add(a.config.recipient.slice(8) || "unnamed");
      }
      if (!a.config.fullAmount) {
        if (
          a.config.mode === "fixed" &&
          (!a.config.amountStroops || a.config.amountStroops === "0")
        ) {
          errors.push({
            path: `nodes.${a.id}.config.amountStroops`,
            message: "Pay node in fixed mode requires a positive amount",
            friendlyMessage: "Please enter a positive amount for the pay node.",
          });
        }
        if (
          a.config.mode === "percentage" &&
          (a.config.percentage === undefined || a.config.percentage <= 0)
        ) {
          errors.push({
            path: `nodes.${a.id}.config.percentage`,
            message: "Pay node in percentage mode requires a positive percentage",
            friendlyMessage: "Please enter a positive percentage for the pay node.",
          });
        }
      }
    }
    if (a.type === "yield" && isPendingAddress(a.config.vault)) {
      pendingLabels.add(a.config.vault.slice(8) || "unnamed");
    }
  }

  // Validate multisig thresholds
  for (const n of graph.nodes) {
    if (n.type === "condition" && n.config.kind === "multisig") {
      if (n.config.threshold > n.config.signers.length) {
        errors.push({
          path: `nodes.${n.id}.config.threshold`,
          message: `Threshold (${n.config.threshold}) cannot exceed number of signers (${n.config.signers.length})`,
          friendlyMessage: `Multisig threshold cannot be larger than the number of signers (${n.config.signers.length}).`,
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
  const condition = graph.nodes.find(isLogic);
  const hasCondition = condition != null;
  const isScheduleLike = trigger!.type === "on_schedule" || trigger!.type === "subscription";
  const isOnReceive = trigger!.type === "on_receive";
  const isWebhookLike =
    trigger!.type === "webhook" || trigger!.type === "web2_webhook" || trigger!.type === "oracle";
  const isReceiveLike = isOnReceive || isWebhookLike;
  const isPayOrSplit = action.type === "pay" || action.type === "split";
  const isSwapOrYield = action.type === "swap" || action.type === "yield";

  // Webhook-like triggers (webhook, web2_webhook, oracle) use receive_and_forward
  // on-chain, which is only compatible with swap, yield, and multisig.
  if (isWebhookLike && isPayOrSplit) {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message:
            "Webhook and oracle triggers are not compatible with pay or split actions. Use swap or yield instead.",
          friendlyMessage:
            "This trigger type can only be paired with swap or yield actions. Try changing your action block.",
        },
      ],
    };
  }
  if (isWebhookLike && hasCondition && condition.config.kind !== "multisig") {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message: "Webhook and oracle triggers are only compatible with multisig conditions.",
          friendlyMessage:
            "This trigger type only supports multisig conditions. Try removing the condition or changing it to multisig.",
        },
      ],
    };
  }

  let templateKind: TemplateKind;
  if (hasCondition) {
    templateKind = TemplateKind.CONDITIONAL;
  } else if (isScheduleLike && isPayOrSplit) {
    templateKind = TemplateKind.STREAMER;
  } else if (isOnReceive && isPayOrSplit) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isOnReceive && isSwapOrYield) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isWebhookLike && isSwapOrYield) {
    templateKind = TemplateKind.SPLITTER;
  } else if (trigger!.type === "oracle") {
    templateKind = TemplateKind.CONDITIONAL;
  } else {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message:
            "Unsupported trigger/action combination. Supported: on_receive with pay/split/swap/yield, webhook/web2_webhook/oracle with swap/yield/multisig, schedule-like triggers (on_schedule, subscription) with pay/split, or any with a compatible condition.",
          friendlyMessage: FRIENDLY.UNSUPPORTED_COMBO,
        },
      ],
    };
  }

  // Compute pipeline mapping
  let pipeline: TemplateKind[];
  try {
    pipeline = flowToPipeline(graph).map((n) => n.templateKind);
    if (pipeline.length === 0) {
      return {
        ok: false,
        errors: [
          {
            path: "nodes",
            message: "Flow could not be mapped to a contract pipeline",
            friendlyMessage:
              "This flow shape isn't supported by the current contract architecture. Try a simpler trigger → action chain.",
          },
        ],
      };
    }
  } catch {
    return {
      ok: false,
      errors: [
        {
          path: "nodes",
          message: "Flow could not be mapped to a contract pipeline",
          friendlyMessage:
            "This flow shape isn't supported by the current contract architecture. Try a simpler trigger → action chain.",
        },
      ],
    };
  }

  return { ok: true, templateKind, pipeline, graph, pendingLabels: [...pendingLabels] };
}
