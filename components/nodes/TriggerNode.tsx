"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, Clock } from "lucide-react";
import type { FlowNode } from "@/lib/flows/schema";
import { isTrigger } from "@/lib/flows/schema";

type TriggerNodeData = {
  node: FlowNode;
  label: string;
};

function TriggerNodeComponent({ data }: NodeProps) {
  const d = data as TriggerNodeData;
  const n = d.node;
  if (!isTrigger(n)) return null;

  const isReceive = n.type === "on_receive";
  const label = isReceive
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
          {isReceive ? <Zap size={14} /> : <Clock size={14} />}
        </div>
        <div>
          <div className="text-xs font-semibold text-zinc-200">
            {isReceive ? "On Receive" : "On Schedule"}
          </div>
          <div className="text-[10px] text-zinc-500">{label}</div>
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
