"use client";

import { useId } from "react";
import type { FlowNode } from "@/lib/flows/schema";

type Props = {
  onAdd: (node: FlowNode) => void;
};

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

const DEMO_ADDR = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const TEMPLATES: { label: string; group: string; make: () => FlowNode }[] = [
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
        recipient: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
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
    make: () => ({
      id: makeId("cond"),
      type: "condition",
      config: { kind: "amount_gt", amountStroops: "10000000" },
    }),
  },
];

export default function Palette({ onAdd }: Props) {
  const groups = ["Triggers", "Actions", "Logic"];
  const headingId = useId();
  return (
    <aside
      aria-labelledby={headingId}
      className="border-r border-zinc-800 bg-zinc-950 p-3"
    >
      <h2 id={headingId} className="text-xs uppercase tracking-wide text-zinc-500">
        Blocks
      </h2>
      {groups.map((g) => (
        <div key={g} className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">{g}</div>
          <div className="mt-1 grid gap-1">
            {TEMPLATES.filter((t) => t.group === g).map((t) => (
              <button
                key={t.label}
                onClick={() => onAdd(t.make())}
                className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm hover:border-brand-500 hover:bg-zinc-800"
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
