"use client";
import { useId } from "react";
import type { FlowNode } from "@/lib/flows/schema";
import { isTrigger } from "@/lib/flows/schema";
import { isTimeCondition } from "@/lib/flows/branches";
import type { FeatureFlags, FeatureSurface } from "@/lib/feature-flags";
type Props = {
  onAdd: (node: FlowNode) => void;
  flowNodes: FlowNode[];
  collapsed?: boolean;
  pinned?: boolean;
  onExpand?: () => void;
  onTogglePin?: () => void;
  /** Surface switches from the server (#722); an entry whose surface is off is not offered. */
  features: FeatureFlags;
};
function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
type Template = {
  label: string;
  icon: string;
  group: "Triggers" | "Actions" | "Logic";
  // Hidden templates stay in source (typechecked, easy to re-enable) but are
  // filtered out of the palette. Use this instead of commenting entries out.
  hidden?: boolean;
  /** The switchable surface this block belongs to; off on the server hides it. */
  feature?: FeatureSurface;
  requiresCondition?: "time" | "non-oracle";
  make: () => FlowNode;
};
export const TEMPLATES: Template[] = [
  {
    group: "Triggers",
    label: "On Receive",
    icon: "toll",
    make: () => ({
      id: makeId("recv"),
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    }),
  },
  {
    group: "Triggers",
    label: "On Schedule",
    icon: "schedule",
    make: () => ({
      id: makeId("sched"),
      type: "on_schedule",
      config: {
        intervalAmount: 1,
        intervalUnit: "hour",
        startsAt: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    }),
  },
  // Hidden: non-HTTP Webhook trigger (relayer-authorized). Use "HTTP Webhook" instead.
  {
    group: "Triggers",
    label: "Webhook",
    icon: "webhook",
    hidden: true,
    make: () => ({
      id: makeId("webhook"),
      type: "webhook",
      config: { asset: { kind: "known", symbol: "USDC" }, relayer: "PENDING:relayer" },
    }),
  },
  {
    group: "Triggers",
    label: "HTTP Webhook",
    icon: "http",
    make: () => ({
      id: makeId("web2"),
      type: "web2_webhook",
      config: { asset: { kind: "known", symbol: "USDC" } },
    }),
  },
  {
    group: "Triggers",
    label: "Subscription",
    icon: "repeat",
    make: () => ({
      id: makeId("sub"),
      type: "subscription",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        subscriber: "PENDING:subscriber",
        amountPerPeriodStroops: "10000000",
        intervalAmount: 1,
        intervalUnit: "day",
      },
    }),
  },
  {
    group: "Triggers",
    label: "Payroll",
    icon: "group",
    feature: "payroll",
    make: () => ({
      id: makeId("payroll"),
      type: "payroll",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        employer: "PENDING:employer",
        intervalAmount: 1,
        intervalUnit: "week",
      },
    }),
  },
  // Hidden: Oracle trigger.
  {
    group: "Triggers",
    label: "Oracle",
    icon: "online_prediction",
    hidden: true,
    make: () => ({
      id: makeId("oracle"),
      type: "oracle",
      config: { asset: { kind: "known", symbol: "USDC" }, threshold: "100" },
    }),
  },
  {
    group: "Actions",
    label: "Pay",
    icon: "payments",
    make: () => ({
      id: makeId("pay"),
      type: "pay",
      config: {
        recipient: "PENDING:unnamed",
        amountStroops: "10000000",
        asset: { kind: "known", symbol: "USDC" },
        mode: "fixed",
        fullAmount: false,
      },
    }),
  },
  {
    group: "Actions",
    label: "Split",
    icon: "call_split",
    make: () => ({
      id: makeId("split"),
      type: "split",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        recipients: [
          {
            address: "PENDING:unnamed",
            mode: "percentage",
            bps: 5000,
            label: "A",
          },
          {
            address: "PENDING:unnamed",
            mode: "percentage",
            bps: 5000,
            label: "B",
          },
        ],
      },
    }),
  },
  {
    group: "Actions",
    label: "Swap",
    icon: "swap_horiz",
    make: () => ({
      id: makeId("swap"),
      type: "swap",
      config: {
        assetIn: { kind: "native" },
        assetOut: { kind: "known", symbol: "USDC" },
        slippageBps: 100,
        deadlineSecs: 300,
      },
    }),
  },
  {
    group: "Actions",
    label: "Hold",
    icon: "lock",
    requiresCondition: "time",
    make: () => ({ id: makeId("hold"), type: "hold", config: {} }),
  },
  {
    group: "Actions",
    label: "Return to owner",
    icon: "undo",
    requiresCondition: "non-oracle",
    make: () => ({ id: makeId("return"), type: "return_to_owner", config: {} }),
  },
  // Hidden: Yield action.
  {
    group: "Actions",
    label: "Yield",
    icon: "savings",
    hidden: true,
    make: () => ({
      id: makeId("yield"),
      type: "yield",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        vault: "PENDING:vault",
      },
    }),
  },
  {
    group: "Logic",
    label: "Condition",
    icon: "rule",
    // Stays an amount condition: it now drops with True and False outputs, so
    // the validator's "connect the False output" is the next step to take,
    // not a dead end. A time condition would need a date picked first and a
    // relayer to release it.
    make: () => ({
      id: makeId("cond"),
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    }),
  },
  // Hidden: Cash Out action (deferred — pay/split handle fiat payout natively).
  {
    group: "Actions",
    label: "Cash Out",
    icon: "payments",
    hidden: true,
    feature: "offramp",
    make: () => ({
      id: makeId("cashout"),
      type: "cash_out",
      config: {
        asset: { kind: "known", symbol: "USDC" },
        accountName: "",
        accountNumber: "",
        bankCode: "",
      },
    }),
  },
];
/** The palette entries offered under these switches: not `hidden`, and their surface on. */
export function visibleTemplates(features: FeatureFlags): Template[] {
  return TEMPLATES.filter((t) => !t.hidden && (!t.feature || features[t.feature]));
}
const GROUP_TONE: Record<
  Template["group"],
  {
    tone: string;
    dot: string;
  }
> = {
  Triggers: { tone: "text-secondary", dot: "bg-secondary" },
  Actions: { tone: "text-primary", dot: "bg-primary" },
  Logic: { tone: "text-tertiary", dot: "bg-tertiary" },
};
export default function Palette({
  onAdd,
  flowNodes,
  collapsed,
  pinned,
  onExpand,
  onTogglePin,
  features,
}: Props) {
  const groups: Template["group"][] = ["Triggers", "Actions", "Logic"];
  const headingId = useId();
  const hasTrigger = flowNodes.some(isTrigger);
  const hasTimeCondition = flowNodes.some(isTimeCondition);
  const hasReturnCondition = flowNodes.some(
    (node) => node.type === "condition" && node.config.kind !== "oracle_gte",
  );
  if (collapsed) {
    return (
      <aside className="glass-panel-sidebar pt-md relative flex h-full flex-col items-center">
        <button
          type="button"
          onClick={onExpand}
          className="text-on-surface-variant hover:bg-surface-container-high/50 hover:text-on-surface flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <span aria-hidden="true" className="material-symbols-outlined text-[20px]">
            chevron_right
          </span>
        </button>
      </aside>
    );
  }
  return (
    <aside
      aria-labelledby={headingId}
      className="glass-panel-sidebar p-md relative h-full overflow-y-auto"
    >
      <button
        type="button"
        onClick={onTogglePin}
        className={`hover:bg-surface-container-high/50 hover:text-on-surface absolute top-3 left-1 z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${pinned ? "bg-primary/10 text-primary" : "text-on-surface-variant"}`}
        title={pinned ? "Unpin sidebar" : "Pin sidebar"}
        aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
        aria-pressed={!!pinned}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          push_pin
        </span>
      </button>
      <h2 id={headingId} className="text-label-sm text-on-surface-variant pl-8 font-mono">
        / BLOCKS
      </h2>
      {groups.map((g) => {
        const t = GROUP_TONE[g];
        return (
          <div key={g} className="mt-md">
            <div className={`text-label-sm inline-flex items-center gap-2 font-mono ${t.tone}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
              {g.toUpperCase()}
            </div>
            <div className="mt-2 grid gap-1.5">
              {visibleTemplates(features)
                .filter((tpl) => tpl.group === g)
                .map((tpl) => {
                  const isTriggerBlock = g === "Triggers";
                  const disabledReason =
                    isTriggerBlock && hasTrigger
                      ? "A flow can only have one trigger"
                      : tpl.requiresCondition === "time" && !hasTimeCondition
                        ? "Add a time condition to enable Hold"
                        : tpl.requiresCondition === "non-oracle" && !hasReturnCondition
                          ? "Add an amount, time, or multisig condition to enable Return to owner"
                          : undefined;
                  const disabled = !!disabledReason;
                  return (
                    <div key={tpl.label} className="group relative">
                      <button
                        data-analytics-control="template-select"
                        data-testid={`palette-${tpl.label.toLowerCase().replace(/\s+/g, "-")}`}
                        onClick={() => !disabled && onAdd(tpl.make())}
                        disabled={disabled}
                        title={disabledReason}
                        className={`group inline-flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono transition-all ${
                          disabled
                            ? "border-outline-variant/20 bg-surface-container-low/40 cursor-not-allowed opacity-40"
                            : "border-outline-variant/20 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high/50 hover:text-on-surface"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`material-symbols-outlined text-[16px] ${t.tone} opacity-90`}
                        >
                          {tpl.icon}
                        </span>
                        {tpl.label}
                        <span
                          aria-hidden="true"
                          className="material-symbols-outlined text-outline-variant group-hover:text-primary ml-auto text-[14px] transition-colors"
                        >
                          add
                        </span>
                      </button>
                      {disabled && (
                        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 group-hover:block">
                          <div className="rounded bg-zinc-800 px-2 py-1 text-[11px] whitespace-nowrap text-zinc-300 shadow-lg ring-1 ring-zinc-700">
                            {disabledReason}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
