"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "@/lib/flows/schema";
import { isLogic } from "@/lib/flows/schema";

type LogicNodeData = {
  node: FlowNode;
  label: string;
};

function ConditionIcon() {
  return (
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
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

const KIND_LABELS: Record<string, string> = {
  amount_gt: "amount >",
  amount_lt: "amount <",
  oracle_gte: "oracle ≥",
  time_after: "time after",
  time_before: "time before",
};

function LogicNodeComponent({ data }: NodeProps) {
  const d = data as LogicNodeData;
  const n = d.node;
  if (!isLogic(n)) return null;

  return (
    <div className="relative min-w-[160px] rounded-lg border-2 border-amber-500 bg-zinc-900 px-4 py-3 shadow-lg shadow-amber-500/10">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-amber-500 !bg-zinc-900"
      />

      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-amber-500/20 text-amber-400">
          <ConditionIcon />
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-200">Condition</div>
          <div className="text-[10px] text-zinc-500">
            {KIND_LABELS[n.config.kind] ?? n.config.kind}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-amber-500 !bg-zinc-900"
      />
    </div>
  );
}

export default memo(LogicNodeComponent);
