"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";

type TriggerNodeData = {
  node: FlowNode;
  label: string;
};

function TriggerIcon({ type }: { type: "on_receive" | "on_schedule" }) {
  return type === "on_receive" ? (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ) : (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function TriggerNodeComponent({ data }: NodeProps) {
  const d = data as TriggerNodeData;
  const n = d.node as Extract<FlowNode, { type: "on_receive" | "on_schedule" }>;

  const isReceive = n.type === "on_receive";
  const assetLabel = isReceive
    ? n.config.asset.kind === "known"
      ? n.config.asset.symbol
      : n.config.asset.kind === "native"
        ? "XLM"
        : n.config.asset.code
    : n.config.interval;

  return (
    <div className="border-brand-500 shadow-brand-500/10 relative min-w-[160px] rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="flex items-center gap-2">
        <div className="bg-brand-500/20 text-brand-400 flex h-7 w-7 items-center justify-center rounded-md">
          <TriggerIcon type={n.type} />
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-200">
            {isReceive ? "On Receive" : "On Schedule"}
          </div>
          <div className="text-[10px] text-zinc-500">
            {isReceive ? assetLabel : n.config.interval}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-brand-500 !h-2.5 !w-2.5 !rounded-full !border-2 !bg-zinc-900"
      />
    </div>
  );
}

export default memo(TriggerNodeComponent);
