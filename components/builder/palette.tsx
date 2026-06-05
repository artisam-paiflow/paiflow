"use client";

import { useId } from "react";
import type { TemplateKind } from "@prisma/client";
import type { FlowNode } from "@/lib/flows/schema";
import { isTrigger } from "@/lib/flows/schema";
import { TEMPLATE_LABELS, TEMPLATE_DESCRIPTIONS } from "@/lib/flows/template-labels";

type Props = {
  onAdd: (node: FlowNode) => void;
  flowNodes: FlowNode[];
  templateKind?: TemplateKind | null;
  pipeline?: TemplateKind[];
};

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

type Template = {
  label: string;
  icon: string;
  group: "Triggers" | "Actions" | "Logic";
  make: () => FlowNode;
};

const TEMPLATES: Template[] = [
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
        interval: "hour",
        startsAt: new Date().toISOString(),
      },
    }),
  },
  {
    group: "Triggers",
    label: "Webhook",
    icon: "webhook",
    make: () => ({
      id: makeId("webhook"),
      type: "webhook",
      config: { asset: { kind: "known", symbol: "USDC" }, relayer: "PENDING:relayer" },
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
      },
    }),
  },
  {
    group: "Triggers",
    label: "Oracle",
    icon: "online_prediction",
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
            bps: 5000,
            label: "A",
          },
          {
            address: "PENDING:unnamed",
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
        rateBps: 9500,
      },
    }),
  },
  {
    group: "Actions",
    label: "Yield",
    icon: "savings",
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
    make: () => ({
      id: makeId("cond"),
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    }),
  },
];

const GROUP_TONE: Record<Template["group"], { tone: string; dot: string }> = {
  Triggers: { tone: "text-secondary", dot: "bg-secondary" },
  Actions: { tone: "text-primary", dot: "bg-primary" },
  Logic: { tone: "text-tertiary", dot: "bg-tertiary" },
};

export default function Palette({ onAdd, flowNodes, templateKind, pipeline }: Props) {
  const groups: Template["group"][] = ["Triggers", "Actions", "Logic"];
  const headingId = useId();
  const hasTrigger = flowNodes.some(isTrigger);
  const templateLabel = templateKind ? TEMPLATE_LABELS[templateKind] : null;
  const templateDescription = templateKind ? TEMPLATE_DESCRIPTIONS[templateKind] : null;

  return (
    <aside aria-labelledby={headingId} className="glass-panel-sidebar p-md h-full overflow-y-auto">
      <section aria-label="Pipeline architecture" className="mb-md">
        <div className="text-label-sm text-on-surface-variant font-mono">
          / PIPELINE ARCHITECTURE
        </div>
        {pipeline && pipeline.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {pipeline.map((kind, i) => (
              <span key={`${kind}-${i}`} className="inline-flex items-center gap-1.5">
                <span className="text-label-sm border-primary/20 bg-primary/10 text-primary inline-flex items-center rounded-md border px-2 py-1 font-mono">
                  {TEMPLATE_LABELS[kind]}
                </span>
                {i < pipeline.length - 1 && (
                  <span className="material-symbols-outlined text-on-surface-variant text-[14px]">
                    arrow_forward
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-2">
            <span
              className={`text-label-md inline-flex items-center gap-2 rounded-lg border px-2 py-1 font-mono ${
                templateLabel
                  ? "bg-primary/10 border-primary/20 text-primary"
                  : "border-outline-variant/20 bg-surface-container-low/40 text-on-surface-variant"
              }`}
            >
              {templateLabel ?? "—"}
            </span>
          </div>
        )}
        {templateDescription && (
          <p className="text-body-md text-on-surface-variant mt-2 leading-snug">
            {templateDescription}
          </p>
        )}
      </section>
      <h2 id={headingId} className="text-label-sm text-on-surface-variant font-mono">
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
              {TEMPLATES.filter((tpl) => tpl.group === g).map((tpl) => {
                const isTriggerBlock = g === "Triggers";
                const disabled = isTriggerBlock && hasTrigger;

                return (
                  <div key={tpl.label} className="group relative">
                    <button
                      onClick={() => !disabled && onAdd(tpl.make())}
                      disabled={disabled}
                      className={`group inline-flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono transition-all ${
                        disabled
                          ? "border-outline-variant/20 bg-surface-container-low/40 cursor-not-allowed opacity-40"
                          : "border-outline-variant/20 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high/50 hover:text-on-surface"
                      }`}
                    >
                      <span
                        className={`material-symbols-outlined text-[16px] ${t.tone} opacity-90`}
                      >
                        {tpl.icon}
                      </span>
                      {tpl.label}
                      <span className="material-symbols-outlined text-outline-variant group-hover:text-primary ml-auto text-[14px] transition-colors">
                        add
                      </span>
                    </button>
                    {disabled && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 group-hover:block">
                        <div className="rounded bg-zinc-800 px-2 py-1 text-[11px] whitespace-nowrap text-zinc-300 shadow-lg ring-1 ring-zinc-700">
                          A flow can only have one trigger
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
