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
    if (n.type === "webhook" && isPendingAddress(n.config.relayer)) {
      labels.add(n.config.relayer.slice(PENDING_PREFIX.length) || "unnamed");
    }
    if (n.type === "subscription" && isPendingAddress(n.config.subscriber)) {
      labels.add(n.config.subscriber.slice(PENDING_PREFIX.length) || "unnamed");
    }
    if (n.type === "payroll" && isPendingAddress(n.config.employer)) {
      labels.add(n.config.employer.slice(PENDING_PREFIX.length) || "unnamed");
    }
    if (n.type === "yield" && isPendingAddress(n.config.vault)) {
      labels.add(n.config.vault.slice(PENDING_PREFIX.length) || "unnamed");
    }
    if (n.type === "condition" && n.config.kind === "multisig") {
      for (const s of n.config.signers) {
        if (isPendingAddress(s)) {
          labels.add(s.slice(PENDING_PREFIX.length) || "unnamed");
        }
      }
    }
  }
  return [...labels];
}

function validAddress(s: string): boolean {
  return StrKey.isValidEd25519PublicKey(s) || isPendingAddress(s);
}

function validSplitRecipientAddress(s: string): boolean {
  return StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s) || isPendingAddress(s);
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
const splitRecipientAddress = z
  .string()
  .refine((s) => validSplitRecipientAddress(s), "Invalid Stellar address");

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
    intervalAmount: z.number().int().positive().default(1),
    intervalUnit: z.enum(["minute", "hour", "day", "week", "month"]),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime().optional(),
    occurrences: z.number().int().positive().optional(),
    timeZone: z.string().optional(),
    pauseAllowed: z.boolean().optional(),
    retrieveAllowed: z.boolean().optional(),
  }),
});

export const WebhookTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("webhook"),
  config: z.object({
    asset: AssetSchema,
    relayer: stellarAccount,
  }),
});

export const Web2WebhookTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("web2_webhook"),
  config: z.object({
    asset: AssetSchema,
  }),
});

export const SubscriptionTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("subscription"),
  config: z.object({
    asset: AssetSchema,
    subscriber: stellarAccount,
    amountPerPeriodStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
    intervalAmount: z.number().int().positive().default(1),
    intervalUnit: z.enum(["minute", "hour", "day", "week", "month"]).default("day"),
    endsAt: z.string().datetime().optional(),
    occurrences: z.number().int().positive().optional(),
  }),
});

export const PayrollTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("payroll"),
  config: z.object({
    asset: AssetSchema,
    employer: stellarAccount,
    intervalAmount: z.number().int().positive().default(1),
    intervalUnit: z.enum(["minute", "hour", "day", "week", "month"]).default("week"),
    endsAt: z.string().datetime().optional(),
    occurrences: z.number().int().positive().optional(),
    fillScheduleViaApi: z.boolean().default(false),
  }),
});

export const OracleTrigger = z.object({
  id: z.string().min(1),
  type: z.literal("oracle"),
  config: z.object({
    asset: AssetSchema,
    threshold: z.string().regex(/^\d+$/, "Threshold must be a positive integer string"),
  }),
});

export const PayAction = z.object({
  id: z.string().min(1),
  type: z.literal("pay"),
  config: z
    .object({
      recipient: stellarAccount,
      asset: AssetSchema,
      mode: z.enum(["fixed", "percentage"]).optional(),
      amountStroops: z
        .string()
        .regex(/^\d+$/, "Amount must be a positive integer string")
        .optional(),
      percentage: z.number().min(0).max(100).optional(),
      fullAmount: z.boolean().default(false),
      fillValueViaApi: z.boolean().optional(),
    })
    .refine(
      (c) => {
        if (c.fullAmount || c.fillValueViaApi) return true;
        if (c.mode === "fixed") return !!c.amountStroops && c.amountStroops !== "0";
        if (c.mode === "percentage") return c.percentage !== undefined && c.percentage > 0;
        return false;
      },
      { message: "Invalid pay configuration for the selected mode" },
    ),
});

const SplitRecipientBase = z.object({
  address: splitRecipientAddress,
  label: z.string().max(64).optional(),
  payoutMode: z.enum(["crypto", "fiat"]).optional(),
});

export const SplitRecipient = z
  .discriminatedUnion("mode", [
    SplitRecipientBase.extend({
      mode: z.literal("percentage"),
      bps: z.number().int().min(1).max(10_000),
    }),
    SplitRecipientBase.extend({
      mode: z.literal("fixed"),
      amountStroops: z.string().regex(/^\d+$/, "Amount must be a positive integer string"),
    }),
  ])
  .refine(
    (r) => {
      if (StrKey.isValidContract(r.address)) {
        return r.payoutMode === "fiat";
      }
      return r.payoutMode !== "fiat";
    },
    {
      message:
        "Contract addresses (C...) must use fiat payout; wallet addresses (G...) must use crypto payout.",
      path: ["address"],
    },
  );
export type SplitRecipient = z.infer<typeof SplitRecipient>;

// Backward compatibility: older flows stored recipients with `bps` but no
// `mode`. Hydrate them to percentage mode before parsing.
function hydrateSplitRecipient(r: unknown): unknown {
  if (r && typeof r === "object" && !("mode" in (r as object)) && "bps" in (r as object)) {
    return { ...(r as object), mode: "percentage" };
  }
  return r;
}

export function migrateFlowGraph(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const graph = raw as { nodes?: unknown[] };
  if (!Array.isArray(graph.nodes)) return raw;
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (!n || typeof n !== "object") return n;
      const node = n as { type?: unknown; config?: { recipients?: unknown[] } };
      if (node.type === "split" && Array.isArray(node.config?.recipients)) {
        return {
          ...node,
          config: {
            ...node.config,
            recipients: node.config.recipients.map(hydrateSplitRecipient),
          },
        };
      }
      if (node.type === "subscription" && node.config && typeof node.config === "object") {
        const cfg = node.config as { intervalAmount?: unknown; intervalUnit?: unknown };
        if (cfg.intervalAmount === undefined || cfg.intervalUnit === undefined) {
          return {
            ...node,
            config: {
              ...node.config,
              intervalAmount: 1,
              intervalUnit: "day",
            },
          };
        }
      }
      if (node.type === "payroll" && node.config && typeof node.config === "object") {
        const cfg = node.config as { fillScheduleViaApi?: unknown };
        if (cfg.fillScheduleViaApi === undefined) {
          return {
            ...node,
            config: {
              ...node.config,
              fillScheduleViaApi: false,
            },
          };
        }
      }
      if (node.type === "pay" && node.config && typeof node.config === "object") {
        const cfg = node.config as { fillValueViaApi?: unknown; mode?: unknown };
        const updates: Record<string, unknown> = {};
        if (cfg.fillValueViaApi === undefined) {
          updates.fillValueViaApi = false;
        }
        if (cfg.mode === undefined) {
          updates.mode = "fixed";
        }
        if (Object.keys(updates).length > 0) {
          return {
            ...node,
            config: {
              ...node.config,
              ...updates,
            },
          };
        }
      }
      return n;
    }),
  };
}

export function splitTotalFixedStroops(recipients: SplitRecipient[]): string | null {
  let total = 0n;
  let hasFixed = false;
  for (const r of recipients) {
    if (r.mode === "fixed") {
      hasFixed = true;
      total += BigInt(r.amountStroops);
    }
  }
  return hasFixed ? total.toString() : null;
}

export const SplitAction = z.object({
  id: z.string().min(1),
  type: z.literal("split"),
  config: z.object({
    asset: AssetSchema,
    // Empty recipients are allowed in dev mode; "fill via API after deploy" uses
    // an empty list as its sentinel. validateFlow enforces at least one recipient
    // for non-dev flows.
    recipients: z.array(SplitRecipient).min(0).max(20),
    amountPerIntervalStroops: z
      .string()
      .regex(/^\d+$/, "Amount must be a positive integer string")
      .optional(),
    // Deprecated: old flows used continuous rate-per-second streaming.
    ratePerSecondStroops: z
      .string()
      .regex(/^\d+$/, "Rate must be a positive integer string")
      .optional(),
  }),
});

export const SwapAction = z.object({
  id: z.string().min(1),
  type: z.literal("swap"),
  config: z.object({
    assetIn: AssetSchema,
    assetOut: AssetSchema,
    rateBps: z.number().int().min(1).max(10_000),
  }),
});

export const YieldAction = z.object({
  id: z.string().min(1),
  type: z.literal("yield"),
  config: z.object({
    asset: AssetSchema,
    vault: stellarAccount,
  }),
});

export const EmailRecipient = z.object({
  address: z.string().min(1),
  email: z.string().email(),
});
export type EmailRecipient = z.infer<typeof EmailRecipient>;

export const EmailNotifyAction = z.object({
  id: z.string().min(1),
  type: z.literal("email_notify"),
  config: z.object({
    recipients: z.array(EmailRecipient).min(1),
    subject: z.string().min(1),
    body: z.string().default(""),
  }),
});

export const CashOutAction = z.object({
  id: z.string().min(1),
  type: z.literal("cash_out"),
  config: z.object({
    asset: AssetSchema,
    accountName: z.string().default(""),
    accountNumber: z.string().default(""),
    bankCode: z.string().default(""),
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
    z.object({
      kind: z.literal("time_after"),
      at: z.string().datetime(),
      timeZone: z.string().optional(),
    }),
    z.object({
      kind: z.literal("time_before"),
      at: z.string().datetime(),
      timeZone: z.string().optional(),
    }),
    z.object({
      kind: z.literal("multisig"),
      signers: z.array(stellarAccount).min(1).max(20),
      threshold: z.number().int().min(1),
    }),
  ]),
});

export const FlowNodeSchema = z.discriminatedUnion("type", [
  OnReceiveTrigger,
  OnScheduleTrigger,
  WebhookTrigger,
  Web2WebhookTrigger,
  SubscriptionTrigger,
  PayrollTrigger,
  OracleTrigger,
  PayAction,
  SplitAction,
  SwapAction,
  YieldAction,
  EmailNotifyAction,
  CashOutAction,
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
  // Dev mode turns this flow into a parameterized one: nodes with a dev
  // counterpart (pay, split, subscription) deploy as their mutable `_DEV`
  // variant whose recipients / amounts / schedule can be left blank at design
  // time and filled or changed later via the API.
  devMode: z.boolean().optional(),
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

export type TriggerNode =
  | z.infer<typeof OnReceiveTrigger>
  | z.infer<typeof OnScheduleTrigger>
  | z.infer<typeof WebhookTrigger>
  | z.infer<typeof Web2WebhookTrigger>
  | z.infer<typeof SubscriptionTrigger>
  | z.infer<typeof PayrollTrigger>
  | z.infer<typeof OracleTrigger>;
export type ActionNode =
  | z.infer<typeof PayAction>
  | z.infer<typeof SplitAction>
  | z.infer<typeof SwapAction>
  | z.infer<typeof YieldAction>
  | z.infer<typeof EmailNotifyAction>
  | z.infer<typeof CashOutAction>;
export type LogicNode = z.infer<typeof ConditionLogic>;

export type ContractActionNode = Exclude<ActionNode, { type: "email_notify" }>;

export function isTrigger(n: FlowNode): n is TriggerNode {
  return (
    n.type === "on_receive" ||
    n.type === "on_schedule" ||
    n.type === "webhook" ||
    n.type === "web2_webhook" ||
    n.type === "subscription" ||
    n.type === "payroll" ||
    n.type === "oracle"
  );
}
export function isAction(n: FlowNode): n is ActionNode {
  return (
    n.type === "pay" ||
    n.type === "split" ||
    n.type === "swap" ||
    n.type === "yield" ||
    n.type === "email_notify" ||
    n.type === "cash_out"
  );
}
export function isContractAction(n: FlowNode): n is ContractActionNode {
  return (
    n.type === "pay" ||
    n.type === "split" ||
    n.type === "swap" ||
    n.type === "yield" ||
    n.type === "cash_out"
  );
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
  if (trigger?.type === "oracle" && trigger.config.threshold) {
    return trigger.config.threshold;
  }
  if (trigger?.type === "subscription" && trigger.config.amountPerPeriodStroops) {
    return trigger.config.amountPerPeriodStroops;
  }
  if (trigger?.type === "payroll") {
    const action = graph.nodes.find(
      (n): n is Extract<FlowNode, { type: "split" }> => n.type === "split",
    );
    if (action) {
      const total = action.config.recipients
        .filter((r) => r.mode === "fixed")
        .reduce((sum, r) => sum + BigInt(r.amountStroops), 0n);
      if (total > 0n) return total.toString();
    }
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
