import { TemplateKind } from "@prisma/client";
import { StrKey } from "@stellar/stellar-sdk";
import {
  FlowGraphSchema,
  type FlowGraph,
  type FlowNode,
  type Asset,
  isAction,
  isContractAction,
  isLogic,
  isTrigger,
  isPendingAddress,
  migrateFlowGraph,
  splitTotalFixedStroops,
  assetLabel,
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
  ACTION_UNREACHABLE: (label: string) =>
    `${label} isn't connected to anything. Connect it to the trigger or another step.`,
  UNSUPPORTED_COMBO:
    "This trigger/action combination isn't supported. You can use: receive→pay, receive→split, schedule→pay, schedule→split, or add a condition to any of these.",
  MISSING_EDGE_SOURCE: (eid: string, src: string) =>
    `The connection "${eid}" references a node "${src}" that doesn't exist.`,
  MISSING_EDGE_TARGET: (eid: string, tgt: string) =>
    `The connection "${eid}" references a node "${tgt}" that doesn't exist.`,
  MIXED_SPLIT_MODE:
    "All recipients in a split must be either percentages or fixed amounts, not a mix.",
  FIXED_AMOUNT_REQUIRED: "Each fixed-amount recipient needs a positive amount.",
  TOTAL_FIXED_AMOUNT_REQUIRED: "Add at least one positive fixed amount to the split.",
  ASSET_CONFLICT:
    "This step can receive different assets depending on which path funds arrive through. Make sure every path leading into it carries the same asset, or add a swap so they match before merging.",
} as const;

// A short, self-describing name for a node, mirroring what the canvas shows so
// the user can locate the offending step instead of decoding a raw id like
// "swap-8j756t".
function nodeDescriptor(n: FlowNode): string {
  switch (n.type) {
    case "on_receive":
      return "Receive trigger";
    case "on_schedule":
      return "Schedule trigger";
    case "webhook":
      return "Webhook trigger";
    case "web2_webhook":
      return "HTTP Webhook trigger";
    case "subscription":
      return "Subscription trigger";
    case "payroll":
      return "Payroll";
    case "oracle":
      return "Oracle trigger";
    case "pay":
      return `Pay (${assetLabel(n.config.asset)})`;
    case "split":
      return `Split (${n.config.recipients.length} recipient${
        n.config.recipients.length === 1 ? "" : "s"
      })`;
    case "swap":
      return `Swap (${assetLabel(n.config.assetIn)} → ${assetLabel(n.config.assetOut)})`;
    case "yield":
      return `Yield (${assetLabel(n.config.asset)})`;
    case "cash_out":
      return "Cash Out";
    case "email_notify":
      return "Email notify";
    case "condition":
      return "Condition";
    default:
      return (n as FlowNode).type;
  }
}

// Build human-friendly labels for every node. When two nodes share the same
// descriptor (e.g. two "Swap (XLM → USDC)" steps), they're numbered so the user
// can still tell them apart.
function buildNodeLabels(graph: FlowGraph): Map<string, string> {
  const totals = new Map<string, number>();
  for (const n of graph.nodes) {
    const d = nodeDescriptor(n);
    totals.set(d, (totals.get(d) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const n of graph.nodes) {
    const d = nodeDescriptor(n);
    if ((totals.get(d) ?? 0) > 1) {
      const idx = (seen.get(d) ?? 0) + 1;
      seen.set(d, idx);
      labels.set(n.id, `${d} #${idx}`);
    } else {
      labels.set(n.id, d);
    }
  }
  return labels;
}

export function assetsEqual(a: Asset, b: Asset): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "known" && b.kind === "known") return a.symbol === b.symbol;
  if (a.kind === "custom" && b.kind === "custom") return a.code === b.code && a.issuer === b.issuer;
  return true; // both native
}

function getTriggerAsset(t: FlowNode): Asset | null {
  if (
    t.type === "on_receive" ||
    t.type === "webhook" ||
    t.type === "web2_webhook" ||
    t.type === "subscription" ||
    t.type === "payroll" ||
    t.type === "oracle"
  ) {
    return t.config.asset;
  }
  return null;
}

function uniqueAssets(assets: Asset[]): Asset[] {
  const out: Asset[] = [];
  for (const a of assets) {
    if (!out.some((o) => assetsEqual(o, a))) out.push(a);
  }
  return out;
}

/**
 * For every node in the graph, the asset expected to flow into it: the
 * trigger's asset, transformed to a swap's assetOut for anything downstream
 * of that swap. Null means unconstrained (no trigger asset, or unreachable).
 *
 * A node is only resolved once every one of its incoming edges has been
 * resolved (Kahn's algorithm), so a merge point that receives conflicting
 * assets via different paths is detected rather than silently settled by
 * whichever path the queue happened to visit first.
 */
function computeAssetFlowInternal(graph: FlowGraph): {
  resolved: Map<string, Asset | null>;
  conflicts: Set<string>;
} {
  const nodesById = new Map<string, FlowNode>(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
    indegree.set(n.id, 0);
  }
  for (const e of graph.edges) {
    adj.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  }

  const resolved = new Map<string, Asset | null>();
  const conflicts = new Set<string>();
  const trigger = graph.nodes.find(isTrigger);
  if (!trigger) return { resolved, conflicts };

  const incoming = new Map<string, (Asset | null)[]>();
  const remaining = new Map(indegree);
  const visited = new Set<string>([trigger.id]);
  resolved.set(trigger.id, getTriggerAsset(trigger));
  const queue = [trigger.id];

  while (queue.length) {
    const nodeId = queue.shift()!;
    const node = nodesById.get(nodeId)!;
    const nodeIncoming = resolved.get(nodeId) ?? null;
    const outgoing = node.type === "swap" ? node.config.assetOut : nodeIncoming;

    for (const nextId of adj.get(nodeId) ?? []) {
      const list = incoming.get(nextId) ?? [];
      list.push(outgoing);
      incoming.set(nextId, list);
      remaining.set(nextId, (remaining.get(nextId) ?? 0) - 1);

      if ((remaining.get(nextId) ?? 0) <= 0 && !visited.has(nextId)) {
        visited.add(nextId);
        const distinct = uniqueAssets(
          (incoming.get(nextId) ?? []).filter((a): a is Asset => a !== null),
        );
        if (distinct.length > 1) {
          conflicts.add(nextId);
          resolved.set(nextId, null);
        } else {
          resolved.set(nextId, distinct[0] ?? null);
        }
        queue.push(nextId);
      }
    }
  }

  for (const n of graph.nodes) {
    if (!resolved.has(n.id)) resolved.set(n.id, null);
  }
  return { resolved, conflicts };
}

export function computeAssetFlow(graph: FlowGraph): Map<string, Asset | null> {
  return computeAssetFlowInternal(graph).resolved;
}

export function validateFlow(rawGraph: unknown): ValidationResult {
  const parsed = FlowGraphSchema.safeParse(migrateFlowGraph(rawGraph));
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
  const nodeLabels = buildNodeLabels(graph);

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
  const contractActions = actions.filter(isContractAction);
  if (contractActions.length < 1) {
    errors.push({
      path: "nodes",
      message: "Flow must have at least one action node",
      friendlyMessage: FRIENDLY.AT_LEAST_ONE_ACTION,
    });
  }

  for (const a of actions) {
    if (a.type === "split") {
      // Dev mode allows leaving recipients empty to fill via API after deploy.
      if (graph.devMode === true && a.config.recipients.length === 0) {
        continue;
      }

      if (a.config.recipients.length === 0) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: "Split node must have at least one recipient",
          friendlyMessage: "Add at least one recipient to the split node.",
        });
        continue;
      }

      const modes = new Set(a.config.recipients.map((r) => r.mode));
      if (modes.size > 1) {
        errors.push({
          path: `nodes.${a.id}.config.recipients`,
          message: "Split recipients must all use the same mode (percentage or fixed)",
          friendlyMessage: FRIENDLY.MIXED_SPLIT_MODE,
        });
      }

      const mode = a.config.recipients[0]?.mode ?? "percentage";

      if (mode === "percentage") {
        const sum = a.config.recipients.reduce(
          (s, r) => (r.mode === "percentage" ? s + r.bps : s),
          0,
        );
        if (sum !== 10_000) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: `Recipient basis points must sum to 10000 (got ${sum})`,
            friendlyMessage: FRIENDLY.BPS_SUM(sum),
          });
        }
      } else {
        for (const r of a.config.recipients) {
          if (r.mode === "fixed" && (!r.amountStroops || r.amountStroops === "0")) {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: "Fixed recipient amount must be positive",
              friendlyMessage: FRIENDLY.FIXED_AMOUNT_REQUIRED,
            });
          }
        }
        const total = splitTotalFixedStroops(a.config.recipients);
        if (!total || total === "0") {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: "Total fixed amount must be greater than 0",
            friendlyMessage: FRIENDLY.TOTAL_FIXED_AMOUNT_REQUIRED,
          });
        }
      }

      const seen = new Set<string>();
      for (const r of a.config.recipients) {
        const isWallet = StrKey.isValidEd25519PublicKey(r.address);
        const isFiat = r.payoutMode === "fiat";
        const triggerType = triggers[0]?.type;

        // Non-payroll flows: only contract addresses may be fiat (they point to
        // an explicit cash-out node downstream). Wallet addresses must be crypto.
        if (triggerType !== "payroll" && isWallet && isFiat) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: "Wallet addresses cannot use fiat payout outside payroll flows",
            friendlyMessage:
              "Only contract addresses (C...) can be fiat recipients in this flow. Use a cash-out node for off-ramp, or switch the address to crypto.",
          });
        }

        // Payroll flows: immutable (non-dev) fiat recipients must carry bank
        // details at design time. Dev mode may leave them blank and configure
        // later via the API.
        if (triggerType === "payroll" && isFiat && graph.devMode !== true) {
          const missing = [];
          if (!r.accountName?.trim()) missing.push("account name");
          if (!r.accountNumber?.trim()) missing.push("account number");
          if (!r.bankCode?.trim()) missing.push("bank code");
          if (missing.length) {
            errors.push({
              path: `nodes.${a.id}.config.recipients`,
              message: `Fiat payroll recipient is missing ${missing.join(", ")}`,
              friendlyMessage: `Enter the ${missing.join(", ")} for this fiat employee.`,
            });
          }
        }

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
      if (a.config.fillValueViaApi && graph.devMode !== true) {
        errors.push({
          path: `nodes.${a.id}.config.fillValueViaApi`,
          message: "Fill value via API is only allowed in dev mode",
          friendlyMessage: "Turn on dev mode to fill the payment value via API after deploy.",
        });
      }
      const valueDeferred = graph.devMode === true && a.config.fillValueViaApi;
      if (!valueDeferred && !a.config.fullAmount) {
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

  // Email notify nodes are decorator leaves — they cannot have children.
  for (const n of graph.nodes) {
    if (n.type === "email_notify") {
      const hasOutgoing = graph.edges.some((e) => e.source === n.id);
      if (hasOutgoing) {
        errors.push({
          path: `nodes.${n.id}`,
          message: "Email notify node cannot have outgoing edges",
          friendlyMessage:
            "Email notify nodes can't be connected to other steps. Remove any connections coming out of it.",
        });
      }

      const parentEdge = graph.edges.find((e) => e.target === n.id);
      const parent = parentEdge ? nodesById.get(parentEdge.source) : undefined;

      if (parent?.type === "split") {
        const parentAddresses = parent.config.recipients.map((r) => r.address);
        const emailAddresses = n.config.recipients.map((r) => r.address);
        // When the split is in dev mode and its recipients are left empty to be
        // filled via API, we can't validate a 1:1 address mapping yet.
        const splitFilledViaApi = graph.devMode === true && parentAddresses.length === 0;
        if (!splitFilledViaApi && emailAddresses.length !== parentAddresses.length) {
          errors.push({
            path: `nodes.${n.id}.config.recipients`,
            message: "Email notify node must have exactly one email per split recipient",
            friendlyMessage:
              "Add exactly one email for each address in the split. Remove or fill any blank rows.",
          });
        }
        if (!splitFilledViaApi) {
          for (const addr of parentAddresses) {
            if (!emailAddresses.includes(addr)) {
              errors.push({
                path: `nodes.${n.id}.config.recipients`,
                message: `Missing email for split recipient ${addr}`,
                friendlyMessage: `Add an email for split recipient ${addr}.`,
              });
            }
          }
        }
      } else if (n.config.recipients.length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.recipients`,
          message: "Email notify node requires at least one recipient",
          friendlyMessage: "Add at least one recipient email to the email notify node.",
        });
      }

      if (!n.config.subject.trim()) {
        errors.push({
          path: `nodes.${n.id}.config.subject`,
          message: "Email notify node requires a subject",
          friendlyMessage: "Add a subject line to the email notify node.",
        });
      }
    }
  }

  // Cash-out nodes are terminal sinks: funds leave the chain, so they cannot
  // feed another node and must receive funds from an upstream node. Bank details
  // may be left blank in dev mode (filled via API after deploy), but must be set
  // at design time in non-dev mode.
  for (const n of graph.nodes) {
    if (n.type !== "cash_out") continue;

    const hasOutgoing = graph.edges.some((e) => e.source === n.id);
    if (hasOutgoing) {
      errors.push({
        path: `nodes.${n.id}`,
        message: "Cash-out node cannot have outgoing edges",
        friendlyMessage:
          "Cash-out is a final step — its output leaves the chain. Remove any connections coming out of it.",
      });
    }

    const hasIncoming = graph.edges.some((e) => e.target === n.id);
    if (!hasIncoming) {
      errors.push({
        path: `nodes.${n.id}`,
        message: "Cash-out node must receive funds from an upstream node",
        friendlyMessage:
          "Connect a pay or split step into the cash-out node so it has funds to send to the bank.",
      });
    }

    if (graph.devMode !== true) {
      if (!n.config.accountName || n.config.accountName.trim().length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.accountName`,
          message: "Cash-out account name is required in non-dev mode",
          friendlyMessage: "Enter the beneficiary account name for the cash-out node.",
        });
      }
      if (!n.config.accountNumber || n.config.accountNumber.trim().length === 0) {
        errors.push({
          path: `nodes.${n.id}.config.accountNumber`,
          message: "Cash-out account number is required in non-dev mode",
          friendlyMessage: "Enter the beneficiary account number for the cash-out node.",
        });
      }
      if (!n.config.bankCode) {
        errors.push({
          path: `nodes.${n.id}.config.bankCode`,
          message: "Cash-out bank is required in non-dev mode",
          friendlyMessage: "Select a bank for the cash-out node.",
        });
      }
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

  // A subscription that pulls 0 is meaningless. In dev mode the amount may be
  // left blank to be filled via the API after deploy, so only enforce this
  // for real deployments.
  if (trigger?.type === "subscription" && graph.devMode !== true) {
    const amount = trigger.config.amountPerPeriodStroops;
    if (!amount || BigInt(amount) <= 0n) {
      errors.push({
        path: `nodes.${trigger.id}.config.amountPerPeriodStroops`,
        message: "Subscription amount per period must be greater than 0",
        friendlyMessage:
          "Set an amount per period greater than 0 — a subscription that pulls nothing will never charge.",
      });
    }
  }

  // Payroll flows must use fixed amounts so the contract can compute the
  // exact pull amount per period.
  if (trigger?.type === "payroll") {
    for (const a of contractActions) {
      if (a.type === "split") {
        const modes = new Set(a.config.recipients.map((r) => r.mode));
        if (modes.has("percentage")) {
          errors.push({
            path: `nodes.${a.id}.config.recipients`,
            message: "Payroll split must use fixed amounts, not percentages",
            friendlyMessage:
              "Payroll distributions must be fixed salary amounts. Switch all recipients to fixed amounts.",
          });
        }
      }
      if (a.type === "pay" && a.config.mode === "percentage") {
        errors.push({
          path: `nodes.${a.id}.config.mode`,
          message: "Payroll pay node must use fixed amount, not percentage",
          friendlyMessage:
            "Payroll distributions must be fixed salary amounts. Switch the pay node to a fixed amount.",
        });
      }
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
          friendlyMessage: FRIENDLY.ACTION_UNREACHABLE(nodeLabels.get(a.id) ?? a.id),
        });
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  // Asset type enforcement: every contract action must declare the asset that
  // actually flows into it (the trigger's asset, transformed to a swap's
  // assetOut for anything downstream of that swap).
  if (trigger) {
    const { resolved: expectedAssetByNode, conflicts } = computeAssetFlowInternal(graph);

    for (const nodeId of conflicts) {
      errors.push({
        path: `nodes.${nodeId}`,
        message: "Asset conflict: multiple incoming paths provide different assets",
        friendlyMessage: FRIENDLY.ASSET_CONFLICT,
      });
    }

    for (const a of contractActions) {
      const expected = expectedAssetByNode.get(a.id);
      if (!expected) continue; // unconstrained: no trigger asset, unreachable, or conflicting (reported above)

      let actual: Asset | null = null;
      if (a.type === "pay") actual = a.config.asset;
      else if (a.type === "split") actual = a.config.asset;
      else if (a.type === "yield") actual = a.config.asset;
      else if (a.type === "swap") actual = a.config.assetIn;

      if (actual && !assetsEqual(expected, actual)) {
        errors.push({
          path: `nodes.${a.id}.config.${a.type === "swap" ? "assetIn" : "asset"}`,
          message: `Asset mismatch: action uses ${assetLabel(actual)} but ${assetLabel(expected)} flows in`,
          friendlyMessage:
            a.type === "swap"
              ? `Asset mismatch: this swap's "Asset In" is set to ${assetLabel(actual)}, but ${assetLabel(expected)} actually flows into it. Change "Asset In" to ${assetLabel(expected)}.`
              : `Asset mismatch: ${assetLabel(expected)} flows into this step, but this action uses ${assetLabel(actual)}. Change the action asset to ${assetLabel(expected)}, or add a swap node to convert assets first.`,
        });
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  // Infer template kind from contract actions only.
  const action = contractActions[0]!;
  const condition = graph.nodes.find(isLogic);
  const hasCondition = condition != null;
  const isScheduleLike = trigger!.type === "on_schedule" || trigger!.type === "subscription";
  const isOnReceive = trigger!.type === "on_receive";
  const isWebhookLike =
    trigger!.type === "webhook" || trigger!.type === "web2_webhook" || trigger!.type === "oracle";
  const isReceiveLike = isOnReceive || isWebhookLike;
  const isPayOrSplit = action.type === "pay" || action.type === "split";
  const isSwapOrYield = action.type === "swap" || action.type === "yield";
  const isCashOut = action.type === "cash_out";

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
  } else if (trigger!.type === "subscription" && isPayOrSplit) {
    templateKind = TemplateKind.SUBSCRIPTION;
  } else if (trigger!.type === "payroll" && isPayOrSplit) {
    templateKind = TemplateKind.PAYROLL;
  } else if (trigger!.type === "on_schedule" && isPayOrSplit) {
    templateKind = TemplateKind.STREAMER;
  } else if (isOnReceive && isPayOrSplit) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isOnReceive && isCashOut) {
    templateKind = TemplateKind.CASH_OUT;
  } else if (isOnReceive && isSwapOrYield) {
    templateKind = TemplateKind.SPLITTER;
  } else if (isWebhookLike && isPayOrSplit) {
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
            "Unsupported trigger/action combination. Supported: on_receive with pay/split/swap/yield/cash_out, webhook/web2_webhook/oracle with pay/split/swap/yield/multisig, schedule-like triggers (on_schedule, subscription) with pay/split, payroll with pay/split, or any with a compatible condition.",
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
