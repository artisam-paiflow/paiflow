import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { formatStroops } from "@/lib/utils";

const PENDING_PREFIX = "PENDING:";

export function isPendingAddress(addr: string): boolean {
  return addr.startsWith(PENDING_PREFIX);
}

export function getPendingLabels(graph: FlowGraph): string[] {
  const labels = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type === "split") {
      for (const r of n.config.recipients) {
        if (isPendingAddress(r.address)) {
          labels.add(r.label ?? "unnamed");
        }
      }
    }
    if (n.type === "pay" && isPendingAddress(n.config.recipient)) {
      labels.add(n.config.recipient.slice(PENDING_PREFIX.length) || "unnamed");
    }
  }
  return [...labels];
}

function validAddress(s: string): boolean {
  return StrKey.isValidEd25519PublicKey(s) || isPendingAddress(s);
}

export const AssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({
    kind: z.literal("known"),
    symbol: z.enum(["USDC"]),
  }),
  z.object({
    kind: z.literal("custom"),
    code: z.string().min(1).max(12),
    issuer: z.string().refine((s) => validAddress(s), "Invalid issuer"),
  }),
]);
export type Asset = z.infer<typeof AssetSchema>;

const stellarAccount = z.string().refine((s) => validAddress(s), "Invalid Stellar address");

export const OnReceiveTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("on_receive"),
  config: z.object({
    asset: AssetSchema,
    minAmountStroops: z
      .string()
      .regex(/^\d+$/, "Amount must be a positive integer string")
      .optional(),
  }),
});

export const OnScheduleTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("on_schedule"),
  config: z.object({
    interval: z.enum(["minute", "hour", "day"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    occurrences: z.number().int().positive().optional(),
  }),
});

export const PayAction = z.object({
  id: z.string().min(1),
  type: z.literal("pay"),
  config: z.object({
    recipient: stellarAccount,
    amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
    asset: AssetSchema,
  }),
});

export const SplitRecipient = z.object({
  address: stellarAccount,
  bps: z.number().int().min(1).max(10_000),
  label: z.string().max(64).optional(),
});

export const SplitAction = z.object({
  id: z.string().min(1),
  type: z.literal("split"),
  config: z.object({
    asset: AssetSchema,
    recipients: z.array(SplitRecipient).min(1).max(20),
    ratePerSecondStroops: z
      .string()
      .regex(/^\d+$/, "Rate must be a positive integer string")
      .optional(),
  }),
});

export const ConditionLogic = z.object({
  id: z.string().min(1),
  type: z.literal("condition"),
  config: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("amount_gt"), amountStroops: z.string().regex(/^\d+$/) }),
    z.object({ kind: z.literal("amount_lt"), amountStroops: z.string().regex(/^\d+$/) }),
    z.object({
      kind: z.literal("oracle_gte"),
      oracle: stellarAccount,
      key: z.string().min(1).max(32),
      threshold: z.string().regex(/^\d+$/),
    }),
    z.object({ kind: z.literal("time_after"), at: z.string().datetime() }),
    z.object({ kind: z.literal("time_before"), at: z.string().datetime() }),
  ]),
});

export const FlowNodeSchema = z.discriminatedUnion("type", [
  OnReceiveTrigger,
  OnScheduleTrigger,
  PayAction,
  SplitAction,
  ConditionLogic,
]);
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowGraphSchema = z.object({
  nodes: z.array(FlowNodeSchema).max(40),
  edges: z.array(FlowEdgeSchema).max(80),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

export const FlowSaveSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  graph: FlowGraphSchema,
});
export type FlowSaveInput = z.infer<typeof FlowSaveSchema>;

export const FlowPatchSchema = FlowSaveSchema.partial();
export type FlowPatchInput = z.infer<typeof FlowPatchSchema>;

export type TriggerNode = z.infer<typeof OnReceiveTrigger> | z.infer<typeof OnScheduleTrigger>;
export type ActionNode = z.infer<typeof PayAction> | z.infer<typeof SplitAction>;
export type LogicNode = z.infer<typeof ConditionLogic>;

export function isTrigger(n: FlowNode): n is TriggerNode {
  return n.type === "on_receive" || n.type === "on_schedule";
}
export function isAction(n: FlowNode): n is ActionNode {
  return n.type === "pay" || n.type === "split";
}
export function isLogic(n: FlowNode): n is LogicNode {
  return n.type === "condition";
}

export function assetLabel(asset: Asset): string {
  if (asset.kind === "native") return "XLM";
  if (asset.kind === "known") return asset.symbol;
  return asset.code;
}

export function stroopsToDisplay(stroops: string, asset: Asset): string {
  return `${formatStroops(stroops)} ${assetLabel(asset)}`;
}

export function tokenAmountToStroops(amount: string): string {
  const cleaned = amount.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(7, "0").slice(0, 7);
  const combined = (whole + frac).replace(/^0+/, "") || "0";
  return combined;
}

export const TOTAL_BPS = 10_000;

export function bpsToPct(bps: number): number {
  return bps / 100;
}

export function pctToBps(pct: number): number {
  return Math.round(pct * 100);
}

export function sourceAmountStroops(graph: FlowGraph): string | undefined {
  const trigger = graph.nodes.find(isTrigger);
  if (trigger?.type === "on_receive" && trigger.config.minAmountStroops) {
    return trigger.config.minAmountStroops;
  }
  const condition = graph.nodes.find(isLogic);
  if (condition?.type === "condition") {
    const c = condition.config;
    if (c.kind === "amount_gt" || c.kind === "amount_lt") {
      return c.amountStroops;
    }
  }
  return undefined;
}
