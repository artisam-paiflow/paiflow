"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { assetLabel, isTrigger } from "@/lib/flows/schema";
import { formatStroops } from "@/lib/utils";

type TriggerNodeData = {
  node: FlowNode;
  label: string;
};

function TriggerNodeComponent({ data, selected }: NodeProps) {
  const d = data as TriggerNodeData;
  const n = d.node;
  if (!isTrigger(n)) return null;

  let icon: string;
  let title: string;
  let detail: string;
  if (n.type === "on_receive") {
    icon = "toll";
    title = "On Receive";
    detail =
      n.config.asset.kind === "known"
        ? n.config.asset.symbol
        : n.config.asset.kind === "native"
          ? "XLM"
          : n.config.asset.code;
  } else if (n.type === "webhook") {
    icon = "webhook";
    title = "Webhook";
    detail =
      n.config.asset.kind === "known"
        ? n.config.asset.symbol
        : n.config.asset.kind === "native"
          ? "XLM"
          : n.config.asset.code;
  } else if (n.type === "web2_webhook") {
    icon = "http";
    title = "HTTP Webhook";
    detail =
      n.config.asset.kind === "known"
        ? n.config.asset.symbol
        : n.config.asset.kind === "native"
          ? "XLM"
          : n.config.asset.code;
  } else if (n.type === "subscription") {
    icon = "repeat";
    title = "Subscription";
    const intervalAmount = n.config.intervalAmount ?? 1;
    const intervalUnit = n.config.intervalUnit ?? "day";
    detail = `${formatStroops(n.config.amountPerPeriodStroops)} ${assetLabel(n.config.asset)} / ${intervalAmount} ${intervalUnit}`;
  } else if (n.type === "oracle") {
    icon = "online_prediction";
    title = "Oracle";
    detail = `threshold ${n.config.threshold}`;
  } else {
    icon = "schedule";
    title = "On Schedule";
    const cfg = n.config as { intervalAmount?: number; intervalUnit?: string; interval?: string };
    detail = `${cfg.intervalAmount ?? 1} ${cfg.intervalUnit ?? cfg.interval ?? "hour"}`;
  }

  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${selected ? "neon-glow-secondary" : ""}`}
      style={{ borderColor: selected ? undefined : "rgba(152, 203, 255, 0.3)" }}
    >
      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-secondary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />

      <div className="border-secondary/20 flex items-center justify-between border-b px-3 py-2">
        <span className="text-label-sm text-secondary inline-flex items-center gap-1.5 font-mono">
          <span className="material-symbols-outlined text-[14px]">{icon}</span>
          TRIGGER
        </span>
        <span className="status-dot-deploy h-1.5 w-1.5" />
      </div>

      <div className="px-3 py-2.5">
        <div className="font-display text-on-surface text-[14px] leading-tight font-semibold">
          {title}
        </div>
        <div className="text-on-surface-variant mt-1 font-mono text-[11px]">{detail}</div>
      </div>
    </div>
  );
}

export default memo(TriggerNodeComponent);
