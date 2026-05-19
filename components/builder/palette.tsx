"use client";

import { useId } from "react";
import type { FlowNode } from "@/lib/flows/schema";

type Props = {
  onAdd: (node: FlowNode) => void;
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
    group: "Actions",
    label: "Pay",
    icon: "payments",
    make: () => ({
      id: makeId("pay"),
      type: "pay",
      config: {
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
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
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            bps: 5000,
            label: "A",
          },
          {
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            bps: 5000,
            label: "B",
          },
        ],
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

export default function Palette({ onAdd }: Props) {
  const groups: Template["group"][] = ["Triggers", "Actions", "Logic"];
  const headingId = useId();
  return (
    <aside aria-labelledby={headingId} className="glass-panel-sidebar p-md h-full overflow-y-auto">
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
              {TEMPLATES.filter((tpl) => tpl.group === g).map((tpl) => (
                <button
                  key={tpl.label}
                  onClick={() => onAdd(tpl.make())}
                  className="group border-outline-variant/20 bg-surface-container-low/40 text-label-md text-on-surface-variant hover:border-primary/40 hover:bg-surface-container-high/50 hover:text-on-surface inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-left font-mono transition-all"
                >
                  <span className={`material-symbols-outlined text-[16px] ${t.tone} opacity-90`}>
                    {tpl.icon}
                  </span>
                  {tpl.label}
                  <span className="material-symbols-outlined text-outline-variant group-hover:text-primary ml-auto text-[14px] transition-colors">
                    add
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}
