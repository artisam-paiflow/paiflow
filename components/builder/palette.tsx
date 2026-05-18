"use client";

import { useId } from "react";
import type { FlowNode } from "@/lib/flows/schema";
import { isTrigger } from "@/lib/flows/schema";

type Props = {
  onAdd: (node: FlowNode) => void;
  flowNodes: FlowNode[];
};

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const TEMPLATES: {
  label: string;
  group: "Triggers" | "Actions" | "Logic";
  make: () => FlowNode;
}[] = [
  {
    group: "Triggers",
    label: "On Receive",
    make: () => ({
      id: makeId("recv"),
      type: "on_receive",
      config: { asset: { kind: "known", symbol: "USDC" } },
    }),
  },
  {
    group: "Triggers",
    label: "On Schedule",
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
    group: "Logic",
    label: "Condition",
    make: () => ({
      id: makeId("cond"),
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    }),
  },
];

export default function Palette({ onAdd, flowNodes }: Props) {
  const groups: Array<"Triggers" | "Actions" | "Logic"> = ["Triggers", "Actions", "Logic"];
  const headingId = useId();
  const hasTrigger = flowNodes.some(isTrigger);

  return (
    <aside aria-labelledby={headingId} className="border-r border-zinc-800 bg-zinc-950 p-3">
      <h2 id={headingId} className="text-xs tracking-wide text-zinc-500 uppercase">
        Blocks
      </h2>
      {groups.map((g) => (
        <div key={g} className="mt-4">
          <div className="text-[10px] tracking-wider text-zinc-500 uppercase">{g}</div>
          <div className="mt-1 grid gap-1">
            {TEMPLATES.filter((t) => t.group === g).map((t) => {
              const isTriggerBlock = g === "Triggers";
              const disabled = isTriggerBlock && hasTrigger;

              return (
                <div key={t.label} className="group relative">
                  <button
                    onClick={() => !disabled && onAdd(t.make())}
                    disabled={disabled}
                    className={`w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm transition-colors ${
                      disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:border-brand-500 hover:bg-zinc-800"
                    }`}
                  >
                    {t.label}
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
      ))}
    </aside>
  );
}
