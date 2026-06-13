"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isLogic } from "@/lib/flows/schema";

type LogicNodeData = {
  node: FlowNode;
  label: string;
};

const KIND_LABELS: Record<string, string> = {
  amount_gt: "amount ≥",
  amount_lt: "amount <",
  oracle_gte: "oracle ≥",
  time_after: "time after",
  time_before: "time before",
  multisig: "multisig",
};

function LogicNodeComponent({ data, selected }: NodeProps) {
  const d = data as LogicNodeData;
  const n = d.node;
  if (!isLogic(n)) return null;

  return (
    <div
      className={`glass-panel relative min-w-[200px] rounded-xl ${
        selected ? "neon-glow-tertiary" : ""
      }`}
      style={{ borderColor: selected ? undefined : "rgba(255, 186, 32, 0.3)" }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-tertiary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />

      <div className="border-tertiary/20 flex items-center justify-between border-b px-3 py-2">
        <span className="text-label-sm text-tertiary inline-flex items-center gap-1.5 font-mono">
          <span className="material-symbols-outlined text-[14px]">rule</span>
          LOGIC
        </span>
      </div>

      <div className="px-3 py-2.5">
        <div className="font-display text-on-surface text-[14px] leading-tight font-semibold">
          Condition
        </div>
        <div className="text-on-surface-variant mt-1 font-mono text-[11px]">
          {KIND_LABELS[n.config.kind] ?? n.config.kind}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-tertiary !bg-surface-container !h-2.5 !w-2.5 !rounded-full !border-2"
      />
    </div>
  );
}

export default memo(LogicNodeComponent);
