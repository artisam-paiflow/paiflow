"use client";
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { assetLabel, isAction } from "@/lib/flows/schema";
import { formatAmount } from "@/lib/utils";
type ActionNodeData = {
  node: FlowNode;
  label: string;
};
function ActionNodeComponent({ data, selected }: NodeProps) {
  const d = data as ActionNodeData;
  const n = d.node;
  if (!isAction(n) || n.type === "email_notify") return null;
  let icon: string;
  let title: string;
  let detail: string;
  if (n.type === "hold") {
    icon = "lock";
    title = "Hold";
    detail = "Strict lock until the deadline";
  } else if (n.type === "return_to_owner") {
    icon = "undo";
    title = "Return to owner";
    detail = "100% to the deploying wallet";
  } else if (n.type === "pay") {
    icon = "payments";
    title = "Pay";
    const label = assetLabel(n.config.asset);
    if (n.config.fullAmount) {
      detail = `Full amount ${label}`;
    } else if (n.config.mode === "percentage" && n.config.percentage !== undefined) {
      detail = `${n.config.percentage}% ${label}`;
    } else {
      detail = `${formatAmount(n.config.amountStroops || "0")} ${label}`;
    }
  } else if (n.type === "swap") {
    icon = "swap_horiz";
    title = "Swap";
    detail = `${assetLabel(n.config.assetIn)} → ${assetLabel(n.config.assetOut)} via Soroswap, ≤${n.config.slippageBps / 100}% slippage`;
  } else if (n.type === "yield") {
    icon = "savings";
    title = "Yield";
    detail = `deposit ${assetLabel(n.config.asset)}`;
  } else if (n.type === "cash_out") {
    icon = "payments";
    title = "Cash Out";
    const label = assetLabel(n.config.asset);
    detail = n.config.bankCode ? `${label} → ${n.config.bankCode}` : `${label} → bank`;
  } else {
    icon = "call_split";
    title = "Split";
    {
      detail = `${n.config.recipients.length} recipient${n.config.recipients.length === 1 ? "" : "s"}`;
    }
  }
  const canHaveChildren =
    n.type !== "cash_out" && n.type !== "hold" && n.type !== "return_to_owner";
  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${selected ? "neon-glow" : ""}`}
      style={{
        borderColor: selected ? undefined : "rgba(255, 177, 196, 0.3)",
      }}
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
        {<span className="status-dot-live h-1.5 w-1.5" />}
      </div>

      <div className="px-3 py-2.5">
        <div className="font-display text-on-surface text-[14px] leading-tight font-semibold">
          {title}
        </div>
        <div className="text-on-surface-variant mt-1 font-mono text-[11px]">{detail}</div>
      </div>

      {canHaveChildren && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!border-primary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
        />
      )}
    </div>
  );
}
export default memo(ActionNodeComponent);
