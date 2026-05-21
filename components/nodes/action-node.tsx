"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isAction } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";

type ActionNodeData = {
  node: FlowNode;
  label: string;
};

function ActionNodeComponent({ data, selected }: NodeProps) {
  const d = data as ActionNodeData;
  const n = d.node;
  if (!isAction(n)) return null;

  const isPay = n.type === "pay";
  const icon = isPay ? "payments" : "call_split";

  const assetLabel =
    n.config.asset.kind === "known"
      ? n.config.asset.symbol
      : n.config.asset.kind === "native"
        ? "XLM"
        : n.config.asset.code;

  const detail = isPay
    ? `${formatStroops(n.config.amountStroops)} ${assetLabel}`
    : `${n.config.recipients.length} recipients`;

  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${selected ? "neon-glow" : ""}`}
      style={{ borderColor: selected ? undefined : "rgba(255, 177, 196, 0.3)" }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-primary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />

      <div className="border-primary/20 flex items-center justify-between border-b px-3 py-2">
        <span className="text-label-sm text-primary inline-flex items-center gap-1.5 font-mono">
          <span className="material-symbols-outlined text-[14px]">{icon}</span>
          ACTION
        </span>
        <span className="status-dot-live h-1.5 w-1.5" />
      </div>

      <div className="px-3 py-2.5">
        <div className="font-display text-on-surface text-[14px] leading-tight font-semibold">
          {isPay ? "Pay" : "Split"}
        </div>
        <div className="text-on-surface-variant mt-1 font-mono text-[11px]">{detail}</div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-primary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />
    </div>
  );
}

export default memo(ActionNodeComponent);
