"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { assetLabel, isAction } from "@/lib/flows/schema";
import { formatAmount } from "@/lib/utils";

function isApiFillAddress(addr: string): boolean {
  return addr === "PENDING:__api__";
}

type ActionNodeData = {
  node: FlowNode;
  label: string;
  isMutable?: boolean;
};

function ActionNodeComponent({ data, selected }: NodeProps) {
  const d = data as ActionNodeData;
  const n = d.node;
  if (!isAction(n)) return null;
  const isMutable = d.isMutable === true;

  let icon: string;
  let title: string;
  let detail: string;

  if (n.type === "pay") {
    icon = "payments";
    title = "Pay";
    const label = assetLabel(n.config.asset);
    const recipientDeferred = isApiFillAddress(n.config.recipient);
    if (recipientDeferred && n.config.fillValueViaApi) {
      detail = `${label} · payment via API`;
    } else if (recipientDeferred) {
      detail = `${label} · recipient via API`;
    } else if (n.config.fillValueViaApi) {
      detail = `${label} · value via API`;
    } else if (n.config.fullAmount) {
      detail = `Full amount ${label}`;
    } else if (n.config.mode === "percentage" && n.config.percentage !== undefined) {
      detail = `${n.config.percentage}% ${label}`;
    } else {
      detail = `${formatAmount(n.config.amountStroops || "0")} ${label}`;
    }
  } else if (n.type === "swap") {
    icon = "swap_horiz";
    title = "Swap";
    detail = `${assetLabel(n.config.assetIn)} → ${assetLabel(n.config.assetOut)} @ ${(n.config.rateBps / 100).toFixed(0)}%`;
  } else if (n.type === "yield") {
    icon = "savings";
    title = "Yield";
    detail = `deposit ${assetLabel(n.config.asset)}`;
  } else if (n.type === "email_notify") {
    icon = "mail";
    title = "Email Notify";
    detail = `${n.config.recipients.length} recipient${n.config.recipients.length === 1 ? "" : "s"}`;
  } else if (n.type === "cash_out") {
    icon = "payments";
    title = "Cash Out";
    const label = assetLabel(n.config.asset);
    detail = n.config.bankCode ? `${label} → ${n.config.bankCode}` : `${label} → bank`;
  } else {
    icon = "call_split";
    title = "Split";
    if (isMutable && n.config.recipients.length === 0) {
      detail = "recipients via API";
    } else {
      detail = `${n.config.recipients.length} recipient${n.config.recipients.length === 1 ? "" : "s"}`;
    }
  }

  const canHaveChildren = n.type !== "email_notify" && n.type !== "cash_out";

  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${selected ? "neon-glow" : ""}`}
      style={{
        borderColor: selected
          ? undefined
          : isMutable
            ? "rgba(255, 186, 32, 0.55)"
            : "rgba(255, 177, 196, 0.3)",
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
        {isMutable ? (
          <span
            className="inline-flex items-center gap-0.5 rounded border px-1 py-px font-mono text-[7px] leading-none font-medium tracking-wider"
            style={{
              borderColor: "rgba(255, 186, 32, 0.35)",
              backgroundColor: "rgba(255, 186, 32, 0.10)",
              color: "#ffba20",
            }}
            title="Deploys as a mutable _DEV contract — fill recipient/amount via the API after deploy"
          >
            <span className="material-symbols-outlined text-[9px]">tune</span>
            DEV
          </span>
        ) : (
          <span className="status-dot-live h-1.5 w-1.5" />
        )}
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
