import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

export const AssetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native") }),
  z.object({
    kind: z.literal("known"),
    symbol: z.enum(["USDC"]),
  }),
  z.object({
    kind: z.literal("custom"),
    code: z.string().min(1).max(12),
    issuer: z.string().refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid issuer"),
  }),
]);
export type Asset = z.infer<typeof AssetSchema>;

const stellarAccount = z
  .string()
  .refine((s) => StrKey.isValidEd25519PublicKey(s), "Invalid Stellar address");

export const OnReceiveTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("on_receive"),
  config: z.object({ asset: AssetSchema }),
});

export const OnScheduleTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("on_schedule"),
  config: z.object({
    interval: z.enum(["minute", "hour", "day"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
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
    recipients: z.array(SplitRecipient).min(2).max(20),
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
  nodes: z.array(FlowNodeSchema).min(2).max(40),
  edges: z.array(FlowEdgeSchema).max(80),
});
export type FlowGraph = z.infer<typeof FlowGraphSchema>;

/** Lenient graph schema for PATCH — allows incomplete work-in-progress flows. */
export const FlowGraphPatchSchema = z.object({
  nodes: z.array(FlowNodeSchema).max(40),
  edges: z.array(FlowEdgeSchema).max(80),
});

export const FlowSaveSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(280).optional(),
  graph: FlowGraphSchema,
});
export type FlowSaveInput = z.infer<typeof FlowSaveSchema>;

export const FlowPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(280).optional(),
  graph: FlowGraphPatchSchema,
});
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
