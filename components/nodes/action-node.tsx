"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isAction } from "@/lib/flows/schema";
import { formatAmount } from "@/lib/utils";

type ActionNodeData = {
  node: FlowNode;
  label: string;
};

function ActionNodeComponent({ data, selected }: NodeProps) {
  const d = data as ActionNodeData;
  const n = d.node;
  if (!isAction(n)) return null;

  let icon: string;
  let title: string;
  let detail: string;

  if (n.type === "pay") {
    icon = "payments";
    title = "Pay";
    const assetLabel =
      n.config.asset.kind === "known"
        ? n.config.asset.symbol
        : n.config.asset.kind === "native"
          ? "XLM"
          : n.config.asset.code;
    if (n.config.fullAmount) {
      detail = `Full amount ${assetLabel}`;
    } else if (n.config.mode === "percentage" && n.config.percentage !== undefined) {
      detail = `${n.config.percentage}% ${assetLabel}`;
    } else {
      detail = `${formatAmount(n.config.amountStroops || "0")} ${assetLabel}`;
    }
  } else if (n.type === "swap") {
    icon = "swap_horiz";
    title = "Swap";
    const inLabel =
      n.config.assetIn.kind === "known"
        ? n.config.assetIn.symbol
        : n.config.assetIn.kind === "native"
          ? "XLM"
          : n.config.assetIn.code;
    const outLabel =
      n.config.assetOut.kind === "known"
        ? n.config.assetOut.symbol
        : n.config.assetOut.kind === "native"
          ? "XLM"
          : n.config.assetOut.code;
    detail = `${inLabel} → ${outLabel} @ ${(n.config.rateBps / 100).toFixed(0)}%`;
  } else if (n.type === "yield") {
    icon = "savings";
    title = "Yield";
    const assetLabel =
      n.config.asset.kind === "known"
        ? n.config.asset.symbol
        : n.config.asset.kind === "native"
          ? "XLM"
          : n.config.asset.code;
    detail = `deposit ${assetLabel}`;
  } else {
    icon = "call_split";
    title = "Split";
    detail = `${n.config.recipients.length} recipients`;
  }

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
          {title}
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
